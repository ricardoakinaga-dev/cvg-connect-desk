import axios from 'axios';
import { withRetry } from '@cvg/shared';
import { withSpan, injectTraceContext, correlationAttributes } from '@cvg/tracing';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY || '';

/**
 * C04: `definitive` = o provider rejeitou explicitamente (nada foi aceito);
 * `unknown` = a requisição pode ter sido aceita (timeout/reset/5xx) e exige
 * reconciliação explícita em vez de retry cego pelo chat.
 */
export type GatewayFailureKind = 'definitive' | 'unknown';

export interface GatewaySendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  failureKind?: GatewayFailureKind;
}

/** Provider entrega idempotência? Default true (gateway reivindica por event_id). */
export function providerSupportsIdempotency(): boolean {
  return (process.env.GATEWAY_PROVIDER_IDEMPOTENCY ?? 'true').toLowerCase() !== 'false';
}

function classifyGatewayFailure(error: unknown): GatewayFailureKind {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (typeof status === 'number') {
    // 4xx: rejeição explícita; o provider não aceitou a mensagem.
    if (status >= 400 && status < 500) return 'definitive';
    // 5xx: pode ter aceitado antes de falhar.
    return 'unknown';
  }
  // timeout, reset, DNS, socket: fronteira de aceite desconhecida.
  return 'unknown';
}

/**
 * Serviço de integração com o gateway_evochatwoot.
 * Responsável por enviar mensagens outbound para o gateway,
 * que as encaminha para Evolution API → WhatsApp.
 */
export const gatewayService = {
  providerSupportsIdempotency,

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
  }): Promise<GatewaySendResult> {
    const providerIdempotent = providerSupportsIdempotency();
    try {
      const digits = params.externalPhone.replace(/@.*$/, '').replace(/\D/g, '');
      if (!digits) return { success: false, error: 'Invalid recipient phone', failureKind: 'definitive' };
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
      // Provider SEM idempotência contratada: zero retry automático (C04).
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
              maxRetries: providerIdempotent ? Number(process.env.GATEWAY_MAX_RETRIES) || 2 : 0,
              idempotent: providerIdempotent,
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
        const failureKind = classifyGatewayFailure(outcome.error);
        console.error(
          `[GatewayService] Erro ao enviar outbound (${failureKind}):`,
          message,
        );
        return { success: false, error: message, failureKind };
      }

      const status = outcome.value?.data?.status;
      if (status !== 'queued' && status !== 'duplicate') {
        // 2xx com corpo inesperado: não há como afirmar que o gateway enfileirou.
        return { success: false, error: `Unexpected gateway status: ${String(status)}`, failureKind: 'unknown' };
      }
      return { success: true, messageId: outcome.value?.data?.operation_id || event.event_id };
    } catch (error: any) {
      console.error('[GatewayService] Erro ao enviar outbound:', error.message);
      return { success: false, error: error.message, failureKind: classifyGatewayFailure(error) };
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
