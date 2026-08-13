import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  operationalMetrics: vi.fn().mockResolvedValue({
    generatedAt: '2026-04-10T12:00:00.000Z',
    outbox: { pending: 0, retrying: 0, oldestCreatedAt: null, oldestAgeMs: 0 },
    deadLetter: { unresolved: 0, retrying: 0, oldestFailedAt: null, oldestAgeMs: 0 },
    thresholds: { outboxPending: 100, deadLetterUnresolved: 10, triggered: [] },
  }),
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
  operationalMetricsApi: {
    get: mocks.operationalMetrics,
  },
  getErrorMessage: (error: unknown, fallback = 'Erro inesperado') => error instanceof Error ? error.message : fallback,
}));

describe('Admin page', () => {
  beforeEach(() => {
    mocks.operationalMetrics.mockResolvedValue(emptyOperationalMetricsForTest());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
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

  it('manages users, sector permissions and every administrative resource form', async () => {
    mocks.get.mockImplementation(async (endpoint: string) => {
      switch (endpoint) {
        case '/admin/users':
          return [
            { id: 'user-1', name: 'Ana', email: 'ana@example.com', isActive: true, createdAt: '2026-04-10T12:00:00.000Z' },
            { id: 'user-2', name: 'Bruno', email: 'bruno@example.com', isActive: false, createdAt: '2026-04-10T12:00:00.000Z' },
          ];
        case '/admin/roles':
          return [{ id: 'role-1', name: 'Atendente', description: null }];
        case '/admin/queues':
          return [{ id: 'queue-1', name: 'Recepção', description: null, isActive: true }];
        case '/admin/teams':
          return [{ id: 'team-1', name: 'Clínica', description: 'Equipe clínica', isActive: false }];
        case '/sectors?all=true':
          return [{ id: 'sector-1', name: 'Clínica', code: 'CLI', icon: 'C', color: '#2563eb' }];
        case '/admin/users/user-1/sectors':
          return [{ sectorId: 'sector-1', sectorName: 'Clínica', sectorIcon: 'C', sectorColor: '#2563eb', accessLevel: 'read' }];
        default:
          return [];
      }
    });
    mocks.list.mockResolvedValue({ data: [], stats: { total: 0, unresolved: 0, resolved: 0 } });
    mocks.dlStats.mockResolvedValue({ ...emptyDeadLetterSummaryForTest() });
    mocks.webhookStats.mockResolvedValue(emptyWebhookStatsForTest());
    mocks.post.mockResolvedValue({});
    mocks.put.mockResolvedValue({});
    mocks.delete.mockResolvedValue({});

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(<Admin />);

    expect(await screen.findByText('Ana')).toBeTruthy();
    expect(screen.getByText('Inativo')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Novo Usuário/ }));
    fireEvent.change(screen.getByPlaceholderText('Nome'), { target: { value: 'Carla' } });
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'carla@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'StrongPass!2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/admin/users', {
      name: 'Carla',
      email: 'carla@example.com',
      password: 'StrongPass!2026',
    }));

    fireEvent.click(screen.getAllByRole('button', { name: 'Setores' })[0]);
    expect(await screen.findByText('Permissões por Setor')).toBeTruthy();
    const sectorCheckbox = screen.getByRole('checkbox');
    fireEvent.click(sectorCheckbox);
    fireEvent.click(sectorCheckbox);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar Permissões' }));
    await waitFor(() => expect(mocks.put).toHaveBeenCalledWith('/admin/users/user-1/sectors', {
      sectors: [{ sectorId: 'sector-1', accessLevel: 'admin' }],
    }));
    expect(alertSpy).toHaveBeenCalledWith('Permissões salvas!');

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'DEL' })[0]);
    await waitFor(() => expect(mocks.delete).toHaveBeenCalledWith('/admin/users/user-1'));
    expect(confirmSpy).toHaveBeenCalled();

    const resourceForms = [
      { tab: 'Papéis', button: /Novo Papel/, fields: [['Nome do papel', 'Supervisor'], ['Descrição', 'Supervisão']] },
      { tab: 'Filas', button: /Novo Fila/, fields: [['Nome da fila', 'Clínica'], ['Descrição', 'Fila clínica']] },
      { tab: 'Times', button: /Novo Time/, fields: [['Nome do time', 'Plantão'], ['Descrição', 'Equipe de plantão']] },
    ] as const;

    for (const resource of resourceForms) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(resource.tab) }));
      fireEvent.click(screen.getByRole('button', { name: resource.button }));
      for (const [placeholder, value] of resource.fields) {
        fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
      }
      fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
      await waitFor(() => expect(mocks.post).toHaveBeenCalledWith(
        `/admin/${resource.tab === 'Papéis' ? 'roles' : resource.tab === 'Filas' ? 'queues' : 'teams'}`,
        expect.objectContaining({ name: resource.fields[0][1] }),
      ));
    }
  });

  it('filters dead-letters and reports retry and resolve failures', async () => {
    const openEntry = {
      id: 'dlq-open',
      eventType: 'message.persisted',
      eventId: 'evt-open',
      payload: { messageId: 'msg-open' },
      error: 'Timeout',
      failedAt: '2026-04-10T12:00:00.000Z',
      retryCount: 1,
      handlerName: 'worker.processMessage',
      resolved: false,
      sourceEvent: null,
      failureContext: null,
    };
    const resolvedEntry = {
      ...openEntry,
      id: 'dlq-resolved',
      eventId: 'evt-resolved',
      eventType: 'task.created',
      resolved: true,
      resolvedAt: '2026-04-10T13:00:00.000Z',
      sourceEvent: { event_id: 'evt-resolved', payload: {} },
    };

    mocks.get.mockResolvedValue([]);
    mocks.list.mockResolvedValue({
      data: [openEntry, resolvedEntry],
      stats: { total: 2, unresolved: 1, resolved: 1 },
    });
    mocks.dlStats.mockResolvedValue(emptyDeadLetterSummaryForTest());
    mocks.webhookStats.mockResolvedValue(emptyWebhookStatsForTest());
    render(<Admin />);

    fireEvent.click(await screen.findByRole('button', { name: /dead-letter/i }));
    expect(await screen.findByText('Sem contexto estruturado')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/Filtrar por evento/), { target: { value: 'does-not-exist' } });
    expect(screen.queryByText('task.created', { selector: 'strong' })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/Filtrar por evento/), { target: { value: '' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'resolved' } });
    expect(await screen.findByText('task.created', { selector: 'strong' })).toBeTruthy();

    mocks.retry.mockResolvedValue({ success: true, replayed: true, entry: null });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'all' } });
    fireEvent.click(screen.getByText('message.persisted', { selector: 'strong' }));
    const retryButton = screen.getAllByRole('button', { name: 'Retry' })[0];
    expect(retryButton.hasAttribute('disabled')).toBe(true);

    mocks.resolve.mockRejectedValueOnce(new Error('resolve unavailable'));
    const resolveButtons = screen.getAllByRole('button', { name: 'Marcar resolvida' });
    fireEvent.click(resolveButtons[0]);
    await waitFor(() => expect(screen.getByText('resolve unavailable')).toBeTruthy());
  });
});

function emptyDeadLetterSummaryForTest() {
  return {
    total: 0,
    unresolved: 0,
    resolved: 0,
    replayable: 0,
    manualOnly: 0,
    byHandler: [],
    byReason: [],
    lastFailedAt: null,
  };
}

function emptyWebhookStatsForTest() {
  return {
    total: 0,
    allowed: 0,
    denied: 0,
    byReason: {
      missing_secret: 0,
      missing_signature: 0,
      invalid_signature_format: 0,
      invalid_signature: 0,
      signature_valid: 0,
    },
    lastDecisionAt: null,
    lastDecision: null,
  };
}

function emptyOperationalMetricsForTest() {
  return {
    generatedAt: '2026-04-10T12:00:00.000Z',
    outbox: { pending: 0, retrying: 0, oldestCreatedAt: null, oldestAgeMs: 0 },
    deadLetter: { unresolved: 0, retrying: 0, oldestFailedAt: null, oldestAgeMs: 0 },
    thresholds: { outboxPending: 100, deadLetterUnresolved: 10, triggered: [] },
  };
}
