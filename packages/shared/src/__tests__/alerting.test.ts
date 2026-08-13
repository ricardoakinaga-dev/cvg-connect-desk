import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AlertPayload } from '../alerting/types';

const mocks = vi.hoisted(() => {
  const dispatchedPayloads: AlertPayload[] = [];
  return {
    dispatchedPayloads,
    mockNotify: vi.fn().mockImplementation((payload: AlertPayload) => {
      dispatchedPayloads.push(payload);
      return Promise.resolve({ success: true, attempts: 1 });
    }),
  };
});

vi.mock('../alerting/webhook-notifier', () => ({
  WebhookNotifier: vi.fn().mockImplementation(() => ({
    notify: mocks.mockNotify,
  })),
}));

vi.mock('../alerting/alerting-service', async () => {
  const actual = await vi.importActual('../alerting/alerting-service');
  return {
    ...actual,
  };
});

import {
  createAlertingService,
  createAlertingHook,
  ALERT_TEMPLATES,
} from '../alerting';

describe('AlertingService', () => {
  beforeEach(() => {
    mocks.dispatchedPayloads.length = 0;
    vi.clearAllMocks();
  });

  describe('createAlertingService', () => {
    it('creates a service with valid config', () => {
      const service = createAlertingService({
        serviceName: 'test-service',
        environment: 'test',
        version: '1.0.0',
        webhook: { url: 'https://example.com/webhook' },
        enabled: true,
      });

      expect(service).toBeDefined();
      expect(typeof service.critical).toBe('function');
      expect(typeof service.high).toBe('function');
      expect(typeof service.medium).toBe('function');
      expect(typeof service.low).toBe('function');
      expect(typeof service.info).toBe('function');
    });

    it('dispatches alert with correct severity for critical', async () => {
      const service = createAlertingService({
        serviceName: 'test-service',
        environment: 'test',
        version: '1.0.0',
        webhook: { url: 'https://example.com/webhook' },
        enabled: true,
      });

      await service.critical('db_down', 'Database connection lost');

      expect(mocks.dispatchedPayloads.length).toBe(1);
      expect(mocks.dispatchedPayloads[0].severity).toBe('critical');
      expect(mocks.dispatchedPayloads[0].alert_type).toBe('db_down');
      expect(mocks.dispatchedPayloads[0].message).toBe('Database connection lost');
      expect(mocks.dispatchedPayloads[0].service).toBe('test-service');
    });

    it('dispatches alert with correct severity for high', async () => {
      const service = createAlertingService({
        serviceName: 'test-service',
        environment: 'test',
        version: '1.0.0',
        webhook: { url: 'https://example.com/webhook' },
        enabled: true,
      });

      await service.high('redis_down', 'Redis connection lost');

      expect(mocks.dispatchedPayloads.length).toBe(1);
      expect(mocks.dispatchedPayloads[0].severity).toBe('high');
    });

    it('dispatches alert with correct severity for medium', async () => {
      const service = createAlertingService({
        serviceName: 'test-service',
        environment: 'test',
        version: '1.0.0',
        webhook: { url: 'https://example.com/webhook' },
        enabled: true,
      });

      await service.medium('rate_limit_exceeded', 'Rate limit hit');

      expect(mocks.dispatchedPayloads.length).toBe(1);
      expect(mocks.dispatchedPayloads[0].severity).toBe('medium');
    });

    it('dispatches alert with correct severity for low', async () => {
      const service = createAlertingService({
        serviceName: 'test-service',
        environment: 'test',
        version: '1.0.0',
        webhook: { url: 'https://example.com/webhook' },
        enabled: true,
      });

      await service.low('rate_limit_exceeded', 'Rate limit approaching');

      expect(mocks.dispatchedPayloads.length).toBe(1);
      expect(mocks.dispatchedPayloads[0].severity).toBe('low');
    });

    it('dispatches alert with correct severity for info', async () => {
      const service = createAlertingService({
        serviceName: 'test-service',
        environment: 'test',
        version: '1.0.0',
        webhook: { url: 'https://example.com/webhook' },
        enabled: true,
      });

      await service.info('webhook_delivery_failed', 'Webhook retry exhausted');

      expect(mocks.dispatchedPayloads.length).toBe(1);
      expect(mocks.dispatchedPayloads[0].severity).toBe('info');
    });

    it('includes context in alert payload', async () => {
      const service = createAlertingService({
        serviceName: 'test-service',
        environment: 'test',
        version: '1.0.0',
        webhook: { url: 'https://example.com/webhook' },
        enabled: true,
      });

      await service.critical('db_down', 'Database connection lost', {
        host: 'db-primary',
        connectionAttempts: 3,
      });

      expect(mocks.dispatchedPayloads[0].context).toEqual({
        host: 'db-primary',
        connectionAttempts: 3,
      });
    });

    it('includes correlation_id in alert payload', async () => {
      const service = createAlertingService({
        serviceName: 'test-service',
        environment: 'test',
        version: '1.0.0',
        webhook: { url: 'https://example.com/webhook' },
        enabled: true,
      });

      await service.critical('db_down', 'Database connection lost');

      expect(mocks.dispatchedPayloads[0].correlation_id).toBeDefined();
      expect(typeof mocks.dispatchedPayloads[0].correlation_id).toBe('string');
      expect(mocks.dispatchedPayloads[0].correlation_id.length).toBeGreaterThan(0);
    });

    it('includes timestamp in ISO8601 format', async () => {
      const service = createAlertingService({
        serviceName: 'test-service',
        environment: 'test',
        version: '1.0.0',
        webhook: { url: 'https://example.com/webhook' },
        enabled: true,
      });

      await service.critical('db_down', 'Database connection lost');

      const timestamp = mocks.dispatchedPayloads[0].timestamp;
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('includes metadata with environment and version', async () => {
      const service = createAlertingService({
        serviceName: 'test-service',
        environment: 'production',
        version: '2.1.0',
        webhook: { url: 'https://example.com/webhook' },
        enabled: true,
      });

      await service.high('db_down', 'Database connection lost');

      expect(mocks.dispatchedPayloads[0].metadata).toEqual({
        environment: 'production',
        version: '2.1.0',
      });
    });

    it('alert method allows custom severity', async () => {
      const service = createAlertingService({
        serviceName: 'test-service',
        environment: 'test',
        version: '1.0.0',
        webhook: { url: 'https://example.com/webhook' },
        enabled: true,
      });

      await service.alert('unhandled_exception', 'critical', 'Something went wrong');

      expect(mocks.dispatchedPayloads[0].severity).toBe('critical');
      expect(mocks.dispatchedPayloads[0].alert_type).toBe('unhandled_exception');
    });

    it('does not dispatch when disabled', async () => {
      const service = createAlertingService({
        serviceName: 'test-service',
        environment: 'test',
        version: '1.0.0',
        enabled: false,
      });

      await service.critical('db_down', 'Database connection lost');

      expect(mocks.dispatchedPayloads.length).toBe(0);
    });

    it('does not dispatch when no webhook configured', async () => {
      const service = createAlertingService({
        serviceName: 'test-service',
        environment: 'test',
        version: '1.0.0',
        enabled: true,
      });

      await service.critical('db_down', 'Database connection lost');

      expect(mocks.dispatchedPayloads.length).toBe(0);
    });
  });

  describe('createAlertingHook', () => {
    it('creates hook object with error handlers', () => {
      const service = createAlertingService({
        serviceName: 'test-service',
        environment: 'test',
        version: '1.0.0',
        webhook: { url: 'https://example.com/webhook' },
        enabled: true,
      });

      const hooks = createAlertingHook(service);

      expect(typeof hooks.onDatabaseError).toBe('function');
      expect(typeof hooks.onRedisError).toBe('function');
      expect(typeof hooks.onGatewayError).toBe('function');
      expect(typeof hooks.onUnhandledException).toBe('function');
      expect(typeof hooks.onWorkerDeadlock).toBe('function');
      expect(typeof hooks.onCascadeFailure).toBe('function');
    });

    it('onDatabaseError triggers critical alert with db_down type', async () => {
      const service = createAlertingService({
        serviceName: 'test-service',
        environment: 'test',
        version: '1.0.0',
        webhook: { url: 'https://example.com/webhook' },
        enabled: true,
      });

      const hooks = createAlertingHook(service);
      await hooks.onDatabaseError(new Error('Connection refused'), { host: 'localhost' });

      expect(mocks.dispatchedPayloads[0].alert_type).toBe('db_down');
      expect(mocks.dispatchedPayloads[0].severity).toBe('critical');
    });

    it('onRedisError triggers high alert with redis_down type', async () => {
      const service = createAlertingService({
        serviceName: 'test-service',
        environment: 'test',
        version: '1.0.0',
        webhook: { url: 'https://example.com/webhook' },
        enabled: true,
      });

      const hooks = createAlertingHook(service);
      await hooks.onRedisError(new Error('Redis connection refused'));

      expect(mocks.dispatchedPayloads[0].alert_type).toBe('redis_down');
      expect(mocks.dispatchedPayloads[0].severity).toBe('high');
    });

    it('onGatewayError triggers high alert with gateway_unavailable type', async () => {
      const service = createAlertingService({
        serviceName: 'test-service',
        environment: 'test',
        version: '1.0.0',
        webhook: { url: 'https://example.com/webhook' },
        enabled: true,
      });

      const hooks = createAlertingHook(service);
      await hooks.onGatewayError(new Error('Gateway timeout'));

      expect(mocks.dispatchedPayloads[0].alert_type).toBe('gateway_unavailable');
      expect(mocks.dispatchedPayloads[0].severity).toBe('high');
    });

    it('onUnhandledException triggers critical alert with unhandled_exception type', async () => {
      const service = createAlertingService({
        serviceName: 'test-service',
        environment: 'test',
        version: '1.0.0',
        webhook: { url: 'https://example.com/webhook' },
        enabled: true,
      });

      const hooks = createAlertingHook(service);
      await hooks.onUnhandledException(new Error('Unexpected error'));

      expect(mocks.dispatchedPayloads[0].alert_type).toBe('unhandled_exception');
      expect(mocks.dispatchedPayloads[0].severity).toBe('critical');
    });

    it('onWorkerDeadlock triggers critical alert', async () => {
      const service = createAlertingService({
        serviceName: 'test-service',
        environment: 'test',
        version: '1.0.0',
        webhook: { url: 'https://example.com/webhook' },
        enabled: true,
      });

      const hooks = createAlertingHook(service);
      await hooks.onWorkerDeadlock({ workerId: 'worker-1' });

      expect(mocks.dispatchedPayloads[0].alert_type).toBe('worker_deadlock');
      expect(mocks.dispatchedPayloads[0].severity).toBe('critical');
    });

    it('onCascadeFailure triggers critical alert with count', async () => {
      const service = createAlertingService({
        serviceName: 'test-service',
        environment: 'test',
        version: '1.0.0',
        webhook: { url: 'https://example.com/webhook' },
        enabled: true,
      });

      const hooks = createAlertingHook(service);
      await hooks.onCascadeFailure(5, { firstFailure: 'worker-1' });

      expect(mocks.dispatchedPayloads[0].alert_type).toBe('worker_cascade_failure');
      expect(mocks.dispatchedPayloads[0].severity).toBe('critical');
      expect(mocks.dispatchedPayloads[0].message).toContain('5');
    });
  });

  describe('ALERT_TEMPLATES', () => {
    it('has templates for all alert types', () => {
      const expectedTypes = [
        'db_down',
        'db_connection_failed',
        'redis_down',
        'gateway_unavailable',
        'worker_deadlock',
        'worker_cascade_failure',
        'outbound_queue_overflow',
        'authentication_failure',
        'rate_limit_exceeded',
        'webhook_delivery_failed',
        'unhandled_exception',
      ];

      expect(ALERT_TEMPLATES.length).toBe(expectedTypes.length);

      for (const type of expectedTypes) {
        const template = ALERT_TEMPLATES.find((t) => t.type === type);
        expect(template).toBeDefined();
        expect(template!.fields).toContain('alert_type');
        expect(template!.fields).toContain('severity');
        expect(template!.fields).toContain('service');
        expect(template!.fields).toContain('timestamp');
        expect(template!.fields).toContain('correlation_id');
      }
    });

    it('critical alerts have critical severity', () => {
      const criticalTypes = [
        'db_down',
        'worker_deadlock',
        'worker_cascade_failure',
        'unhandled_exception',
      ];

      for (const type of criticalTypes) {
        const template = ALERT_TEMPLATES.find((t) => t.type === type);
        expect(template!.severity).toBe('critical');
      }
    });
  });
});
