import type { EventEnvelope } from './envelope';

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface RetryableError extends Error {
  retryable?: boolean;
  permanent?: boolean;
}

export interface RetryContext {
  event: EventEnvelope;
  handlerName: string;
  attempt: number;
  lastError: Error | unknown;
  nextRetryAt?: Date;
}

export type RetryPolicy = (context: RetryContext) => boolean;

export const defaultRetryConfig: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    if ('retryable' in error && (error as RetryableError).retryable === true) {
      return true;
    }
    if ('permanent' in error && (error as RetryableError).permanent === true) {
      return false;
    }
    if (error.message.includes('ECONNREFUSED') || 
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('timeout') ||
        error.message.includes('network')) {
      return true;
    }
  }
  return true;
}

export function isPermanentError(error: unknown): boolean {
  if (error instanceof Error) {
    if ('permanent' in error && (error as RetryableError).permanent === true) {
      return true;
    }
    if ('retryable' in error && (error as RetryableError).retryable === false) {
      return true;
    }
  }
  return false;
}

export function calculateNextDelay(config: RetryConfig, attempt: number): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
  return Math.min(delay, config.maxDelayMs);
}

export function shouldRetry(context: RetryContext, config: RetryConfig): boolean {
  if (isPermanentError(context.lastError)) {
    return false;
  }
  if (context.attempt >= config.maxRetries) {
    return false;
  }
  return isRetryableError(context.lastError);
}

export function createRetryContext(
  event: EventEnvelope,
  handlerName: string,
  attempt: number,
  lastError: unknown
): RetryContext {
  return {
    event,
    handlerName,
    attempt,
    lastError: lastError as Error,
  };
}
