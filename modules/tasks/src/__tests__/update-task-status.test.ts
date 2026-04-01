import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../infrastructure/repositories/task.repository', () => ({
  taskRepository: {
    findById: vi.fn(),
    updateStatus: vi.fn(),
    addStatusHistory: vi.fn(),
  },
}));

vi.mock('@cvg/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { updateTaskStatus } from '../application/use-cases/update-task-status.use-case';
import { taskRepository } from '../infrastructure/repositories/task.repository';

describe('updateTaskStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deve retornar erro quando task não existe', async () => {
    vi.mocked(taskRepository.findById).mockResolvedValue(null as any);

    const result = await updateTaskStatus({
      taskId: 'task-inexistente',
      status: 'completed',
    });

    expect(result.isErr()).toBe(true);
  });

  it('deve atualizar status de pending para in_progress', async () => {
    vi.mocked(taskRepository.findById).mockResolvedValue({
      id: 'task-001', status: 'pending', title: 'Test',
    } as any);
    vi.mocked(taskRepository.updateStatus).mockResolvedValue({
      id: 'task-001', status: 'in_progress', completedAt: null,
    } as any);

    const result = await updateTaskStatus({
      taskId: 'task-001', status: 'in_progress',
      changedBy: 'user-001', reason: 'Iniciando trabalho',
      userId: 'user-001',
    });

    expect(result.isOk()).toBe(true);
    expect(taskRepository.updateStatus).toHaveBeenCalledWith('task-001', 'in_progress');
    expect(taskRepository.addStatusHistory).toHaveBeenCalledWith(
      'task-001', 'in_progress', 'user-001', 'Iniciando trabalho'
    );
  });

  it('deve atualizar status para completed e registrar completedAt', async () => {
    vi.mocked(taskRepository.findById).mockResolvedValue({
      id: 'task-001', status: 'in_progress', title: 'Test',
    } as any);
    vi.mocked(taskRepository.updateStatus).mockResolvedValue({
      id: 'task-001', status: 'completed', completedAt: new Date(),
    } as any);

    const result = await updateTaskStatus({
      taskId: 'task-001', status: 'completed',
      changedBy: 'user-001', userId: 'user-001',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.status).toBe('completed');
    }
  });

  it('deve registrar audit log na mudança de status', async () => {
    vi.mocked(taskRepository.findById).mockResolvedValue({
      id: 'task-001', status: 'pending', title: 'Test',
    } as any);
    vi.mocked(taskRepository.updateStatus).mockResolvedValue({
      id: 'task-001', status: 'in_progress', completedAt: null,
    } as any);

    await updateTaskStatus({
      taskId: 'task-001', status: 'in_progress',
      userId: 'user-001', changedBy: 'user-001',
    });

    const { createAuditLog } = await import('@cvg/audit');
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-001',
        action: 'task.status.changed',
        entityType: 'task',
        entityId: 'task-001',
      })
    );
  });
});
