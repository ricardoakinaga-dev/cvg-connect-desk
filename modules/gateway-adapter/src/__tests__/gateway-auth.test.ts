import crypto from 'node:crypto';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const receiveInboundMessage = vi.fn();
const findPendingOutbound = vi.fn();
const markOutboundSent = vi.fn();
const updateReceipt = vi.fn();

vi.mock('../../infrastructure/gateway-service', () => ({
  gatewayService: {
    healthCheck: vi.fn().mockResolvedValue(true),
  },
}));

const { registerGatewayRoutes } = await import('../presentation/http/gateway.controller');
const { setGatewayDeskHandlers } = await import('../application/desk-handlers');
const { buildGatewaySignature, resetGatewayAuthState, setGatewayReplayStore } = await import('../presentation/http/gateway-auth');

const secret = 'gateway-test-secret';

function signedHeaders(
  payload: unknown,
  scope: string,
  nonce: string,
  timestamp = Math.floor(Date.now() / 1000),
) {
  const body = JSON.stringify(payload);
  return {
    'x-gateway-timestamp': String(timestamp),
    'x-gateway-nonce': nonce,
    'x-gateway-scope': scope,
    'x-gateway-signature': buildGatewaySignature(secret, timestamp, nonce, scope, body),
    'x-request-id': `request-${nonce}`,
  };
}

function validEvolutionPayload() {
  return {
    event: 'MESSAGES_UPSERT',
    instance: 'main',
    data: {
      key: {
        remoteJid: '5511999999999@s.whatsapp.net',
        id: 'message-1',
        fromMe: false,
      },
      pushName: 'Tutor',
      message: { conversation: 'hello' },
      messageTimestamp: 1_755_000_000,
    },
  };
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerGatewayRoutes(app);
  await app.ready();
  return app;
}

describe('gateway authentication and route contracts', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.GATEWAY_WEBHOOK_SECRET = secret;
    process.env.GATEWAY_SIGNATURE_TTL_SECONDS = '300';
    vi.clearAllMocks();
    resetGatewayAuthState();
    setGatewayReplayStore(null);
    setGatewayDeskHandlers({
      receiveInboundMessage,
      findPendingOutbound,
      markOutboundSent,
      updateReceipt,
    });
    receiveInboundMessage.mockResolvedValue({ messageId: 'message-1', conversationId: 'conversation-1' });
    updateReceipt.mockResolvedValue({ updated: true });
    findPendingOutbound.mockResolvedValue([]);
  });

  it('rejects gateway requests without an HMAC credential', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/gateway/inbound',
      payload: { event: 'MESSAGES_UPSERT' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: 'UNAUTHORIZED' });
    expect(receiveInboundMessage).not.toHaveBeenCalled();
    await app.close();
  });

  it('accepts a valid scoped signature and rejects a valid signature with the wrong scope', async () => {
    const app = await buildApp();
    const payload = validEvolutionPayload();

    const forbidden = await app.inject({
      method: 'POST',
      url: '/gateway/inbound',
      headers: signedHeaders(payload, 'outbound:write', 'wrong-scope'),
      payload,
    });
    expect(forbidden.statusCode).toBe(403);

    const accepted = await app.inject({
      method: 'POST',
      url: '/gateway/inbound',
      headers: signedHeaders(payload, 'inbound', 'valid-scope'),
      payload,
    });
    expect(accepted.statusCode).toBe(200);
    expect(receiveInboundMessage).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('rejects a replayed nonce before the domain handler runs again', async () => {
    const app = await buildApp();
    const payload = validEvolutionPayload();
    const headers = signedHeaders(payload, 'inbound', 'reused-nonce');

    const first = await app.inject({ method: 'POST', url: '/gateway/inbound', headers, payload });
    const second = await app.inject({ method: 'POST', url: '/gateway/inbound', headers, payload });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: 'REPLAY_DETECTED' });
    expect(receiveInboundMessage).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('delegates nonce replay protection to a shared store when configured', async () => {
    const claim = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    setGatewayReplayStore({ claim });
    const app = await buildApp();
    const payload = validEvolutionPayload();
    const firstHeaders = signedHeaders(payload, 'inbound', 'shared-nonce-1');
    const secondHeaders = signedHeaders(payload, 'inbound', 'shared-nonce-2');

    const first = await app.inject({ method: 'POST', url: '/gateway/inbound', headers: firstHeaders, payload });
    const second = await app.inject({ method: 'POST', url: '/gateway/inbound', headers: secondHeaders, payload });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);
    expect(claim).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('does not expose domain or database errors to gateway callers', async () => {
    const app = await buildApp();
    const payload = validEvolutionPayload();
    receiveInboundMessage.mockRejectedValueOnce(new Error('select * from sessions where password = secret'));

    const response = await app.inject({
      method: 'POST',
      url: '/gateway/inbound',
      headers: signedHeaders(payload, 'inbound', 'error-nonce'),
      payload,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual(expect.objectContaining({
      error: 'PROCESSING_ERROR',
      message: 'Gateway event could not be processed',
    }));
    expect(response.body).not.toContain('select * from sessions');
    await app.close();
  });

  it('requires the outbound scope and validates the sent payload', async () => {
    const app = await buildApp();
    const invalidPayload = { messageId: 'external-message-1', unexpected: true };
    const invalid = await app.inject({
      method: 'POST',
      url: '/gateway/outbound/message-1/sent',
      headers: signedHeaders(invalidPayload, 'outbound:write', 'invalid-body'),
      payload: invalidPayload,
    });
    expect(invalid.statusCode).toBe(400);

    const acceptedPayload = { messageId: 'external-message-1' };
    const accepted = await app.inject({
      method: 'POST',
      url: '/gateway/outbound/message-1/sent',
      headers: signedHeaders(acceptedPayload, 'outbound:write', 'valid-body'),
      payload: acceptedPayload,
    });
    expect(accepted.statusCode).toBe(200);
    expect(markOutboundSent).toHaveBeenCalledWith('message-1', 'external-message-1');
    await app.close();
  });

  it('creates signatures with the expected HMAC digest', () => {
    const timestamp = 1_755_000_000;
    const nonce = 'nonce-1';
    const scope = 'inbound';
    const body = '{"event":"MESSAGES_UPSERT"}';
    const expected = crypto.createHmac('sha256', secret)
      .update(`${timestamp}.${nonce}.${scope}.${body}`)
      .digest('hex');

    expect(buildGatewaySignature(secret, timestamp, nonce, scope, body)).toBe(`sha256=${expected}`);
  });
});
