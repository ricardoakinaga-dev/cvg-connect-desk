import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDashboardSummary: vi.fn(),
  getConversationMetrics: vi.fn(),
  getConversationVolume: vi.fn(),
  getConversationsByStatus: vi.fn(),
  getTaskMetrics: vi.fn(),
  getTasksOverdue: vi.fn(),
  getAlertMetrics: vi.fn(),
  getAlertsActive: vi.fn(),
  getFirstResponseTimeMetric: vi.fn(),
  getHandoffRateMetric: vi.fn(),
}));

vi.mock('../infrastructure', () => ({
  dashboardRepository: mocks,
}));

import * as useCases from '../application/use-cases';

describe('dashboard use cases', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('composes dashboard summary from repository metrics', async () => {
    mocks.getDashboardSummary.mockResolvedValue({
      conversations: { open: 3, pending: 1, closed: 2, archived: 0, total: 6 },
      tasks: { total: 5, pending: 2, inProgress: 1, completed: 1, cancelled: 1, overdue: 0 },
      alerts: { total: 4, active: 1, acknowledged: 1, resolved: 2, bySeverity: { info: 1, warning: 1, error: 1, critical: 1 } },
      generatedAt: '2026-04-10T12:00:00.000Z',
    });

    const result = await useCases.getDashboardSummary();

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.generatedAt).toBe('2026-04-10T12:00:00.000Z');
    }
  });

  it('counts open conversations using open and pending statuses', async () => {
    mocks.getConversationsByStatus.mockResolvedValue(7);

    const result = await useCases.getOpenConversationsCount();

    expect(result.isOk()).toBe(true);
    expect(mocks.getConversationsByStatus).toHaveBeenCalledWith(['open', 'pending']);
    if (result.isOk()) {
      expect(result.value).toBe(7);
    }
  });

  it('passes the provided date to overdue task counting', async () => {
    const asOf = new Date('2026-04-10T12:00:00.000Z');
    mocks.getTasksOverdue.mockResolvedValue(3);

    const result = await useCases.getOverdueTasksCount(asOf);

    expect(result.isOk()).toBe(true);
    expect(mocks.getTasksOverdue).toHaveBeenCalledWith(asOf);
    if (result.isOk()) {
      expect(result.value).toBe(3);
    }
  });

  it('counts active alerts using active status only', async () => {
    mocks.getAlertsActive.mockResolvedValue(5);

    const result = await useCases.getActiveAlertsCount();

    expect(result.isOk()).toBe(true);
    expect(mocks.getAlertsActive).toHaveBeenCalledWith(['active']);
    if (result.isOk()) {
      expect(result.value).toBe(5);
    }
  });

  // D1: First Response Time Metric
  it('calculates first response time metric for given period', async () => {
    const startDate = new Date('2026-04-01T00:00:00.000Z');
    const endDate = new Date('2026-04-30T23:59:59.999Z');
    mocks.getFirstResponseTimeMetric.mockResolvedValue({
      avgResponseTimeMs: 12500,
      count: 10,
      period: '2026-04-01 - 2026-04-30',
      calculatedAt: '2026-04-24T12:00:00.000Z',
    });

    const result = await useCases.getFirstResponseTimeMetric(startDate, endDate);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.avgResponseTimeMs).toBe(12500);
      expect(result.value.count).toBe(10);
    }
  });

  // D2: Handoff Rate Metric
  it('calculates handoff rate for given period', async () => {
    const startDate = new Date('2026-04-01T00:00:00.000Z');
    const endDate = new Date('2026-04-30T23:59:59.999Z');
    mocks.getHandoffRateMetric.mockResolvedValue({
      handoffRate: 45.5,
      totalConversations: 100,
      conversationsWithHandoff: 45,
      period: '2026-04-01 - 2026-04-30',
      calculatedAt: '2026-04-24T12:00:00.000Z',
    });

    const result = await useCases.getHandoffRateMetric(startDate, endDate);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.handoffRate).toBe(45.5);
      expect(result.value.totalConversations).toBe(100);
      expect(result.value.conversationsWithHandoff).toBe(45);
    }
  });
});
