import { ok, err, type Result } from '@cvg/shared';
import { AppError } from '@cvg/shared';
import { withRetry, classifyRetryError } from '@cvg/shared';
import { withSpan, injectTraceContext, correlationAttributes } from '@cvg/tracing';

export interface SecretaryConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
}

export interface SecretaryRequest {
  action: string;
  conversationId: string;
  messageId?: string;
  context: Record<string, unknown>;
}

export interface SecretaryResponse {
  success: boolean;
  response?: string;
  action?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

export class SecretaryClient {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;

  constructor(config: SecretaryConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 30000;
  }

  async invoke(request: SecretaryRequest): Promise<Result<SecretaryResponse, Error>> {
    return withSpan(
      'secretary.invoke',
      () => this.invokeWithRetry(request),
      correlationAttributes({
        conversation_id: request.conversationId,
        message_id: request.messageId,
      }),
    );
  }

  private async invokeWithRetry(request: SecretaryRequest): Promise<Result<SecretaryResponse, Error>> {
    // Retry limitado a falhas pré-resposta (network/timeout) ou 429/5xx.
    // idempotent:false — nunca retenta após resposta 4xx/auth/schema.
    const outcome = await withRetry(
      async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
          const response = await fetch(`${this.baseUrl}/invoke`, {
            method: 'POST',
            headers: injectTraceContext({
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`,
            }),
            body: JSON.stringify({
              action: request.action,
              conversation_id: request.conversationId,
              message_id: request.messageId,
              context: request.context,
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            const status = response.status;
            const retryable = status === 429 || status >= 500;
            const errorBody = retryable ? await response.text().catch(() => '') : '';
            void errorBody;
            throw Object.assign(new Error(`Secretary API error: ${status}`), { status });
          }

          return (await response.json()) as SecretaryResponse;
        } finally {
          clearTimeout(timeoutId);
        }
      },
      {
        maxRetries: Number(process.env.SECRETARY_MAX_RETRIES) || 2,
        idempotent: false,
        onRetry: (info) => {
          // eslint-disable-next-line no-console
          console.warn(
            `[SecretaryClient] retry attempt=${info.attempt} classification=${info.classification} delayMs=${info.delayMs} action=${request.action}`,
          );
        },
      },
      (error) => (error as { response?: { headers?: Record<string, string> } }).response?.headers?.['retry-after'],
    );

    if (outcome.error) {
      const error = outcome.error;
      if (error instanceof Error && (error.name === 'AbortError' || classifyRetryError(error) === 'timeout')) {
        return err(new AppError('Secretary request timed out', 504, 'SECRETARY_TIMEOUT'));
      }
      if (error instanceof AppError) return err(error);
      if (error instanceof Error && error.message.startsWith('Secretary API error')) {
        const status = (error as Error & { status?: number }).status ?? 502;
        return err(new AppError(error.message, status, 'SECRETARY_ERROR'));
      }
      return err(error as Error);
    }

    return ok(outcome.value as SecretaryResponse);
  }

  async checkHealth(): Promise<Result<boolean, Error>> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });
      return ok(response.ok);
    } catch {
      return ok(false);
    }
  }
}

let clientInstance: SecretaryClient | null = null;

export function initializeSecretaryClient(config: SecretaryConfig): SecretaryClient {
  clientInstance = new SecretaryClient(config);
  return clientInstance;
}

export function getSecretaryClient(): SecretaryClient | null {
  return clientInstance;
}
