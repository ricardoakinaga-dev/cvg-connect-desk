import type { FastifyRequest } from 'fastify';
import { hashSessionToken } from './session-token';

type AuthUser = NonNullable<FastifyRequest['user']>;

interface CachedAuthUser {
  user: AuthUser;
  expiresAtMs: number;
  sessionExpiresAtMs?: number;
}

const DEFAULT_AUTH_CACHE_TTL_MS = 30_000;
const MAX_AUTH_CACHE_ENTRIES = 1_000;
const authCache = new Map<string, CachedAuthUser>();

function getAuthCacheTtlMs(): number {
  const configured = Number(process.env.AUTH_CACHE_TTL_MS || '');
  if (Number.isFinite(configured) && configured >= 0) {
    return configured;
  }
  return DEFAULT_AUTH_CACHE_TTL_MS;
}

export function clearAuthCache(): void {
  authCache.clear();
}

export function invalidateAuthCacheToken(token: string): void {
  authCache.delete(hashSessionToken(token));
}

export function getCachedAuthUser(token: string): AuthUser | null {
  const cached = authCache.get(hashSessionToken(token));
  if (!cached) {
    return null;
  }

  const now = Date.now();
  if (cached.expiresAtMs <= now || (cached.sessionExpiresAtMs !== undefined && cached.sessionExpiresAtMs <= now)) {
    authCache.delete(token);
    return null;
  }

  return cached.user;
}

export function cacheAuthUser(token: string, user: AuthUser, sessionExpiresAt?: Date | string | null): void {
  const ttlMs = getAuthCacheTtlMs();
  if (ttlMs <= 0) {
    return;
  }

  if (authCache.size >= MAX_AUTH_CACHE_ENTRIES) {
    authCache.clear();
  }

  const sessionExpiresAtMs = sessionExpiresAt ? new Date(sessionExpiresAt).getTime() : undefined;
  authCache.set(hashSessionToken(token), {
    user,
    expiresAtMs: Date.now() + ttlMs,
    ...(Number.isFinite(sessionExpiresAtMs) && { sessionExpiresAtMs }),
  });
}
