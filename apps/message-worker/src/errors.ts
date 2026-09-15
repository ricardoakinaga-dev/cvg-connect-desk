import { AppError } from '@cvg/shared';

/**
 * Falha permanente de handler (poison/malformed/versão não suportada/4xx).
 * `permanent = true` é lido por `isPermanentError` do @cvg/events e leva o
 * evento direto para DLQ com `errorCode` — sem consumir o orçamento de retry.
 */
export class PermanentEventError extends Error {
  readonly permanent = true;
  readonly errorCode: string;

  constructor(errorCode: string, message: string) {
    super(message);
    this.name = 'PermanentEventError';
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, PermanentEventError.prototype);
  }
}

/** Erro de domínio que já se declara permanente/classificável (ex.: PROD-10). */
function isPermanentDomainError(error: unknown): error is { permanent: true; errorCode: string; message: string } {
  const candidate = error as { permanent?: unknown; errorCode?: unknown } | null;
  return (
    typeof candidate === 'object'
    && candidate !== null
    && candidate.permanent === true
    && typeof candidate.errorCode === 'string'
  );
}

/** Converte erros de domínio em erro classificável pelo processador. */
export function classifyHandlerError(error: unknown): Error {
  if (error instanceof PermanentEventError) return error;
  if (isPermanentDomainError(error)) {
    return new PermanentEventError(error.errorCode, error.message);
  }
  if (error instanceof AppError) {
    const retryable = error.statusCode === 429 || error.statusCode >= 500;
    if (retryable) return error;
    return new PermanentEventError('EFFECT_REJECTED', `${error.code}: ${error.message}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

export function permanentErrorCodeOf(error: unknown): string | undefined {
  return error instanceof PermanentEventError ? error.errorCode : undefined;
}

/**
 * Descrição estável do erro para retry/DLQ. Inclui a `cause` quando existir —
 * o wrapper do driver (Drizzle) coloca a mensagem real do PostgreSQL (ex.:
 * trigger/violação) em `cause`, e sem isso a DLQ perderia a causa observável.
 */
export function describeError(error: unknown): string {
  const err = error as (Error & { cause?: unknown }) | undefined;
  const base = err instanceof Error ? err.message : String(error);
  const cause = err?.cause;
  if (cause instanceof Error && cause.message && !base.includes(cause.message)) {
    return `${base} (causa: ${cause.message})`;
  }
  return base;
}

/**
 * Versão do erro segura para LOG: remove `params:` (o wrapper do driver
 * interpola valores do payload na mensagem) e limita o tamanho. A causa
 * completa continua no registro durável (DLQ/ack), que é auditável; logs não
 * carregam conteúdo de payload (AC4, sem PII).
 */
export function redactErrorForLog(error: string, maxLength = 240): string {
  const firstLine = error.split('\n')[0] ?? '';
  const paramsIndex = firstLine.indexOf('params:');
  const withoutParams = (paramsIndex >= 0 ? firstLine.slice(0, paramsIndex) : firstLine).trim();
  return withoutParams.length > maxLength ? `${withoutParams.slice(0, maxLength)}…` : withoutParams;
}
