import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../infrastructure/repositories/task.repository', () => ({
  taskRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    updateStatus: vi.fn(),
    addStatusHistory: vi.fn(),
    findAll: vi.fn(),
    findOverdue: vi.fn(),
  },
}));

vi.mock('@cvg/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { createTask } from '../application/use-cases/create-task.use-case';
import { taskRepository } from '../infrastructure/repositories/task.repository';

describe('createTask', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deve retornar erro quando title está vazio', async () => {
    const result = await createTask({ title: '' });
    expect(result.isErr()).toBe(true);
  });

  it('deve criar task com vínculo a conversation', async () => {
    vi.mocked(taskRepository.create).mockResolvedValue({
      id: 'task-001', title: 'Ligar tutor', status: 'pending',
      priority: 'high', conversationId: 'conv-001', createdAt: new Date(),
    } as any);
    vi.mocked(taskRepository.addStatusHistory).mockResolvedValue(undefined as any);

    const result = await createTask({
      title: 'Ligar tutor', conversationId: 'conv-001',
      priority: 'high', userId: 'user-001',
    });

    expect(result.isOk()).toBe(true);
    expect(taskRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Ligar tutor', conversationId: 'conv-001', priority: 'high', status: 'pending' })
    );
  });

  it('deve criar task com vínculo a tutorId', async () => {
    vi.mocked(taskRepository.create).mockResolvedValue({
      id: 'task-002', title: 'Agendar retorno', status: 'pending',
      tutorId: 'tutor-001', createdAt: new Date(),
    } as any);

    const result = await createTask({ title: 'Agendar retorno', tutorId: 'tutor-001' });
    expect(result.isOk()).toBe(true);
    expect(taskRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ tutorId: 'tutor-001' })
    );
  });

  it('deve criar task com vínculo a patientId', async () => {
    vi.mocked(taskRepository.create).mockResolvedValue({
      id: 'task-003', title: 'Exame sangue', status: 'pending',
      patientId: 'patient-001', createdAt: new Date(),
    } as any);

    const result = await createTask({ title: 'Exame sangue', patientId: 'patient-001' });
    expect(result.isOk()).toBe(true);
  });

  it('deve usar prioridade medium como default', async () => {
    vi.mocked(taskRepository.create).mockResolvedValue({
      id: 'task-004', title: 'Task sem prioridade', status: 'pending',
      priority: 'medium', createdAt: new Date(),
    } as any);

    await createTask({ title: 'Task sem prioridade' });
    expect(taskRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'medium' })
    );
  });
});
