import axios from 'axios';
import { withRetry } from '@cvg/shared';
import { withSpan, injectTraceContext, correlationAttributes } from '@cvg/tracing';
import type { CWOutboundEvent } from '../types/gateway-contracts';
import { v4 as uuidv4 } from 'uuid';

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
    conversationId: string;
    externalPhone: string;
    content: string;
    instance?: string;
    senderName?: string;
    senderType?: 'agent' | 'bot' | 'system';
    attachmentUrl?: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const event: CWOutboundEvent = {
        contract_version: '1.0.0',
        event_type: 'CW_OUTBOUND',
        event_id: uuidv4(),
        occurred_at: new Date().toISOString(),
        tenant: 'cvg',
        provider: 'chatwoot',
        channel: 'whatsapp',
        payload: {
          accountId: 1,
          inboxId: 1,
          conversationId: parseInt(params.conversationId.replace(/\D/g, '').slice(0, 8)) || 0,
          chatwoot_message_id: Date.now(),
          content: params.content,
          sender: {
            type: params.senderType || 'agent',
            id: 1,
            name: params.senderName || 'CVG Desk',
          },
          attachments: params.attachmentUrl
            ? [{ url: params.attachmentUrl, file_type: 'image' }]
            : undefined,
        },
      };

      // Enviar para o endpoint outbound do gateway (retry limitado a falhas
      // pré-resposta/retryable; idempotent:false — POST sem idempotency key).
      // Trace W3C propagado nos headers (Final-2).
      const outcome = await withSpan(
        'gateway.send',
        () =>
          withRetry(
            async () => {
              await axios.post(`${GATEWAY_URL}/webhook/outbound`, event, {
                headers: injectTraceContext({
                  'Content-Type': 'application/json',
                  'x-api-key': GATEWAY_API_KEY,
                }),
                timeout: 10000,
              });
            },
            {
              maxRetries: Number(process.env.GATEWAY_MAX_RETRIES) || 2,
              idempotent: false,
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

      return { success: true, messageId: event.event_id };
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
