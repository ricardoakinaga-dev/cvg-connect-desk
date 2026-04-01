import { ok, err, type Result } from '@cvg/shared';
import { AppError } from '@cvg/shared';

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
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          action: request.action,
          conversation_id: request.conversationId,
          message_id: request.messageId,
          context: request.context,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        return err(new AppError(
          `Secretary API error: ${response.status}`,
          response.status,
          'SECRETARY_ERROR'
        ));
      }

      const data = await response.json() as SecretaryResponse;
      return ok(data);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return err(new AppError('Secretary request timed out', 504, 'SECRETARY_TIMEOUT'));
      }
      return err(error as Error);
    }
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
