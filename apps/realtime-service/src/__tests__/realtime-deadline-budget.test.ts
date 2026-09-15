import { afterEach, describe, expect, it } from 'vitest';
import { RealtimeServer } from '../index.ts';

/**
 * AAA-05 — orçamento do deadline de revogação (C02 D-C02-7 / C00).
 *
 * Prova, nos valores de fronteira aceitos, que a configuração computada mantém
 * `cacheAge + sessionFetch + authzFetch <= 5000` e
 * `revalidateInterval + sessionFetch + authzFetch <= 5000`, mesmo com env
 * adversarial (`REALTIME_AUTH_TIMEOUT_MS=5000`, interval/cache 300000).
 */

const DEADLINE_MS = 5000;
const ENV_KEYS = ['REALTIME_AUTH_TIMEOUT_MS', 'REALTIME_AUTH_REVALIDATE_MS', 'REALTIME_AUTHZ_CACHE_MS'];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

interface Budget {
  authFetchTimeoutMs: number;
  authorizationCacheMaxAgeMs: number;
  revalidateIntervalMs: number;
}

function budgetOf(server: RealtimeServer): Budget {
  return server as unknown as Budget;
}

function assertBudget(budget: Budget): void {
  expect(budget.authFetchTimeoutMs).toBeGreaterThanOrEqual(50);
  expect(budget.authFetchTimeoutMs).toBeLessThanOrEqual(2375);
  expect(budget.authorizationCacheMaxAgeMs).toBeGreaterThanOrEqual(250);
  expect(budget.revalidateIntervalMs).toBeGreaterThanOrEqual(250);
  expect(budget.authorizationCacheMaxAgeMs + 2 * budget.authFetchTimeoutMs).toBeLessThanOrEqual(DEADLINE_MS);
  expect(budget.revalidateIntervalMs + 2 * budget.authFetchTimeoutMs).toBeLessThanOrEqual(DEADLINE_MS);
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('AAA-05 deadline budget', () => {
  it('defaults (timeout 1500) keep cache and interval at 2000 with total 5000', () => {
    delete process.env.REALTIME_AUTH_TIMEOUT_MS;
    delete process.env.REALTIME_AUTH_REVALIDATE_MS;
    delete process.env.REALTIME_AUTHZ_CACHE_MS;

    const budget = budgetOf(new RealtimeServer(0));

    expect(budget.authFetchTimeoutMs).toBe(1500);
    expect(budget.authorizationCacheMaxAgeMs).toBe(2000);
    expect(budget.revalidateIntervalMs).toBe(2000);
    assertBudget(budget);
  });

  it('boundary timeout=5000 clamps timeout to 2375 and cache/interval to 250 (total exactly 5000)', () => {
    const budget = budgetOf(new RealtimeServer(0, {
      authFetchTimeoutMs: 5000,
      authorizationCacheMaxAgeMs: 300000,
      authRevalidateIntervalMs: 300000,
    }));

    expect(budget.authFetchTimeoutMs).toBe(2375);
    expect(budget.authorizationCacheMaxAgeMs).toBe(250);
    expect(budget.revalidateIntervalMs).toBe(250);
    expect(budget.authorizationCacheMaxAgeMs + 2 * budget.authFetchTimeoutMs).toBe(DEADLINE_MS);
    expect(budget.revalidateIntervalMs + 2 * budget.authFetchTimeoutMs).toBe(DEADLINE_MS);
  });

  it('bad env (interval 300000 + timeout 5000 + cache 300000) stays within the deadline', () => {
    process.env.REALTIME_AUTH_TIMEOUT_MS = '5000';
    process.env.REALTIME_AUTH_REVALIDATE_MS = '300000';
    process.env.REALTIME_AUTHZ_CACHE_MS = '300000';

    const budget = budgetOf(new RealtimeServer(0));

    expect(budget.authFetchTimeoutMs).toBe(2375);
    expect(budget.revalidateIntervalMs).toBe(250);
    expect(budget.authorizationCacheMaxAgeMs).toBe(250);
    assertBudget(budget);
  });

  it('every accepted timeout value keeps sequential-fetch totals <= 5000', () => {
    for (const timeout of [0, 1, 50, 100, 1500, 2000, 2374, 2375, 2376, 3000, 10000, Number.NaN]) {
      const budget = budgetOf(new RealtimeServer(0, {
        authFetchTimeoutMs: timeout,
        authorizationCacheMaxAgeMs: 999999,
        authRevalidateIntervalMs: 999999,
      }));
      assertBudget(budget);
    }
  });
});
