import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getWebhookSecurityStats, resetWebhookSecurityStats } from '../webhook-security-stats';
import { InMemoryWebhookReplayStore, setDefaultWebhookReplayStore } from '../webhook-anti-replay';

const mockReply = {
  status: vi.fn().mockReturnThis(),
  send: vi.fn().mockReturnThis(),
};

const mockRequest = {
  headers: {} as Record<string, string | undefined>,
  body: {},
  log: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
};

function freshReply() {
  return { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };
}

function freshLog() {
  return { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
}

async function signPayload(rawBody: string, secret: string, timestamp?: number): Promise<string> {
  const crypto = await import('crypto');
  const payload = timestamp !== undefined ? `${timestamp}.${rawBody}` : rawBody;
  return `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
}

describe('WebhookGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.DESK_ENV = '';
    process.env.WEBHOOK_SECRET = '';
    delete process.env.DATABASE_URL;
    setDefaultWebhookReplayStore(new InMemoryWebhookReplayStore());
    resetWebhookSecurityStats();
  });

  afterEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.WEBHOOK_SECRET = '';
    process.env.DESK_ENV = '';
    setDefaultWebhookReplayStore(new InMemoryWebhookReplayStore());
    resetWebhookSecurityStats();
  });

  it('rejects request in production when WEBHOOK_SECRET is not configured', async () => {
    process.env.NODE_ENV = 'production';

    const { createWebhookGuard } = await import('../webhook-guard');
    const guard = createWebhookGuard();

    const request = { ...mockRequest, log: { ...mockRequest.log, error: vi.fn() } };
    const reply = { ...mockReply, status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };

    await guard(request as any, reply as any);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({
      error: 'CONFIGURATION_ERROR',
      reason: 'missing_secret',
      message: 'Webhook security not properly configured',
    });
    expect(getWebhookSecurityStats()).toMatchObject({
      denied: 1,
      byReason: { missing_secret: 1 },
    });
  });

  it('allows request in development when WEBHOOK_SECRET is not configured', async () => {
    process.env.NODE_ENV = 'development';

    const { createWebhookGuard } = await import('../webhook-guard');
    const guard = createWebhookGuard();

    const request = { ...mockRequest, log: { ...mockRequest.log, warn: vi.fn() } };
    const reply = { ...mockReply, status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };

    await guard(request as any, reply as any);

    expect(request.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'missing_secret',
        webhook_mode: 'development-bypass',
        has_secret: false,
      }),
      '[WebhookGuard] WEBHOOK_SECRET não configurado — validação desabilitada (desenvolvimento apenas)',
    );
    expect(reply.status).not.toHaveBeenCalled();
    expect(getWebhookSecurityStats()).toMatchObject({
      allowed: 1,
      byReason: { missing_secret: 1 },
    });
  });

  it('rejects request without signature header when secret is configured', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_SECRET = 'test-secret';

    const { createWebhookGuard } = await import('../webhook-guard');
    const guard = createWebhookGuard();

    const request = { ...mockRequest, log: { ...mockRequest.log, warn: vi.fn() } };
    const reply = { ...mockReply, status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };

    await guard(request as any, reply as any);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({
      error: 'UNAUTHORIZED',
      reason: 'missing_signature',
      message: 'Missing webhook signature',
    });
    expect(getWebhookSecurityStats()).toMatchObject({
      denied: 1,
      byReason: { missing_signature: 1 },
    });
  });

  it('rejects request with invalid signature format', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_SECRET = 'test-secret';

    const { createWebhookGuard } = await import('../webhook-guard');
    const guard = createWebhookGuard();

    const request = {
      ...mockRequest,
      headers: { 'x-webhook-signature': 'invalid-format' },
      log: { ...mockRequest.log, warn: vi.fn() },
    };
    const reply = { ...mockReply, status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };

    await guard(request as any, reply as any);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({
      error: 'UNAUTHORIZED',
      reason: 'invalid_signature_format',
      message: 'Invalid signature format',
    });
    expect(getWebhookSecurityStats()).toMatchObject({
      denied: 1,
      byReason: { invalid_signature_format: 1 },
    });
  });

  it('rejects request with invalid HMAC signature', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_SECRET = 'test-secret';

    const { createWebhookGuard } = await import('../webhook-guard');
    const guard = createWebhookGuard();
    const timestamp = Math.floor(Date.now() / 1000);

    const request = {
      ...mockRequest,
      headers: {
        'x-webhook-signature': 'sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        'x-webhook-timestamp': String(timestamp),
        'x-webhook-event-id': 'evt-invalid-sig',
      },
      body: { test: 'data' },
      log: { ...mockRequest.log, warn: vi.fn() },
    };
    const reply = { ...mockReply, status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };

    await guard(request as any, reply as any);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({
      error: 'UNAUTHORIZED',
      reason: 'invalid_signature',
      message: 'Invalid webhook signature',
    });
    expect(getWebhookSecurityStats()).toMatchObject({
      denied: 1,
      byReason: { invalid_signature: 1 },
    });
  });

  it('accepts request with valid HMAC signature (timestamp.event-id envelope)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_SECRET = 'test-secret';
    delete process.env.DESK_ENV;

    const body = { test: 'data' };
    const rawBody = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await signPayload(rawBody, 'test-secret', timestamp);

    const { createWebhookGuard } = await import('../webhook-guard');
    const guard = createWebhookGuard();

    const request = {
      headers: {
        'x-webhook-signature': signature,
        'x-webhook-timestamp': String(timestamp),
        'x-webhook-event-id': `evt-valid-${Date.now()}`,
      },
      body,
      rawBody,
      log: freshLog(),
    };
    const reply = freshReply();

    await guard(request as any, reply as any);

    expect(request.log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'signature_valid',
        webhook_mode: 'hmac',
        has_secret: true,
        algorithm: 'sha256',
      }),
      '[WebhookGuard] Assinatura validada com sucesso',
    );
    expect(reply.status).not.toHaveBeenCalled();
    expect(getWebhookSecurityStats()).toMatchObject({
      allowed: 1,
      byReason: { signature_valid: 1 },
    });
  });

  it('rejects request with old timestamp (anti-replay)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_SECRET = 'test-secret';

    const body = { test: 'data' };
    const rawBody = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000) - 3600;
    const signature = await signPayload(rawBody, 'test-secret', timestamp);

    const { createWebhookGuard } = await import('../webhook-guard');
    const guard = createWebhookGuard();

    const request = {
      headers: {
        'x-webhook-signature': signature,
        'x-webhook-timestamp': String(timestamp),
        'x-webhook-event-id': `evt-old-${Date.now()}`,
      },
      body,
      rawBody,
      log: freshLog(),
    };
    const reply = freshReply();

    await guard(request as any, reply as any);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ reason: 'timestamp_too_old' }));
  });

  it('rejects request with future timestamp (anti-replay)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_SECRET = 'test-secret';

    const body = { test: 'data' };
    const rawBody = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000) + 3600;
    const signature = await signPayload(rawBody, 'test-secret', timestamp);

    const { createWebhookGuard } = await import('../webhook-guard');
    const guard = createWebhookGuard();

    const request = {
      headers: {
        'x-webhook-signature': signature,
        'x-webhook-timestamp': String(timestamp),
        'x-webhook-event-id': `evt-future-${Date.now()}`,
      },
      body,
      rawBody,
      log: freshLog(),
    };
    const reply = freshReply();

    await guard(request as any, reply as any);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ reason: 'timestamp_too_future' }));
  });

  it('returns a stable 2xx ACK for a completed event ID replay', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_SECRET = 'test-secret';

    const body = { test: 'data' };
    const rawBody = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await signPayload(rawBody, 'test-secret', timestamp);
    const eventId = `evt-dup-${Date.now()}`;
    const store = new InMemoryWebhookReplayStore();
    setDefaultWebhookReplayStore(store);

    const { createWebhookGuard } = await import('../webhook-guard');
    const guard = createWebhookGuard();

    const firstReq = {
      headers: {
        'x-webhook-signature': signature,
        'x-webhook-timestamp': String(timestamp),
        'x-webhook-event-id': eventId,
      },
      body,
      rawBody,
      log: freshLog(),
    };
    await guard(firstReq as never, freshReply() as never);
    // Negócio concluiu: sem `complete`, o retry seria legítimo.
    expect(await store.complete(eventId)).toBe(true);

    const secondReq = {
      headers: {
        'x-webhook-signature': signature,
        'x-webhook-timestamp': String(timestamp),
        'x-webhook-event-id': eventId,
      },
      body,
      rawBody,
      log: freshLog(),
    };
    const secondReply = freshReply();
    await guard(secondReq as never, secondReply as never);

    expect(secondReply.status).toHaveBeenCalledWith(200);
    expect(secondReply.send).toHaveBeenCalledWith({
      success: true,
      deduplicated: true,
      eventId,
    });
    expect(getWebhookSecurityStats()).toMatchObject({
      allowed: 3,
      denied: 0,
      byReason: { duplicate_event_id: 1 },
    });
  });

  it('accepts a failed retry with a renewed timestamp and signature', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_SECRET = 'test-secret';

    const body = { test: 'renewed-signature' };
    const rawBody = JSON.stringify(body);
    const firstTimestamp = Math.floor(Date.now() / 1000) - 1;
    const secondTimestamp = firstTimestamp + 1;
    const eventId = `evt-renewed-${Date.now()}`;
    const store = new InMemoryWebhookReplayStore();
    setDefaultWebhookReplayStore(store);

    const { createWebhookGuard } = await import('../webhook-guard');
    const guard = createWebhookGuard();
    const firstHeaders = {
      'x-webhook-signature': await signPayload(rawBody, 'test-secret', firstTimestamp),
      'x-webhook-timestamp': String(firstTimestamp),
      'x-webhook-event-id': eventId,
    };

    await guard({ headers: firstHeaders, body, rawBody, log: freshLog() } as never, freshReply() as never);
    await store.fail(eventId);

    const retryReply = freshReply();
    await guard(
      {
        headers: {
          'x-webhook-signature': await signPayload(rawBody, 'test-secret', secondTimestamp),
          'x-webhook-timestamp': String(secondTimestamp),
          'x-webhook-event-id': eventId,
        },
        body,
        rawBody,
        log: freshLog(),
      } as never,
      retryReply as never,
    );

    expect(retryReply.status).not.toHaveBeenCalled();
  });

  it('allows legitimate retry after business failure (same event ID and payload)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_SECRET = 'test-secret';

    const body = { test: 'retry' };
    const rawBody = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await signPayload(rawBody, 'test-secret', timestamp);
    const eventId = `evt-retry-${Date.now()}`;
    const store = new InMemoryWebhookReplayStore();
    setDefaultWebhookReplayStore(store);

    const { createWebhookGuard } = await import('../webhook-guard');
    const guard = createWebhookGuard();
    const headers = {
      'x-webhook-signature': signature,
      'x-webhook-timestamp': String(timestamp),
      'x-webhook-event-id': eventId,
    };

    await guard({ headers, body, rawBody, log: freshLog() } as never, freshReply() as never);
    await store.fail(eventId);

    const retryReply = freshReply();
    await guard({ headers, body, rawBody, log: freshLog() } as never, retryReply as never);

    expect(retryReply.status).not.toHaveBeenCalled();
  });

  it('rejects same event ID with different payload (mismatch)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_SECRET = 'test-secret';

    const firstBody = { test: 'payload-a' };
    const secondBody = { test: 'payload-b' };
    const timestamp = Math.floor(Date.now() / 1000);
    const eventId = `evt-mismatch-${Date.now()}`;
    setDefaultWebhookReplayStore(new InMemoryWebhookReplayStore());

    const { createWebhookGuard } = await import('../webhook-guard');
    const guard = createWebhookGuard();

    const firstRaw = JSON.stringify(firstBody);
    await guard(
      {
        headers: {
          'x-webhook-signature': await signPayload(firstRaw, 'test-secret', timestamp),
          'x-webhook-timestamp': String(timestamp),
          'x-webhook-event-id': eventId,
        },
        body: firstBody,
        rawBody: firstRaw,
        log: freshLog(),
      } as never,
      freshReply() as never,
    );

    const secondRaw = JSON.stringify(secondBody);
    const mismatchReply = freshReply();
    await guard(
      {
        headers: {
          'x-webhook-signature': await signPayload(secondRaw, 'test-secret', timestamp),
          'x-webhook-timestamp': String(timestamp),
          'x-webhook-event-id': eventId,
        },
        body: secondBody,
        rawBody: secondRaw,
        log: freshLog(),
      } as never,
      mismatchReply as never,
    );

    expect(mismatchReply.status).toHaveBeenCalledWith(409);
    expect(mismatchReply.send).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'event_payload_mismatch' }),
    );
  });

  it('rejects a delivery for an event still in progress (concurrent claim)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_SECRET = 'test-secret';

    const body = { test: 'in-progress' };
    const rawBody = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await signPayload(rawBody, 'test-secret', timestamp);
    const eventId = `evt-in-progress-${Date.now()}`;
    setDefaultWebhookReplayStore(new InMemoryWebhookReplayStore());

    const { createWebhookGuard } = await import('../webhook-guard');
    const guard = createWebhookGuard();
    const headers = {
      'x-webhook-signature': signature,
      'x-webhook-timestamp': String(timestamp),
      'x-webhook-event-id': eventId,
    };

    await guard({ headers, body, rawBody, log: freshLog() } as never, freshReply() as never);

    const concurrentReply = freshReply();
    await guard({ headers, body, rawBody, log: freshLog() } as never, concurrentReply as never);

    expect(concurrentReply.status).toHaveBeenCalledWith(409);
    expect(concurrentReply.send).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'event_in_progress' }),
    );
  });

  it('propagates transient replay store errors instead of reporting duplicate', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_SECRET = 'test-secret';
    setDefaultWebhookReplayStore({
      has: async () => false,
      claim: async () => {
        throw new Error('connection refused');
      },
      complete: async () => false,
      fail: async () => undefined,
    });

    const body = { test: 'db-down' };
    const rawBody = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await signPayload(rawBody, 'test-secret', timestamp);

    const { createWebhookGuard } = await import('../webhook-guard');
    const guard = createWebhookGuard();
    const reply = freshReply();

    await expect(
      guard(
        {
          headers: {
            'x-webhook-signature': signature,
            'x-webhook-timestamp': String(timestamp),
            'x-webhook-event-id': `evt-db-down-${Date.now()}`,
          },
          body,
          rawBody,
          log: freshLog(),
        } as never,
        reply as never,
      ),
    ).rejects.toThrow('connection refused');
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('rejects production request without timestamp', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_SECRET = 'test-secret';

    const body = { test: 'data' };
    const rawBody = JSON.stringify(body);
    const crypto = await import('crypto');
    const signature = `sha256=${crypto.createHmac('sha256', 'test-secret').update(rawBody).digest('hex')}`;

    const { createWebhookGuard } = await import('../webhook-guard');
    const guard = createWebhookGuard();

    const request = {
      headers: {
        'x-webhook-signature': signature,
        'x-webhook-event-id': `evt-no-ts-${Date.now()}`,
      },
      body,
      rawBody,
      log: freshLog(),
    };
    const reply = freshReply();

    await guard(request as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ reason: 'missing_timestamp' }));
  });

  it('rejects production request without event ID', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_SECRET = 'test-secret';

    const body = { test: 'data' };
    const rawBody = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await signPayload(rawBody, 'test-secret', timestamp);

    const { createWebhookGuard } = await import('../webhook-guard');
    const guard = createWebhookGuard();

    const request = {
      headers: {
        'x-webhook-signature': signature,
        'x-webhook-timestamp': String(timestamp),
      },
      body,
      rawBody,
      log: freshLog(),
    };
    const reply = freshReply();

    await guard(request as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ reason: 'missing_event_id' }));
  });

  it('rejects malformed hex signature without throwing', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_SECRET = 'test-secret';

    const timestamp = Math.floor(Date.now() / 1000);
    const { createWebhookGuard } = await import('../webhook-guard');
    const guard = createWebhookGuard();

    const request = {
      headers: {
        'x-webhook-signature': 'sha256=!!!not-hex!!!',
        'x-webhook-timestamp': String(timestamp),
        'x-webhook-event-id': `evt-malformed-${Date.now()}`,
      },
      body: { test: 'data' },
      log: freshLog(),
    };
    const reply = freshReply();

    await guard(request as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ reason: 'invalid_signature' }));
  });
});
