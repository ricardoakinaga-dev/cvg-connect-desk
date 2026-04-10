import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getWebhookSecurityStats, resetWebhookSecurityStats } from '../webhook-security-stats';

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

describe('WebhookGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.WEBHOOK_SECRET = '';
    resetWebhookSecurityStats();
  });

  afterEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.WEBHOOK_SECRET = '';
    process.env.DESK_ENV = '';
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

    const request = {
      ...mockRequest,
      headers: { 'x-webhook-signature': 'sha256=invalidsignature' },
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

  it('accepts request with valid HMAC signature', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_SECRET = 'test-secret';
    delete process.env.DESK_ENV;

    const crypto = await import('crypto');
    const body = JSON.stringify({ test: 'data' });
    const expectedHash = crypto.createHmac('sha256', 'test-secret').update(body).digest('hex');

    const { createWebhookGuard } = await import('../webhook-guard');
    const guard = createWebhookGuard();

    const request = {
      ...mockRequest,
      headers: { 'x-webhook-signature': `sha256=${expectedHash}` },
      body: { test: 'data' },
      log: { ...mockRequest.log, info: vi.fn() },
    };
    const reply = { ...mockReply, status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };

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
});
