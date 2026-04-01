import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../infrastructure/repositories/alert.repository', () => ({
  alertRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    acknowledge: vi.fn(),
    resolve: vi.fn(),
    addEvent: vi.fn(),
    findAll: vi.fn(),
    findActive: vi.fn(),
  },
}));

vi.mock('@cvg/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { createAlert } from '../application/use-cases/create-alert.use-case';
import { acknowledgeAlert } from '../application/use-cases/acknowledge-alert.use-case';
import { resolveAlert } from '../application/use-cases/resolve-alert.use-case';
import { alertRepository } from '../infrastructure/repositories/alert.repository';

describe('createAlert', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deve retornar erro quando title está vazio', async () => {
    const result = await createAlert({ title: '', type: 'message' as any });
    expect(result.isErr()).toBe(true);
  });

  it('deve retornar erro quando type está vazio', async () => {
    const result = await createAlert({ title: 'Test', type: '' as any });
    expect(result.isErr()).toBe(true);
  });

  it('deve criar alert com sucesso', async () => {
    vi.mocked(alertRepository.create).mockResolvedValue({
      id: 'alert-001', title: 'Conversa sem resposta', type: 'message',
      severity: 'warning', status: 'active', createdAt: new Date(),
    } as any);

    const result = await createAlert({
      title: 'Conversa sem resposta', type: 'message' as any,
      severity: 'warning', conversationId: 'conv-001', userId: 'user-001',
    });

    expect(result.isOk()).toBe(true);
    expect(alertRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Conversa sem resposta', type: 'message', severity: 'warning', status: 'active' })
    );
  });

  it('deve usar severity info como default', async () => {
    vi.mocked(alertRepository.create).mockResolvedValue({
      id: 'alert-002', title: 'Alert', type: 'message',
      severity: 'info', status: 'active', createdAt: new Date(),
    } as any);

    await createAlert({ title: 'Alert', type: 'message' as any });
    expect(alertRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'info' })
    );
  });
});

describe('acknowledgeAlert', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deve retornar erro quando alert não existe', async () => {
    vi.mocked(alertRepository.findById).mockResolvedValue(null as any);
    const result = await acknowledgeAlert({ alertId: 'inexistente', acknowledgedBy: 'user-001' });
    expect(result.isErr()).toBe(true);
  });

  it('deve retornar erro quando alert já está resolvido', async () => {
    vi.mocked(alertRepository.findById).mockResolvedValue({ id: 'alert-001', status: 'resolved' } as any);
    const result = await acknowledgeAlert({ alertId: 'alert-001', acknowledgedBy: 'user-001' });
    expect(result.isErr()).toBe(true);
  });

  it('deve retornar erro quando alert já está acknowledged', async () => {
    vi.mocked(alertRepository.findById).mockResolvedValue({ id: 'alert-001', status: 'acknowledged' } as any);
    const result = await acknowledgeAlert({ alertId: 'alert-001', acknowledgedBy: 'user-001' });
    expect(result.isErr()).toBe(true);
  });

  it('deve acknowledge alert com sucesso', async () => {
    vi.mocked(alertRepository.findById).mockResolvedValue({ id: 'alert-001', status: 'active' } as any);
    vi.mocked(alertRepository.acknowledge).mockResolvedValue({
      id: 'alert-001', status: 'acknowledged', acknowledgedBy: 'user-001',
      acknowledgedAt: new Date(),
    } as any);

    const result = await acknowledgeAlert({ alertId: 'alert-001', acknowledgedBy: 'user-001', userId: 'user-001' });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.status).toBe('acknowledged');
    }
  });
});

describe('resolveAlert', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deve retornar erro quando alert não existe', async () => {
    vi.mocked(alertRepository.findById).mockResolvedValue(null as any);
    const result = await resolveAlert({ alertId: 'inexistente', resolvedBy: 'user-001' });
    expect(result.isErr()).toBe(true);
  });

  it('deve retornar erro quando alert já está resolvido', async () => {
    vi.mocked(alertRepository.findById).mockResolvedValue({ id: 'alert-001', status: 'resolved' } as any);
    const result = await resolveAlert({ alertId: 'alert-001', resolvedBy: 'user-001' });
    expect(result.isErr()).toBe(true);
  });

  it('deve resolver alert com sucesso', async () => {
    vi.mocked(alertRepository.findById).mockResolvedValue({ id: 'alert-001', status: 'active' } as any);
    vi.mocked(alertRepository.resolve).mockResolvedValue({
      id: 'alert-001', status: 'resolved', resolvedBy: 'user-001',
      resolvedAt: new Date(),
    } as any);

    const result = await resolveAlert({ alertId: 'alert-001', resolvedBy: 'user-001', userId: 'user-001' });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.status).toBe('resolved');
    }
  });
});
