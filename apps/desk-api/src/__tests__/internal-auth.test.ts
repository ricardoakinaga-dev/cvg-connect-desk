import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createInternalEventsGuard } from '../internal-auth';

const originalInternalSecret = process.env.INTERNAL_EVENTS_SECRET;
const originalEventsApiKey = process.env.EVENTS_API_KEY;
const originalNodeEnv = process.env.NODE_ENV;
const originalDeskEnv = process.env.DESK_ENV;

function makeRequest(headers: Record<string, string> = {}): FastifyRequest {
  return {
    headers,
    log: {
      error: vi.fn(),
      warn: vi.fn(),
    },
  } as unknown as FastifyRequest;
}

function makeReply(): FastifyReply & { status: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> } {
  const reply = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply as unknown as FastifyReply & typeof reply;
}

afterEach(() => {
  if (originalInternalSecret === undefined) delete process.env.INTERNAL_EVENTS_SECRET;
  else process.env.INTERNAL_EVENTS_SECRET = originalInternalSecret;
  if (originalEventsApiKey === undefined) delete process.env.EVENTS_API_KEY;
  else process.env.EVENTS_API_KEY = originalEventsApiKey;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalDeskEnv === undefined) delete process.env.DESK_ENV;
  else process.env.DESK_ENV = originalDeskEnv;
});

describe('internal events guard', () => {
  it('fails closed when no secret is configured', async () => {
    delete process.env.INTERNAL_EVENTS_SECRET;
    delete process.env.EVENTS_API_KEY;
    delete process.env.NODE_ENV;
    delete process.env.DESK_ENV;
    const reply = makeReply();

    await createInternalEventsGuard()(makeRequest(), reply);

    expect(reply.status).toHaveBeenCalledWith(503);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'INTERNAL_AUTH_NOT_CONFIGURED' }));
  });

  it('uses a production error when a required secret is missing', async () => {
    delete process.env.INTERNAL_EVENTS_SECRET;
    delete process.env.EVENTS_API_KEY;
    process.env.NODE_ENV = 'production';
    const reply = makeReply();

    await createInternalEventsGuard()(makeRequest(), reply);

    expect(reply.status).toHaveBeenCalledWith(500);
  });

  it('rejects an invalid key and accepts the configured key', async () => {
    process.env.INTERNAL_EVENTS_SECRET = 'service-secret';

    const rejectedReply = makeReply();
    await createInternalEventsGuard()(makeRequest({ 'x-internal-service-key': 'wrong' }), rejectedReply);
    expect(rejectedReply.status).toHaveBeenCalledWith(401);

    const acceptedReply = makeReply();
    await createInternalEventsGuard()(makeRequest({ 'x-internal-service-key': 'service-secret' }), acceptedReply);
    expect(acceptedReply.status).not.toHaveBeenCalled();
    expect(acceptedReply.send).not.toHaveBeenCalled();
  });
});
