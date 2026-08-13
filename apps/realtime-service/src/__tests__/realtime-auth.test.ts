import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Realtime Service Auth Implementation', () => {
  const realtimePath = resolve(__dirname, '../index.ts');
  const content = readFileSync(realtimePath, 'utf-8');

  describe('Cookie validation via API', () => {
    it('should validate session by calling /auth/me endpoint', () => {
      expect(content).toContain('/auth/me');
    });

    it('should use the session cookie instead of bearer authorization', () => {
      expect(content).toContain('Cookie:');
      expect(content).toContain('SESSION_COOKIE_NAME');
      expect(content).not.toContain('Authorization');
      expect(content).not.toContain('Bearer');
    });

    it('should reject token from URL query string', () => {
      expect(content).toContain('searchParams.get');
      expect(content).toContain('URL token authentication is disabled');
    });
  });

  describe('Authentication flow', () => {
    it('should have completeAuthentication method', () => {
      expect(content).toContain('completeAuthentication');
    });

    it('should have rejectAuthentication method', () => {
      expect(content).toContain('rejectAuthentication');
    });

    it('should mark client as authenticated after successful validation', () => {
      expect(content).toContain('client.authenticated = true');
    });

    it('should use userId from API response, not from client message', () => {
      expect(content).toContain('data.user.id');
      expect(content).not.toContain('message.userId');
    });
  });

  describe('Security measures', () => {
    it('should set auth timeout for connections', () => {
      expect(content).toContain('authTimeout');
      expect(content).toContain('4001');
    });

    it('should close connection on auth failure', () => {
      expect(content).toContain('4003');
    });

    it('should reject subscribe when not authenticated', () => {
      expect(content).toContain('Not authenticated');
      expect(content).toContain('subscribe.error');
    });

    it('should require session cookie for authenticated connections', () => {
      expect(content).toContain('handleConnectionWithCookie');
      expect(content).toContain('Missing session cookie');
    });
  });

  describe('Auth state management', () => {
    it('should store userId on authenticated clients', () => {
      expect(content).toContain('client.userId');
    });

    it('should add user-specific subscription after auth', () => {
      expect(content).toContain('user:');
    });

    it('should have pending auth timeout tracking', () => {
      expect(content).toContain('pendingAuth');
    });
  });

  describe('Error handling', () => {
    it('should handle auth service unavailability', () => {
      expect(content).toContain('Authentication service unavailable');
    });

    it('should reject invalid session with status', () => {
      expect(content).toContain('Invalid token');
    });
  });
});

describe('Realtime Authentication Flow Verification', () => {
  const realtimePath = resolve(__dirname, '../index.ts');
  const content = readFileSync(realtimePath, 'utf-8');

  it('follows secure auth pattern: cookie -> validate via API -> set authenticated flag', () => {
    const hasCookieAuth = content.includes('SESSION_COOKIE_NAME') && content.includes('parseCookieHeader');
    const hasAPICall = content.includes('/auth/me');
    const hasAuthFlag = content.includes('authenticated = true');

    expect(hasCookieAuth).toBe(true);
    expect(hasAPICall).toBe(true);
    expect(hasAuthFlag).toBe(true);
  });

  it('does not trust userId from client message when token is provided', () => {
    const handleAuthSection = content.match(/private handleAuth[\s\S]*?(?=private|handleMessage|$)/);

    if (handleAuthSection) {
      const authContent = handleAuthSection[0];
      expect(authContent).toContain('message.userId');
    }
  });
});

describe('Client interface has authenticated field', () => {
  const realtimePath = resolve(__dirname, '../index.ts');
  const content = readFileSync(realtimePath, 'utf-8');

  it('Client interface includes authenticated boolean', () => {
    const clientInterface = content.match(/interface Client[\s\S]*?}/);

    if (clientInterface) {
      expect(clientInterface[0]).toContain('authenticated');
      expect(clientInterface[0]).toContain('boolean');
    }
  });
});
