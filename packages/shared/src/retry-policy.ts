/**
 * Retry policy central (Phase 2 — §5.3).
 *
 * Toda chamada externa deve usar esta policy:
 * - timeout (via AbortController/caller)
 * - classificação de erro (network/timeout/429/5xx vs 4xx/auth/schema permanentes)
 * - bounded retries com exponential backoff + jitter
 * - suporte a Retry-After
 * - NUNCA retry automático de operação não-idempotente sem idempotency key
 */

export type RetryClassification =
  | 'network'
  | 'timeout'
  | 'rate_limited'
  | 'server'
  | 'client_permanent'
  | 'auth'
  | 'schema'
  | 'unknown';

export interface RetryPolicyOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  /** Operação é idempotente (ou possui idempotency key)? Se false, só erros seguros pré-envio retentam. */
  idempotent?: boolean;
  onRetry?: (info: { attempt: number; classification: RetryClassification; delayMs: number; error: unknown }) => void;
}

const DEFAULTS = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterRatio: 0.2,
};

export interface ClassifiableError {
  code?: string;
  status?: number;
  statusCode?: number;
  name?: string;
  message?: string;
  response?: { status?: number; headers?: Record<string, string> };
}

/** Classifica um erro de chamada externa para decisão de retry. */
export function classifyRetryError(error: unknown): RetryClassification {
  if (!error || typeof error !== 'object') return 'unknown';
  const e = error as ClassifiableError;

  const code = String(e.code ?? '').toUpperCase();
  if (
    code.includes('ECONNREFUSED') || code.includes('ECONNRESET') || code.includes('ENOTFOUND') ||
    code.includes('EAI_AGAIN') || code.includes('EPIPE') || code.includes('ETIMEDOUT') ||
    code.includes('ERR_NETWORK') || code.includes('EHOSTUNREACH') || code.includes('ENETUNREACH')
  ) {
    return 'network';
  }

  if (
    e.name === 'AbortError' || code.includes('ABORT') || code.includes('TIMEOUT') ||
    (e.message || '').toLowerCase().includes('timed out') ||
    (e.message || '').toLowerCase().includes('timeout')
  ) {
    return 'timeout';
  }

  const status = e.status ?? e.statusCode ?? e.response?.status;
  if (typeof status === 'number') {
    if (status === 429) return 'rate_limited';
    if (status === 401 || status === 403) return 'auth';
    if (status === 400 || status === 422) return 'schema';
    if (status >= 500) return 'server';
    if (status >= 400) return 'client_permanent';
  }

  if ((e.message || '').toLowerCase().includes('schema') || (e.message || '').toLowerCase().includes('validation')) {
    return 'schema';
  }

  return 'unknown';
}

/** Indica se a classificação permite retry (assumindo operação idempotente). */
export function isRetryableClassification(classification: RetryClassification): boolean {
  return classification === 'network' || classification === 'timeout' ||
    classification === 'rate_limited' || classification === 'server';
}

/** Extrai Retry-After (segundos ou HTTP date) em ms. Retorna undefined se ausente/inválido. */
export function parseRetryAfterMs(value: unknown, nowMs = Date.now()): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.min(value * 1000, 60000);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const seconds = Number(trimmed);
    if (trimmed !== '' && Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 60000);
    }
    const dateMs = Date.parse(trimmed);
    if (!Number.isNaN(dateMs)) {
      return Math.max(0, Math.min(dateMs - nowMs, 60000));
    }
  }
  return undefined;
}

/** Backoff exponencial com jitter: base * 2^(attempt-1), limitado, ±jitter. */
export function computeRetryDelayMs(
  attempt: number,
  baseMs = DEFAULTS.baseDelayMs,
  maxMs = DEFAULTS.maxDelayMs,
  jitterRatio = DEFAULTS.jitterRatio,
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const exponential = baseMs * 2 ** (safeAttempt - 1);
  const capped = Math.min(exponential, maxMs);
  const jitter = capped * jitterRatio * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryResult<T> {
  value?: T;
  error?: unknown;
  attempts: number;
  exhausted: boolean;
}

/**
 * Executa fn com retries limitados. Não lança: retorna { value } ou { error, exhausted: true }.
 * Para operações não-idempotentes (idempotent=false), apenas a primeira tentativa executa;
 * erros de rede/timeout pré-resposta ainda podem retentar se o caller garantir que nada foi enviado.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryPolicyOptions = {},
  getRetryAfter?: (error: unknown) => unknown,
): Promise<RetryResult<T>> {
  const maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;
  const baseMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const jitter = options.jitterRatio ?? DEFAULTS.jitterRatio;
  const idempotent = options.idempotent ?? true;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    try {
      const value = await fn(attempt);
      return { value, attempts: attempt, exhausted: false };
    } catch (error) {
      const classification = classifyRetryError(error);
      const retryable = isRetryableClassification(classification);
      const canRetry = retryable && (idempotent || classification === 'network' || classification === 'timeout') && attempt <= maxRetries;

      if (!canRetry) {
        return { error, attempts: attempt, exhausted: true };
      }

      const retryAfterMs = getRetryAfter ? parseRetryAfterMs(getRetryAfter(error)) : undefined;
      const delayMs = retryAfterMs ?? computeRetryDelayMs(attempt, baseMs, maxMs, jitter);
      options.onRetry?.({ attempt, classification, delayMs, error });
      await sleep(delayMs);
    }
  }
}
