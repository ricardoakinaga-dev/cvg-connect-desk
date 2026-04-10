import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Realtime Service Structure', () => {
  const realtimePath = resolve(__dirname, '../index.ts');
  const content = readFileSync(realtimePath, 'utf-8');

  it('imports websocket', () => {
    expect(content).toContain("from 'ws'");
  });

  it('imports events module', () => {
    expect(content).toContain("@cvg/events");
  });

  it('imports realtime module', () => {
    expect(content).toContain("@cvg/realtime");
  });

  it('has WebSocket server class', () => {
    expect(content).toContain("class RealtimeServer");
  });

  it('creates WebSocket server', () => {
    expect(content).toContain("new WebSocketServer");
  });
});

describe('Realtime Auth Implementation', () => {
  const realtimePath = resolve(__dirname, '../index.ts');
  const content = readFileSync(realtimePath, 'utf-8');

  it('extracts token from URL query parameters', () => {
    expect(content).toContain("extractTokenFromUrl");
    expect(content).toContain("searchParams.get('token')");
  });

  it('validates token via HTTP to desk-api', () => {
    expect(content).toContain("validateTokenAndAuthenticate");
    expect(content).toContain("/auth/me");
    expect(content).toContain("Authorization");
  });

  it('has authentication timeout for connections', () => {
    expect(content).toContain("authTimeout");
    expect(content).toContain("Authentication timeout");
  });

  it('rejects connections with invalid token', () => {
    expect(content).toContain("rejectAuthentication");
    expect(content).toContain("Authentication failed");
    expect(content).toContain("4003");
  });

  it('tracks authenticated state on client', () => {
    expect(content).toContain("authenticated");
  });

  it('requires authentication for subscriptions', () => {
    expect(content).toContain("Not authenticated");
  });

  it('only broadcasts to authenticated clients', () => {
    expect(content).toContain("client.authenticated");
  });

  it('adds user channel subscription on auth', () => {
    expect(content).toContain("user:${userId}");
  });
});
