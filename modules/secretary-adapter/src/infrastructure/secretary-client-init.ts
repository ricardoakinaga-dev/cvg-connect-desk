import { initializeSecretaryClient } from '@cvg/integrations';

export interface SecretaryClientInitResult {
  configured: boolean;
  reason?: string;
}

/**
 * PROD-10/C09 — inicialização do cliente da Secretary para PROCESSOS DE
 * TRABALHO (worker), a partir do ambiente. Sem URL/chave o cliente fica
 * ausente e a invocação falha de forma observável (DLQ), nunca em silêncio.
 */
export function initializeSecretaryFromEnv(env: NodeJS.ProcessEnv = process.env): SecretaryClientInitResult {
  const baseUrl = env.SECRETARY_URL;
  const apiKey = env.SECRETARY_API_KEY;
  if (!baseUrl || !apiKey) {
    return { configured: false, reason: 'SECRETARY_URL/SECRETARY_API_KEY ausentes' };
  }
  initializeSecretaryClient({
    baseUrl,
    apiKey,
    timeout: Number(env.SECRETARY_TIMEOUT_MS) || 30000,
  });
  return { configured: true };
}
