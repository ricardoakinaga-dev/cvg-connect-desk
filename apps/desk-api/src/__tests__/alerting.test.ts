import { beforeEach, describe, expect, it, vi } from 'vitest';

const sharedMock = vi.hoisted(() => ({
  onUnhandledException: vi.fn(),
  createAlertingService: vi.fn((config: unknown) => ({ config })),
  createAlertingHook: vi.fn(() => ({
    onUnhandledException: sharedMock.onUnhandledException,
  })),
}));

vi.mock('@cvg/shared', () => sharedMock);

const {
  getAlertingHooks,
  getAlertingHooksOrThrow,
  getAlertingService,
  initializeAlerting,
  registerAlertingErrorHooks,
} = await import('../alerting');

function createAppMock() {
  let errorHandler: ((error: Error & { statusCode?: number; code?: string }, request: unknown, reply: unknown) => Promise<void>) | undefined;
  let closeHandler: (() => Promise<void>) | undefined;
  const app = {
    log: {
      warn: vi.fn(),
      info: vi.fn(),
    },
    setErrorHandler: vi.fn((handler) => {
      errorHandler = handler;
    }),
    addHook: vi.fn((_name, handler) => {
      closeHandler = handler;
    }),
  };

  return {
    app,
    getErrorHandler: () => errorHandler,
    getCloseHandler: () => closeHandler,
  };
}

describe('alerting integration', () => {
  const originalWebhookUrl = process.env.ALERT_WEBHOOK_URL;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ALERT_WEBHOOK_URL = '';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.ALERT_WEBHOOK_URL = originalWebhookUrl;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('stays disabled and warns when webhook URL is missing', async () => {
    vi.resetModules();
    const module = await import('../alerting');
    const { app } = createAppMock();

    module.initializeAlerting(app as never);

    expect(app.log.warn).toHaveBeenCalledWith(expect.stringContaining('ALERT_WEBHOOK_URL not set'));
    expect(module.getAlertingService()).toBeNull();
    expect(module.getAlertingHooks()).toBeNull();
    expect(() => module.getAlertingHooksOrThrow()).toThrow('Alerting not initialized');
    module.registerAlertingErrorHooks(app as never);
    expect(app.setErrorHandler).not.toHaveBeenCalled();
  });

  it('initializes hooks and reports server errors and shutdown', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://alerts.example.test/hook';
    const harness = createAppMock();

    initializeAlerting(harness.app as never);
    registerAlertingErrorHooks(harness.app as never);

    expect(sharedMock.createAlertingService).toHaveBeenCalledWith(expect.objectContaining({
      serviceName: 'desk-api',
      environment: 'test',
      webhook: { url: 'https://alerts.example.test/hook' },
      enabled: true,
    }));
    expect(getAlertingService()).toEqual(expect.objectContaining({ config: expect.any(Object) }));
    expect(getAlertingHooks()).toEqual(expect.objectContaining({ onUnhandledException: expect.any(Function) }));
    expect(getAlertingHooksOrThrow()).toEqual(expect.objectContaining({ onUnhandledException: expect.any(Function) }));

    const reply = {
      status: vi.fn(() => reply),
      send: vi.fn(),
    };
    const error = Object.assign(new Error('database failed'), {
      statusCode: 503,
      code: 'DB_DOWN',
    });

    await harness.getErrorHandler()?.(error, {
      url: '/messages',
      method: 'POST',
      id: 'corr-1',
    }, reply);

    expect(sharedMock.onUnhandledException).toHaveBeenCalledWith(error, {
      url: '/messages',
      method: 'POST',
      correlation_id: 'corr-1',
    });
    expect(reply.status).toHaveBeenCalledWith(503);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      error: 'DB_DOWN',
      message: 'Internal server error',
      statusCode: 503,
    }));

    await harness.getCloseHandler()?.();
    expect(sharedMock.onUnhandledException).toHaveBeenCalledWith(expect.any(Error), { reason: 'onClose' });
  });

  it('does not alert for handled client errors', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://alerts.example.test/hook';
    const harness = createAppMock();
    initializeAlerting(harness.app as never);
    registerAlertingErrorHooks(harness.app as never);

    const reply = {
      status: vi.fn(() => reply),
      send: vi.fn(),
    };
    const error = Object.assign(new Error('bad request'), {
      statusCode: 400,
      code: 'BAD_REQUEST',
    });

    await harness.getErrorHandler()?.(error, {
      url: '/messages',
      method: 'POST',
      id: 'corr-1',
    }, reply);

    expect(sharedMock.onUnhandledException).not.toHaveBeenCalled();
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      error: 'BAD_REQUEST',
      message: 'bad request',
      statusCode: 400,
    }));
  });
});
