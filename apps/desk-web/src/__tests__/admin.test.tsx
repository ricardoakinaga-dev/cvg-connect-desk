import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Admin } from '../pages/Admin';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
  dlStats: vi.fn(),
  webhookStats: vi.fn(),
  retry: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: {
    get: mocks.get,
    post: mocks.post,
    put: mocks.put,
    delete: mocks.delete,
  },
  deadLetterApi: {
    list: mocks.list,
    stats: mocks.dlStats,
    retry: mocks.retry,
    resolve: mocks.resolve,
  },
  webhookSecurityApi: {
    stats: mocks.webhookStats,
  },
}));

describe('Admin page', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('loads dead-letter entries from the admin dead-letter endpoint and renders actions', async () => {
    mocks.get.mockImplementation(async (endpoint: string) => {
      switch (endpoint) {
        case '/admin/users':
        case '/admin/roles':
        case '/admin/queues':
        case '/admin/teams':
        case '/sectors?all=true':
          return [];
        case '/admin/dead-letters/stats':
          return {
            total: 1,
            unresolved: 1,
            resolved: 0,
            replayable: 1,
            manualOnly: 0,
            byHandler: [
              {
                handlerName: 'worker.processMessage',
                total: 1,
                unresolved: 1,
                resolved: 0,
                replayable: 1,
                manualOnly: 0,
              },
            ],
            byReason: [
              {
                reason: 'Timeout',
                total: 1,
                unresolved: 1,
                resolved: 0,
                replayable: 1,
                manualOnly: 0,
              },
            ],
            lastFailedAt: '2026-04-10T12:00:00.000Z',
          };
        case '/admin/webhook-security/stats':
          return {
            total: 2,
            allowed: 1,
            denied: 1,
            byReason: {
              missing_secret: 0,
              missing_signature: 1,
              invalid_signature_format: 0,
              invalid_signature: 0,
              signature_valid: 1,
            },
            lastDecisionAt: '2026-04-10T12:00:00.000Z',
            lastDecision: {
              reason: 'signature_valid',
              allowed: true,
              webhookMode: 'hmac',
              hasSecret: true,
              signaturePresent: true,
              timestamp: '2026-04-10T12:00:00.000Z',
            },
          };
        default:
          return [];
      }
    });

    mocks.list.mockResolvedValue({
      data: [
        {
          id: 'dlq_1',
          eventType: 'message.persisted',
          eventId: 'evt_1',
          payload: { messageId: 'msg_1' },
          error: 'Timeout',
          failedAt: '2026-04-10T12:00:00.000Z',
          retryCount: 2,
          handlerName: 'worker.processMessage',
          resolved: false,
          sourceEvent: {
            event_id: 'evt_1',
            event_type: 'message.persisted',
            aggregate_type: 'Message',
            aggregate_id: 'msg_1',
            occurred_at: '2026-04-10T11:59:00.000Z',
            payload: { messageId: 'msg_1' },
            version: 1,
          },
          failureContext: {
            stage: 'worker-terminal',
            decision: 'dead-letter',
            handlerName: 'worker.processMessage',
            eventType: 'message.persisted',
            eventId: 'evt_1',
            retryCount: 2,
            retryable: true,
            reason: 'Timeout',
            eventVersion: 1,
            correlationId: 'corr_1',
          },
        },
      ],
      stats: { total: 1, unresolved: 1, resolved: 0 },
    });
    mocks.dlStats.mockResolvedValue({
      total: 1,
      unresolved: 1,
      resolved: 0,
      replayable: 1,
      manualOnly: 0,
      byHandler: [
        {
          handlerName: 'worker.processMessage',
          total: 1,
          unresolved: 1,
          resolved: 0,
          replayable: 1,
          manualOnly: 0,
        },
      ],
      byReason: [
        {
          reason: 'Timeout',
          total: 1,
          unresolved: 1,
          resolved: 0,
          replayable: 1,
          manualOnly: 0,
        },
      ],
      lastFailedAt: '2026-04-10T12:00:00.000Z',
    });
    mocks.webhookStats.mockResolvedValue({
      total: 2,
      allowed: 1,
      denied: 1,
      byReason: {
        missing_secret: 0,
        missing_signature: 1,
        invalid_signature_format: 0,
        invalid_signature: 0,
        signature_valid: 1,
      },
      lastDecisionAt: '2026-04-10T12:00:00.000Z',
      lastDecision: {
        reason: 'signature_valid',
        allowed: true,
        webhookMode: 'hmac',
        hasSecret: true,
        signaturePresent: true,
        timestamp: '2026-04-10T12:00:00.000Z',
      },
    });

    render(<Admin />);

    await waitFor(() => {
      expect(mocks.list).toHaveBeenCalledWith({ limit: 100 });
    });

    fireEvent.click(await screen.findByRole('button', { name: /dead-letter/i }));

    expect(await screen.findByText('message.persisted', { selector: 'strong' })).toBeTruthy();
    expect(screen.getAllByText('worker.processMessage').length).toBeGreaterThan(0);
    expect(await screen.findByText('worker-terminal • dead-letter • Timeout', { selector: 'strong' })).toBeTruthy();
    expect(screen.getAllByText('Replayáveis', { selector: '.stat-label' })).toHaveLength(2);
    expect(await screen.findByText('Webhook security', { selector: 'h4' })).toBeTruthy();

    mocks.resolve.mockResolvedValue({
      success: true,
      replayed: false,
      entry: null,
    });

    fireEvent.click(screen.getByRole('button', { name: /marcar resolvida/i }));

    await waitFor(() => {
      expect(mocks.resolve).toHaveBeenCalledWith('dlq_1');
    });
  });
});
