import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { createInternalEventsGuard } from '../internal-auth';

describe('internal events authentication', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.INTERNAL_EVENTS_SECRET = 'internal-events-secret';
  });

  it('rejects missing or invalid service credentials', async () => {
    const app = Fastify({ logger: false });
    app.get('/events', { preHandler: createInternalEventsGuard() }, async () => ({ ok: true }));
    await app.ready();

    await expect(app.inject({ method: 'GET', url: '/events' })).resolves.toMatchObject({ statusCode: 401 });
    await expect(app.inject({
      method: 'GET',
      url: '/events',
      headers: { 'x-internal-service-key': 'wrong' },
    })).resolves.toMatchObject({ statusCode: 401 });
    await app.close();
  });

  it('accepts the configured service credential', async () => {
    const app = Fastify({ logger: false });
    app.get('/events', { preHandler: createInternalEventsGuard() }, async () => ({ ok: true }));
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/events',
      headers: { 'x-internal-service-key': 'internal-events-secret' },
    });

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('fails closed when the service secret is missing', async () => {
    delete process.env.INTERNAL_EVENTS_SECRET;
    const app = Fastify({ logger: false });
    app.get('/events', { preHandler: createInternalEventsGuard() }, async () => ({ ok: true }));
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/events' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: 'CONFIGURATION_ERROR' });
    await app.close();
  });
});
