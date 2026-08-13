import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  return {
    taskRepository: {
      create: vi.fn(),
      findById: vi.fn(),
      findAll: vi.fn(),
      update: vi.fn(),
      updateStatus: vi.fn(),
      addStatusHistory: vi.fn(),
      delete: vi.fn(),
    },
    createAuditLog: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../infrastructure/repositories/task.repository', () => ({
  taskRepository: mocks.taskRepository,
}));
vi.mock('@cvg/audit', () => ({
  createAuditLog: mocks.createAuditLog,
}));

import { createTask, type CreateTaskInput } from '../application/use-cases/create-task.use-case';
import { updateTaskStatus, type UpdateTaskStatusInput } from '../application/use-cases/update-task-status.use-case';

describe('task use-case edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockTask = {
    id: 'task-001',
    conversationId: 'conv-123',
    tutorId: 'tutor-456',
    patientId: 'patient-789',
    title: 'Edge task',
    description: 'Validate failure paths',
    priority: 'high' as const,
    status: 'pending',
    assignedTo: 'user-001',
    createdBy: 'user-002',
    dueAt: new Date('2026-04-30'),
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null as Date | null,
  };

  describe('createTask failure behavior', () => {
    it('returns error when repository create fails and does not write history', async () => {
      mocks.taskRepository.create.mockRejectedValue(new Error('Database unavailable'));

      const input: CreateTaskInput = {
        title: 'Cannot persist task',
        userId: 'auditor-001',
      };

      const result = await createTask(input);

      expect(result.isErr()).toBe(true);
      expect(mocks.taskRepository.addStatusHistory).not.toHaveBeenCalled();
      expect(mocks.createAuditLog).not.toHaveBeenCalled();
    });

    it('returns error when status history write fails after task creation', async () => {
      mocks.taskRepository.create.mockResolvedValue(mockTask);
      mocks.taskRepository.addStatusHistory.mockRejectedValue(new Error('Status history unavailable'));

      const input: CreateTaskInput = {
        title: 'History failure task',
        userId: 'auditor-002',
      };

      const result = await createTask(input);

      expect(result.isErr()).toBe(true);
      expect(mocks.taskRepository.create).toHaveBeenCalledTimes(1);
      expect(mocks.createAuditLog).not.toHaveBeenCalled();
    });
  });

  describe('updateTaskStatus failure behavior', () => {
    it('rejects invalid status before touching repository', async () => {
      const input: UpdateTaskStatusInput = {
        taskId: 'task-001',
        status: 'archived',
      };

      const result = await updateTaskStatus(input);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Invalid task status');
      }
      expect(mocks.taskRepository.findById).not.toHaveBeenCalled();
      expect(mocks.taskRepository.updateStatus).not.toHaveBeenCalled();
      expect(mocks.taskRepository.addStatusHistory).not.toHaveBeenCalled();
    });

    it('returns error when repository update fails and does not write status history', async () => {
      mocks.taskRepository.findById.mockResolvedValue(mockTask);
      mocks.taskRepository.updateStatus.mockRejectedValue(new Error('Update failed'));

      const input: UpdateTaskStatusInput = {
        taskId: 'task-001',
        status: 'completed',
      };

      const result = await updateTaskStatus(input);

      expect(result.isErr()).toBe(true);
      expect(mocks.taskRepository.findById).toHaveBeenCalledWith('task-001');
      expect(mocks.taskRepository.updateStatus).toHaveBeenCalledWith('task-001', 'completed');
      expect(mocks.taskRepository.addStatusHistory).not.toHaveBeenCalled();
    });
  });
});
