import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SESSION_POLICY,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_TTL_MS,
  evaluateSession,
  resolveSessionDeadlines,
  type SessionLike,
  type UserLike,
} from '../session-policy';

const NOW = new Date('2026-09-12T12:00:00.000Z');

function session(overrides: Partial<SessionLike> = {}): SessionLike {
  return {
    id: 'session-1',
    userId: 'user-1',
    createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
    absoluteExpiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    lastSeenAt: new Date(NOW.getTime() - 60 * 1000),
    revokedAt: null,
    ...overrides,
  };
}

function user(overrides: Partial<UserLike> = {}): UserLike {
  return {
    id: 'user-1',
    email: 'user@example.com',
    name: 'User',
    isActive: true,
    ...overrides,
  };
}

describe('session-policy — defaults congelados (C01)', () => {
  it('usa 7d normal, 30d absoluto e 24h idle como default', () => {
    expect(SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(SESSION_ABSOLUTE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(DEFAULT_SESSION_POLICY).toEqual({
      normalTtlMs: 7 * 24 * 60 * 60 * 1000,
      absoluteTtlMs: 30 * 24 * 60 * 60 * 1000,
      idleTimeoutMs: 24 * 60 * 60 * 1000,
    });
  });
});

describe('session-policy — avaliação canônica', () => {
  it('aceita sessão válida e devolve principal com papéis', () => {
    const result = evaluateSession(session(), user(), NOW, DEFAULT_SESSION_POLICY, ['admin']);
    expect(result).toEqual({
      ok: true,
      principal: { id: 'user-1', email: 'user@example.com', name: 'User', roles: ['admin'] },
    });
  });

  it('nega sessão ausente como Invalid token', () => {
    expect(evaluateSession(null, user(), NOW)).toMatchObject({ ok: false, message: 'Invalid token' });
  });

  it('nega sessão revogada antes de qualquer prazo (ordem fixa)', () => {
    const revoked = session({ revokedAt: NOW, expiresAt: new Date(NOW.getTime() - 1000) });
    expect(evaluateSession(revoked, user(), NOW)).toMatchObject({ ok: false, reason: 'invalid_token' });
  });

  it('aplica default-deny no limite exato da validade normal', () => {
    const exact = session({ expiresAt: new Date(NOW.getTime()) });
    expect(evaluateSession(exact, user(), NOW)).toMatchObject({ ok: false, reason: 'expired' });

    const oneMsBefore = session({ expiresAt: new Date(NOW.getTime() - 1) });
    expect(evaluateSession(oneMsBefore, user(), NOW)).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('aceita enquanto now < expiresAt', () => {
    const valid = session({ expiresAt: new Date(NOW.getTime() + 1) });
    expect(evaluateSession(valid, user(), NOW).ok).toBe(true);
  });

  it('aplica default-deny no limite exato do prazo absoluto', () => {
    const exact = session({ absoluteExpiresAt: new Date(NOW.getTime()) });
    expect(evaluateSession(exact, user(), NOW)).toMatchObject({ ok: false, reason: 'absolute_expired' });
  });

  it('aplica default-deny no limite exato do idle de 24h', () => {
    const exact = session({ lastSeenAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000) });
    expect(evaluateSession(exact, user(), NOW)).toMatchObject({ ok: false, reason: 'idle' });

    const oneMsLess = session({ lastSeenAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000 + 1) });
    expect(evaluateSession(oneMsLess, user(), NOW).ok).toBe(true);
  });

  it('nega usuário inexistente ou inativo depois dos prazos', () => {
    expect(evaluateSession(session(), null, NOW)).toMatchObject({ ok: false, reason: 'inactive_user' });
    expect(evaluateSession(session(), user({ isActive: false }), NOW)).toMatchObject({
      ok: false,
      reason: 'inactive_user',
    });
  });

  it('nega quando os prazos não podem ser resolvidos (created_at ausente)', () => {
    const orphan = session({ createdAt: null, expiresAt: null, absoluteExpiresAt: null, lastSeenAt: null });
    expect(evaluateSession(orphan, user(), NOW)).toMatchObject({ ok: false, reason: 'invalid_token' });
  });
});

describe('session-policy — limites exatos e rotação (reforço C01)', () => {
  it('nega no instante exato em que normal e absoluto coincidem (ordem determinística)', () => {
    const exact = session({
      expiresAt: new Date(NOW.getTime()),
      absoluteExpiresAt: new Date(NOW.getTime()),
      lastSeenAt: new Date(NOW.getTime()),
    });
    expect(evaluateSession(exact, user(), NOW)).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('lastSeenAt futuro não estende o deadline absoluto', () => {
    const exactAbsolute = session({
      expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
      absoluteExpiresAt: new Date(NOW.getTime()),
      lastSeenAt: new Date(NOW.getTime() + 60_000),
    });
    expect(evaluateSession(exactAbsolute, user(), NOW)).toMatchObject({ ok: false, reason: 'absolute_expired' });
  });

  it('idle exato nega mesmo com normal/absoluto futuros', () => {
    const exactIdle = session({
      expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
      absoluteExpiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
      lastSeenAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
    });
    expect(evaluateSession(exactIdle, user(), NOW)).toMatchObject({ ok: false, reason: 'idle' });
  });

  it('resolveSessionDeadlines preserva o absoluto persistido (rotação não recalcula)', () => {
    const persisted = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000);
    const deadlines = resolveSessionDeadlines(
      session({ absoluteExpiresAt: persisted }),
      new Date('2030-01-01T00:00:00.000Z'),
    );
    expect(deadlines.absoluteExpiresAt!.getTime()).toBe(persisted.getTime());
  });

  it('normal nulo com absoluto derivado do created_at nunca usa o relógio atual', () => {
    const createdAt = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000);
    const deadlines = resolveSessionDeadlines(session({ createdAt, expiresAt: null }), NOW);
    expect(deadlines.expiresAt!.getTime()).toBe(createdAt.getTime() + SESSION_TTL_MS);
  });
});

describe('session-policy — fallback e materialização de sessão legada', () => {
  it('deriva prazos e idle do created_at quando os campos são nulos', () => {
    const createdAt = new Date(NOW.getTime() - 60 * 60 * 1000);
    const legacy = session({ createdAt, expiresAt: null, absoluteExpiresAt: null, lastSeenAt: null });

    const deadlines = resolveSessionDeadlines(legacy, NOW);
    expect(deadlines.expiresAt!.getTime()).toBe(createdAt.getTime() + SESSION_TTL_MS);
    expect(deadlines.absoluteExpiresAt!.getTime()).toBe(createdAt.getTime() + SESSION_ABSOLUTE_TTL_MS);
    expect(deadlines.lastSeenAt!.getTime()).toBe(createdAt.getTime());
  });

  it('não reinicia o absoluto quando legado é avaliado depois', () => {
    const createdAt = new Date(NOW.getTime() - 29 * 24 * 60 * 60 * 1000);
    const legacy = session({ createdAt, expiresAt: null, absoluteExpiresAt: null, lastSeenAt: NOW });
    const deadlines = resolveSessionDeadlines(legacy, NOW);
    expect(deadlines.absoluteExpiresAt!.getTime()).toBe(createdAt.getTime() + SESSION_ABSOLUTE_TTL_MS);
  });

  it('legado com normal derivado vencido é negado antes de checar o absoluto', () => {
    const createdAt = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000);
    const legacy = session({ createdAt, expiresAt: null, absoluteExpiresAt: null, lastSeenAt: NOW });
    expect(evaluateSession(legacy, user(), NOW)).toMatchObject({ ok: false, reason: 'expired' });
  });
});
