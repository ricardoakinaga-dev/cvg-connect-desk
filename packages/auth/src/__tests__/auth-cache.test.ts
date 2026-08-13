import { beforeEach, describe, expect, it } from 'vitest';
import {
  cacheAuthUser,
  clearAuthCache,
  getCachedAuthUser,
  invalidateAuthCacheToken,
} from '../auth-cache';

const user = {
  id: 'user-1',
  email: 'user@example.test',
  name: 'User',
  roles: ['Admin'],
};

describe('auth-cache', () => {
  const originalTtl = process.env.AUTH_CACHE_TTL_MS;

  beforeEach(() => {
    clearAuthCache();
    process.env.AUTH_CACHE_TTL_MS = originalTtl;
  });

  it('caches and invalidates authenticated users by token', () => {
    cacheAuthUser('token-1', user);

    expect(getCachedAuthUser('token-1')).toEqual(user);

    invalidateAuthCacheToken('token-1');
    expect(getCachedAuthUser('token-1')).toBeNull();
  });

  it('expires entries by cache TTL and session expiry', () => {
    process.env.AUTH_CACHE_TTL_MS = '0';
    cacheAuthUser('token-ttl-disabled', user);
    expect(getCachedAuthUser('token-ttl-disabled')).toBeNull();

    process.env.AUTH_CACHE_TTL_MS = '30000';
    cacheAuthUser('token-expired-session', user, new Date(Date.now() - 1));
    expect(getCachedAuthUser('token-expired-session')).toBeNull();
  });
});
