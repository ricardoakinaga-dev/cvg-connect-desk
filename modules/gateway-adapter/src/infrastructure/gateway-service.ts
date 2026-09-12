import axios from 'axios';
import { withRetry } from '@cvg/shared';
import { withSpan, injectTraceContext, correlationAttributes } from '@cvg/tracing';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY || '';

/**
 * Serviço de integração com o gateway_evochatwoot.
 * Responsável por enviar mensagens outbound para o gateway,
 * que as encaminha para Evolution API → WhatsApp.
 */
export const gatewayService = {
  /**
   * Envia mensagem outbound para o gateway (que encaminha para WhatsApp).
   */
  async sendOutbound(params: {
    messageId: string;
    conversationId: string;
    externalPhone: string;
    content: string;
    instance?: string;
    senderName?: string;
    senderType?: 'agent' | 'bot' | 'system';
    attachmentUrl?: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const digits = params.externalPhone.replace(/@.*$/, '').replace(/\D/g, '');
      if (!digits) return { success: false, error: 'Invalid recipient phone' };
      const event = {
        contract_version: '1.0.0',
        event_type: 'DESK_OUTBOUND',
        event_id: params.messageId,
        occurred_at: new Date().toISOString(),
        tenant: 'cvg',
        provider: 'connect-desk',
        channel: 'whatsapp',
        payload: {
          instance: params.instance || process.env.EVOLUTION_INSTANCE || 'cvg-local',
          conversationId: params.conversationId,
          messageId: params.messageId,
          remoteJid: `${digits}@s.whatsapp.net`,
          content: params.content,
          senderType: params.senderType || 'agent',
          attachments: params.attachmentUrl
            ? [{ url: params.attachmentUrl, file_type: 'image' }]
            : undefined,
        },
      };

      // event_id é o UUID persistido da mensagem: retries são seguros porque o
      // gateway mantém uma reivindicação durável de idempotência antes da fila.
      const outcome = await withSpan(
        'gateway.send',
        () =>
          withRetry(
            async () => {
              return axios.post<{ status: string; operation_id?: string }>(`${GATEWAY_URL}/webhooks/desk`, event, {
                headers: injectTraceContext({
                  'Content-Type': 'application/json',
                  'x-api-key': GATEWAY_API_KEY,
                }),
                timeout: 10000,
              });
            },
            {
              maxRetries: Number(process.env.GATEWAY_MAX_RETRIES) || 2,
              idempotent: true,
              onRetry: (info) => {
                console.error(
                  `[GatewayService] retry attempt=${info.attempt} classification=${info.classification} event=${event.event_id}`,
                );
              },
            },
            (error) => (error as { response?: { headers?: Record<string, string> } }).response?.headers?.['retry-after'],
          ),
        correlationAttributes({ event_id: event.event_id }),
      );

      if (outcome.error) {
        const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
        console.error('[GatewayService] Erro ao enviar outbound:', message);
        return { success: false, error: message };
      }

      const status = outcome.value?.data?.status;
      if (status !== 'queued' && status !== 'duplicate') {
        return { success: false, error: `Unexpected gateway status: ${String(status)}` };
      }
      return { success: true, messageId: outcome.value?.data?.operation_id || event.event_id };
    } catch (error: any) {
      console.error('[GatewayService] Erro ao enviar outbound:', error.message);
      return { success: false, error: error.message };
    }
  },

  /**
   * Verifica status do gateway.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(`${GATEWAY_URL}/health`, { timeout: 5000 });
      return response.status === 200;
    } catch {
      return false;
    }
  },

  /**
   * Verifica status das instâncias Evolution.
   */
  async getInstanceStatus(instance?: string): Promise<any> {
    try {
      const url = instance
        ? `${GATEWAY_URL}/instances/${instance}/status`
        : `${GATEWAY_URL}/instances/status`;
      const response = await axios.get(url, {
        headers: { 'x-api-key': GATEWAY_API_KEY },
        timeout: 5000,
      });
      return response.data;
    } catch {
      return null;
    }
  },
};
