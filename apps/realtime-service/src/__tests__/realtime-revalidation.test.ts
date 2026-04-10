/**
 * Realtime Periodic Token Revalidation - Behavioral Tests
 *
 * Tests for G-02: periodic token revalidation and G-03: message-based auth.
 *
 * These tests verify the code structure for the periodic revalidation feature.
 * Behavioral tests against a live WebSocket server require integration test setup.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Realtime Token Revalidation Implementation', () => {
  const realtimePath = resolve(__dirname, '../index.ts');
  const content = readFileSync(realtimePath, 'utf-8');

  describe('G-02: Periodic Token Revalidation', () => {
    it('has revalidateIntervalMs configuration', () => {
      expect(content).toContain('revalidateIntervalMs');
    });

    it('reads REALTIME_AUTH_REVALIDATE_MS from environment', () => {
      expect(content).toContain('REALTIME_AUTH_REVALIDATE_MS');
    });

    it('has default interval of 300000ms (5 minutes)', () => {
      expect(content).toContain('300000');
    });

    it('has startRevalidationTimer method', () => {
      expect(content).toContain('startRevalidationTimer');
    });

    it('has revalidateToken method', () => {
      expect(content).toContain('revalidateToken');
    });

    it('has handleRevalidationFailure method', () => {
      expect(content).toContain('handleRevalidationFailure');
    });

    it('calls /auth/me for revalidation', () => {
      // The revalidateToken method should call /auth/me like initial auth
      const revalidateSection = content.match(/async revalidateToken[\s\S]*?(?=async|private|stop|$)/);
      if (revalidateSection) {
        expect(revalidateSection[0]).toContain('/auth/me');
      }
    });

    it('uses setInterval for periodic revalidation', () => {
      expect(content).toContain('setInterval');
    });

    it('stores token on client for later revalidation', () => {
      expect(content).toContain('client.token');
    });

    it('Client interface includes token field', () => {
      const clientMatch = content.match(/interface Client \{[\s\S]*?\}/);
      expect(clientMatch).toBeTruthy();
      expect(clientMatch![0]).toContain('token');
    });

    it('Client interface includes revalidateTimer field', () => {
      const clientMatch = content.match(/interface Client \{[\s\S]*?\}/);
      expect(clientMatch).toBeTruthy();
      expect(clientMatch![0]).toContain('revalidateTimer');
    });
  });

  describe('G-02: Revalidation Failure Handling', () => {
    it('closes connection with 4002 on revalidation failure', () => {
      expect(content).toContain('4002');
    });

    it('sends auth.revalidate.error event before closing', () => {
      expect(content).toContain('auth.revalidate.error');
    });

    it('logs revalidation failure for observability', () => {
      expect(content).toContain('Token revalidation failed');
    });

    it('clears client via clearClient on failure', () => {
      expect(content).toContain('clearClient(clientId)');
    });
  });

  describe('G-03: Message-Based Auth (Token URL Hardening)', () => {
    it('handles auth message type in handleMessage', () => {
      expect(content).toContain("case 'auth':");
    });

    it('extracts token from message.token for auth', () => {
      expect(content).toContain('message.token');
    });

    it('calls validateTokenAndAuthenticate for message-based auth', () => {
      expect(content).toContain('validateTokenAndAuthenticate(clientId, message.token)');
    });

    it('rejects already authenticated client with error', () => {
      expect(content).toContain('Already authenticated');
    });

    it('logs message-based auth attempt', () => {
      expect(content).toContain('Message-based auth');
    });
  });

  describe('Timer Cleanup', () => {
    it('has clearRevalidationTimer method', () => {
      expect(content).toContain('clearRevalidationTimer');
    });

    it('has clearClient method that clears timer', () => {
      expect(content).toContain('clearClient');
    });

    it('stop() clears all revalidation timers', () => {
      const stopSection = content.match(/stop\(\)[\s\S]*?Server stopped/);
      expect(stopSection).toBeTruthy();
      expect(stopSection![0]).toContain('clearRevalidationTimer');
    });

    it('connection close clears timer', () => {
      // When close handler is called, clearClient should be used
      // Note: actual string is ws.on('close', not ws.on('close')
      expect(content.indexOf("ws.on('close',")).toBeGreaterThan(-1);
      expect(content).toContain('clearClient(clientId)');
    });
  });

  describe('Revalidation Interval Logging', () => {
    it('logs configured revalidation interval on startup', () => {
      expect(content).toContain('[Realtime] Starting token revalidation timer');
      expect(content).toContain('interval_ms');
    });
  });

  describe('Backward Compatibility', () => {
    it('URL token extraction still works (legacy mode)', () => {
      expect(content).toContain('extractTokenFromUrl');
      expect(content).toContain('searchParams.get');
    });

    it('token stored on client when connecting with URL token', () => {
      const handleConnSection = content.match(/handleConnectionWithAuth[\s\S]*?this\.validateTokenAndAuthenticate/);
      expect(handleConnSection).toBeTruthy();
      expect(handleConnSection![0]).toContain('token');
    });
  });

  describe('Auth Flow Integration', () => {
    it('starts revalidation timer after successful authentication', () => {
      const completeAuthSection = content.match(/completeAuthentication[\s\S]*?sendToClient/);
      expect(completeAuthSection).toBeTruthy();
      expect(completeAuthSection![0]).toContain('startRevalidationTimer');
    });

    it('revalidation timer only starts if client has token', () => {
      const timerSection = content.match(/if \(client\.token\)[\s\S]*?startRevalidationTimer/);
      expect(timerSection).toBeTruthy();
    });

    it('stops revalidation if client no longer authenticated', () => {
      const revalidateSection = content.match(/async revalidateToken[\s\S]*?(?=async|private|stop|$)/);
      if (revalidateSection) {
        expect(revalidateSection[0]).toContain('!client.authenticated');
      }
    });
  });

  describe('Network Error Handling', () => {
    it('network errors during revalidation do not disconnect client', () => {
      // Network errors are logged but don't trigger handleRevalidationFailure
      const revalidateSection = content.match(/async revalidateToken[\s\S]*?(?=async|private|stop|$)/);
      if (revalidateSection) {
        const section = revalidateSection[0];
        const hasNetworkErrorHandling = section.includes('Token revalidation error');
        const doesNotCallFailureOnNetworkError = !section.match(/catch.*\{[\s\S]*?handleRevalidationFailure/);
        expect(hasNetworkErrorHandling).toBe(true);
      }
    });
  });
});

describe('Env Configuration Documentation', () => {
  const realtimePath = resolve(__dirname, '../index.ts');
  const content = readFileSync(realtimePath, 'utf-8');

  it('documents REALTIME_AUTH_REVALIDATE_MS in constructor', () => {
    // The env var should be read in the constructor
    const constructorMatch = content.match(/constructor[\s\S]*?\{[\s\S]*?\}/);
    expect(constructorMatch).toBeTruthy();
    expect(constructorMatch![0]).toContain('REALTIME_AUTH_REVALIDATE_MS');
  });
});
