import { describe, it, expect, vi } from 'vitest';
import {
  classifyRetryError,
  computeRetryDelayMs,
  isRetryableClassification,
  parseRetryAfterMs,
  withRetry,
} from '../retry-policy';

describe('retry-policy classification', () => {
  it('classifies network errors as retryable', () => {
    for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT']) {
      const error = Object.assign(new Error('net fail'), { code });
      expect(classifyRetryError(error)).toBe('network');
      expect(isRetryableClassification('network')).toBe(true);
    }
  });

  it('classifies timeouts (incl. AbortError) as retryable', () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(classifyRetryError(abort)).toBe('timeout');
    expect(isRetryableClassification('timeout')).toBe(true);
  });

  it('classifies 429 and 5xx as retryable', () => {
    expect(classifyRetryError({ status: 429 })).toBe('rate_limited');
    expect(classifyRetryError({ status: 503 })).toBe('server');
    expect(classifyRetryError({ response: { status: 500 } })).toBe('server');
    expect(isRetryableClassification('rate_limited')).toBe(true);
    expect(isRetryableClassification('server')).toBe(true);
  });

  it('never retries auth, schema or permanent client errors', () => {
    expect(classifyRetryError({ status: 401 })).toBe('auth');
    expect(classifyRetryError({ status: 403 })).toBe('auth');
    expect(classifyRetryError({ status: 400 })).toBe('schema');
    expect(classifyRetryError({ status: 404 })).toBe('client_permanent');
    expect(isRetryableClassification('auth')).toBe(false);
    expect(isRetryableClassification('schema')).toBe(false);
    expect(isRetryableClassification('client_permanent')).toBe(false);
    expect(isRetryableClassification('unknown')).toBe(false);
  });

  it('handles non-string error codes without throwing (ex: undici AbortError code=20)', () => {
    const abortLike = Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 20 });
    expect(classifyRetryError(abortLike)).toBe('timeout');
    expect(classifyRetryError({ code: { nested: true } })).toBe('unknown');
    expect(classifyRetryError(null)).toBe('unknown');
    expect(classifyRetryError('plain string')).toBe('unknown');
  });
});

describe('parseRetryAfterMs', () => {
  it('parses seconds and caps at 60s', () => {
    expect(parseRetryAfterMs('2')).toBe(2000);
    expect(parseRetryAfterMs(5)).toBe(5000);
    expect(parseRetryAfterMs('3600')).toBe(60000);
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
    expect(parseRetryAfterMs('garbage')).toBeUndefined();
  });

  it('parses HTTP dates', () => {
    const future = new Date(Date.now() + 10000).toUTCString();
    const parsed = parseRetryAfterMs(future);
    expect(parsed).toBeGreaterThan(0);
    expect(parsed).toBeLessThanOrEqual(60000);
  });
});

describe('computeRetryDelayMs', () => {
  it('grows exponentially within cap (jitter=0 for determinism)', () => {
    expect(computeRetryDelayMs(1, 1000, 30000, 0)).toBe(1000);
    expect(computeRetryDelayMs(2, 1000, 30000, 0)).toBe(2000);
    expect(computeRetryDelayMs(3, 1000, 30000, 0)).toBe(4000);
    expect(computeRetryDelayMs(10, 1000, 30000, 0)).toBe(30000);
  });
});

describe('withRetry', () => {
  it('returns value on first success without retry', async () => {
    const onRetry = vi.fn();
    const result = await withRetry(async () => 'ok', { onRetry });
    expect(result).toMatchObject({ value: 'ok', attempts: 1, exhausted: false });
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('retries retryable errors up to maxRetries then exhausts', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        throw Object.assign(new Error('boom'), { status: 503 });
      },
      { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2, jitterRatio: 0 },
    );
    expect(calls).toBe(3);
    expect(result.attempts).toBe(3);
    expect(result.exhausted).toBe(true);
    expect(result.error).toBeInstanceOf(Error);
  });

  it('does not retry permanent errors', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        throw Object.assign(new Error('bad'), { status: 400 });
      },
      { maxRetries: 3, baseDelayMs: 1 },
    );
    expect(calls).toBe(1);
    expect(result.exhausted).toBe(true);
  });

  it('recovers when a later attempt succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw Object.assign(new Error('flaky'), { code: 'ECONNRESET' });
        return 'recovered';
      },
      { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 2, jitterRatio: 0 },
    );
    expect(result).toMatchObject({ value: 'recovered', attempts: 3, exhausted: false });
  });

  it('honors Retry-After header when provided', async () => {
    const delays: number[] = [];
    await withRetry(
      async () => {
        throw Object.assign(new Error('slow down'), {
          status: 429,
          response: { status: 429, headers: { 'retry-after': '1' } },
        });
      },
      {
        maxRetries: 1,
        baseDelayMs: 1,
        onRetry: (info) => delays.push(info.delayMs),
      },
      (error) => (error as { response?: { headers?: Record<string, string> } }).response?.headers?.['retry-after'],
    );
    expect(delays).toHaveLength(1);
    expect(delays[0]).toBe(1000);
  });
});
