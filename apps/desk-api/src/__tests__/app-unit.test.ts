import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chatMock = vi.hoisted(() => ({
  registerInboundWebhook: vi.fn(async () => {}),
  registerOutboundController: vi.fn(async () => {}),
  setOutboundDeliveryService: vi.fn(),
  receiveInboundMessage: vi.fn(),
  messageRepository: {
    findPendingOutbound: vi.fn(),
    update: vi.fn(),
    findByExternalId: vi.fn(),
  },
}));

const gatewayMock = vi.hoisted(() => ({
  registerGatewayRoutes: vi.fn(async () => {}),
  setGatewayDeskHandlers: vi.fn(),
  setGatewayReplayStore: vi.fn(),
  mediaService: {
    sendText: vi.fn(),
    sendImage: vi.fn(),
    sendAudio: vi.fn(),
    sendDocument: vi.fn(),
  },
}));

const dbMock = vi.hoisted(() => ({
  shouldFail: false,
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      limit: vi.fn(async () => {
        if (dbMock.shouldFail) {
          throw new Error('db unavailable');
        }
        return [];
      }),
    })),
  })),
}));

const eventsMock = vi.hoisted(() => ({
  acknowledge: vi.fn(),
  fetchPendingEvents: vi.fn(),
  toEventEnvelope: vi.fn((event: { eventId: string }) => ({ id: event.eventId })),
  Reader: vi.fn(function Reader(this: unknown, config: unknown) {
    Object.assign(this as object, {
      config,
      fetchPendingEvents: eventsMock.fetchPendingEvents,
      acknowledge: eventsMock.acknowledge,
      toEventEnvelope: eventsMock.toEventEnvelope,
    });
  }),
}));

const authMock = vi.hoisted(() => ({
  SESSION_COOKIE_NAME: 'cvg_session',
  CSRF_COOKIE_NAME: 'cvg_csrf',
  CSRF_HEADER_NAME: 'x-csrf-token',
  authenticate: vi.fn(async () => {}),
  parseCookieHeader: (header?: string) => Object.fromEntries(
    (header || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [key, ...rest] = part.split('=');
        return [key, rest.join('=')];
      })
  ),
  registerAuthRoutes: vi.fn(async (app) => {
    app.post('/auth/login', async () => ({ ok: true }));
  }),
}));

vi.mock('@cvg/chat', () => chatMock);

vi.mock('@cvg/gateway-adapter', () => gatewayMock);

vi.mock('@cvg/database', () => ({
  db: dbMock,
  claimGatewayRequestNonce: vi.fn(async () => true),
  persistWebhookSecurityDecision: vi.fn(async () => {}),
  schema: {
    users: 'users',
    conversations: 'conversations',
    messages: 'messages',
    tasks: 'tasks',
  },
}));

vi.mock('@cvg/events', () => ({
  ConsumerAwareOutboxReader: eventsMock.Reader,
  CONSUMER_IDS: {
    HTTP_POLL: 'http-poll',
  },
}));

vi.mock('@cvg/auth', () => authMock);

vi.mock('@cvg/tasks', () => ({
  registerTaskRoutes: vi.fn(async (app) => {
    app.post('/csrf-target', async () => ({ ok: true }));
  }),
}));

vi.mock('@cvg/notes', () => ({ registerNoteRoutes: vi.fn(async () => {}) }));
vi.mock('@cvg/alerts', () => ({ registerAlertRoutes: vi.fn(async () => {}) }));
vi.mock('@cvg/dashboard', () => ({ registerDashboardRoutes: vi.fn(async () => {}) }));
vi.mock('@cvg/audit', () => ({ registerAuditRoutes: vi.fn(async () => {}) }));
vi.mock('@cvg/admin', () => ({ registerAdminRoutes: vi.fn(async () => {}) }));
vi.mock('@cvg/labels', () => ({ registerLabelRoutes: vi.fn(async () => {}) }));
vi.mock('@cvg/sectors', () => ({ registerSectorRoutes: vi.fn(async () => {}) }));
vi.mock('@cvg/transfers', () => ({ registerTransferRoutes: vi.fn(async () => {}) }));
vi.mock('@cvg/contact-groups', () => ({ registerContactGroupRoutes: vi.fn(async () => {}) }));
vi.mock('@cvg/kanban', () => ({ registerKanbanRoutes: vi.fn(async () => {}) }));
vi.mock('@cvg/contacts', () => ({ registerContactRoutes: vi.fn(async () => {}) }));
vi.mock('@cvg/integrations', () => ({ initializeSecretaryClient: vi.fn() }));

const { buildDeskApiApp } = await import('../app');

describe('buildDeskApiApp unit behavior', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'test';
    process.env.CORS_ORIGIN = '';
    process.env.WEBHOOK_SECRET = 'unit-webhook-secret';
    process.env.ALERT_WEBHOOK_URL = '';
    process.env.SECRETARY_URL = '';
    process.env.SECRETARY_API_KEY = '';
    process.env.REDIS_URL = '';
    process.env.GATEWAY_URL = '';
    process.env.INTERNAL_EVENTS_SECRET = 'unit-internal-events-secret';
    dbMock.shouldFail = false;
    authMock.authenticate = vi.fn(async () => {});
    eventsMock.fetchPendingEvents.mockResolvedValue([
      { eventId: 'old', occurredAt: new Date('2026-04-27T00:00:00.000Z') },
      { eventId: 'new', occurredAt: new Date('2026-04-28T00:00:00.000Z') },
    ]);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('configures outbound delivery adapters for each media type', async () => {
    const app = await buildDeskApiApp();
    const delivery = chatMock.setOutboundDeliveryService.mock.calls[0][0];

    gatewayMock.mediaService.sendImage.mockResolvedValue({ type: 'image' });
    gatewayMock.mediaService.sendAudio.mockResolvedValue({ type: 'audio' });
    gatewayMock.mediaService.sendDocument.mockResolvedValue({ type: 'document' });
    gatewayMock.mediaService.sendText.mockResolvedValue({ type: 'text' });

    await expect(delivery.send({
      recipient: '+55 (11) 99999-0000@s.whatsapp.net',
      mediaUrl: 'https://cdn.example.test/image.png',
      mediaType: 'image',
      content: 'caption',
    })).resolves.toEqual({ type: 'image' });
    await delivery.send({ recipient: '+55 (11) 99999-0000', mediaUrl: 'audio.ogg', mediaType: 'audio' });
    await delivery.send({ recipient: '+55 (11) 99999-0000', mediaUrl: 'doc.pdf', mediaType: 'document', mediaFilename: 'doc.pdf' });
    await delivery.send({ recipient: '+55 (11) 99999-0000', content: 'Oi' });

    expect(gatewayMock.mediaService.sendImage).toHaveBeenCalledWith('5511999990000', 'https://cdn.example.test/image.png', 'caption');
    expect(gatewayMock.mediaService.sendAudio).toHaveBeenCalledWith('5511999990000', 'audio.ogg');
    expect(gatewayMock.mediaService.sendDocument).toHaveBeenCalledWith('5511999990000', 'doc.pdf', 'doc.pdf');
    expect(gatewayMock.mediaService.sendText).toHaveBeenCalledWith('5511999990000', 'Oi');
    await app.close();
  });

  it('configures gateway desk handlers for inbound, outbound and receipts', async () => {
    const app = await buildDeskApiApp();
    const handlers = gatewayMock.setGatewayDeskHandlers.mock.calls[0][0];
    chatMock.receiveInboundMessage.mockResolvedValueOnce({ isErr: () => false, value: { conversationId: 'conversation-1' } });
    chatMock.receiveInboundMessage.mockResolvedValueOnce({ isErr: () => true, error: new Error('invalid inbound') });
    chatMock.messageRepository.findPendingOutbound.mockResolvedValue([{ id: 'message-1' }]);
    chatMock.messageRepository.findByExternalId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'message-2', status: 'sent' });

    await expect(handlers.receiveInboundMessage({ content: 'Oi' })).resolves.toEqual({ conversationId: 'conversation-1' });
    await expect(handlers.receiveInboundMessage({ content: 'Falha' })).rejects.toThrow('invalid inbound');
    await expect(handlers.findPendingOutbound(5)).resolves.toEqual([{ id: 'message-1' }]);
    await handlers.markOutboundSent('message-1', 'external-1');
    await expect(handlers.updateReceipt('missing', 'delivered')).resolves.toEqual({
      updated: false,
      skipped: true,
      reason: 'message_not_found',
    });
    const deliveredAt = new Date('2026-04-28T00:00:00.000Z');
    await expect(handlers.updateReceipt('external-2', 'delivered', deliveredAt)).resolves.toEqual({
      updated: true,
      messageId: 'message-2',
      status: 'delivered',
    });

    expect(chatMock.messageRepository.update).toHaveBeenCalledWith('message-1', {
      status: 'sent',
      externalMessageId: 'external-1',
    });
    expect(chatMock.messageRepository.update).toHaveBeenCalledWith('message-2', {
      status: 'delivered',
      deliveredAt,
    });
    await app.close();
  });

  it('enforces CSRF only for authenticated mutable requests', async () => {
    const app = await buildDeskApiApp();
    await app.ready();

    await expect(app.inject({ method: 'POST', url: '/csrf-target' }).then((r) => r.statusCode)).resolves.toBe(200);
    await expect(app.inject({
      method: 'POST',
      url: '/csrf-target',
      headers: { cookie: 'cvg_session=session-1' },
    }).then((r) => r.statusCode)).resolves.toBe(403);
    await expect(app.inject({
      method: 'POST',
      url: '/csrf-target',
      headers: {
        cookie: 'cvg_session=session-1; cvg_csrf=csrf-1',
        'x-csrf-token': 'csrf-1',
      },
    }).then((r) => r.statusCode)).resolves.toBe(200);
    await expect(app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { cookie: 'cvg_session=session-1' },
    }).then((r) => r.statusCode)).resolves.toBe(200);

    await app.close();
  });

  it('returns health, metrics, readiness and filtered event polling payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    process.env.GATEWAY_URL = 'https://gateway.example.test';
    const app = await buildDeskApiApp();
    await app.ready();

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      status: 'error',
      checks: {
        database: { status: 'ok' },
        gateway: { status: 'error', error: 'Gateway returned 503' },
      },
    });

    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.headers['content-type']).toContain('text/plain');

    const readiness = await app.inject({ method: 'GET', url: '/readiness' });
    expect(readiness.statusCode).toBe(200);
    expect(readiness.json()).toEqual({});

    const events = await app.inject({
      method: 'GET',
      url: '/events?since=2026-04-27T12:00:00.000Z&limit=7',
      headers: { 'x-internal-service-key': 'unit-internal-events-secret' },
    });
    expect(events.statusCode).toBe(200);
    expect(events.json().events).toEqual([{ id: 'new' }]);
    expect(eventsMock.Reader).toHaveBeenCalledWith({
      consumerId: 'http-poll',
      batchSize: 7,
      maxRetries: 3,
    });
    expect(eventsMock.acknowledge).toHaveBeenCalledWith('new');

    await app.close();
  });

  it('returns readiness 503 when dependency checks fail', async () => {
    dbMock.shouldFail = true;
    const app = await buildDeskApiApp();
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/readiness' });

    expect(response.statusCode).toBe(503);
    expect(response.headers['retry-after']).toBe('30');
    expect(response.json()).toEqual({});

    await app.close();
  });

  it('rejects wildcard CORS in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = '*';

    await expect(buildDeskApiApp()).rejects.toThrow('CORS_ORIGIN must be set');
  });

  it('covers development wildcard CORS and explicit proxy lists', async () => {
    process.env.CORS_ORIGIN = '*';
    process.env.TRUST_PROXY = '10.0.0.1, 10.0.0.2';

    const app = await buildDeskApiApp();
    await app.ready();
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
      },
    });

    expect(response.statusCode).toBe(204);
    await app.close();
  });

  it('rejects implicit trust proxy in production and accepts a configured origin', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://desk.example.test';
    process.env.WEBHOOK_SECRET = 'production-webhook-secret';
    process.env.TRUST_PROXY = 'true';

    await expect(buildDeskApiApp()).rejects.toThrow('TRUST_PROXY must list explicit proxy addresses');

    process.env.TRUST_PROXY = '10.0.0.10';
    const app = await buildDeskApiApp();
    await app.close();
  });

  it('returns a cached health response and expires cache entries', async () => {
    process.env.GET_RESPONSE_CACHE_TTL_MS = '1000';
    process.env.HEALTH_CACHE_TTL_MS = '1000';
    const app = await buildDeskApiApp();
    await app.ready();

    const first = await app.inject({ method: 'GET', url: '/health' });
    const second = await app.inject({ method: 'GET', url: '/health' });

    expect(first.statusCode).toBe(200);
    expect(second.headers['x-cache']).toBe('HIT');

    await app.close();

    process.env.GET_RESPONSE_CACHE_TTL_MS = '1';
    const expiringApp = await buildDeskApiApp();
    await expiringApp.ready();
    const expiringUrl = '/health?cache-expiry=1';
    await expiringApp.inject({ method: 'GET', url: expiringUrl });
    await new Promise(resolve => setTimeout(resolve, 5));
    const expired = await expiringApp.inject({ method: 'GET', url: expiringUrl });
    expect(expired.headers['x-cache']).not.toBe('HIT');
    await expiringApp.close();
  });

  it('reports optional Redis failures and successful gateway health', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    process.env.GATEWAY_URL = 'https://gateway.example.test';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));
    const app = await buildDeskApiApp();
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'error',
      checks: {
        redis: { status: 'error' },
        gateway: { status: 'ok' },
      },
    });
    await app.close();
  });

  it('sanitizes 5xx errors and preserves client error details', async () => {
    const app = await buildDeskApiApp();
    app.get('/unit-error-500', async () => {
      throw new Error('database password must not leak');
    });
    app.get('/unit-error-400', async () => {
      const error = new Error('invalid input') as Error & { statusCode: number; code: string };
      error.statusCode = 400;
      error.code = 'BAD_INPUT';
      throw error;
    });
    await app.ready();

    const internal = await app.inject({ method: 'GET', url: '/unit-error-500' });
    expect(internal.statusCode).toBe(500);
    expect(internal.json()).toMatchObject({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
    expect(internal.body).not.toContain('database password');

    const client = await app.inject({ method: 'GET', url: '/unit-error-400' });
    expect(client.statusCode).toBe(400);
    expect(client.json()).toMatchObject({ error: 'BAD_INPUT', message: 'invalid input' });
    await app.close();
  });

  it('returns readiness failure when the auth module is unavailable', async () => {
    authMock.authenticate = undefined as unknown as typeof authMock.authenticate;
    const app = await buildDeskApiApp();
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/readiness' });
    expect(response.statusCode).toBe(503);
    await app.close();
  });
});
