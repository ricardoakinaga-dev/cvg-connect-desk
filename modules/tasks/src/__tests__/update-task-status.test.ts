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

import { updateTaskStatus, type UpdateTaskStatusInput } from '../application/use-cases/update-task-status.use-case';

describe('updateTaskStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockTask = {
    id: 'task-123',
    conversationId: 'conv-456',
    tutorId: 'tutor-789',
    patientId: 'patient-101',
    title: 'Follow up with client',
    description: 'Call back to confirm appointment',
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

  const mockUpdatedTask = {
    ...mockTask,
    status: 'completed',
    completedAt: new Date(),
  };

  describe('task not found', () => {
    it('returns error when task does not exist', async () => {
      mocks.taskRepository.findById.mockResolvedValue(null);

      const input: UpdateTaskStatusInput = {
        taskId: 'non-existent-id',
        status: 'completed',
      };

      const result = await updateTaskStatus(input);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Task not found');
      }
    });

    it('returns error for invalid status', async () => {
      const input = {
        taskId: 'task-123',
        status: 'archived',
      } as UpdateTaskStatusInput;

      const result = await updateTaskStatus(input);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Invalid task status');
      }
    });

    it('does not load task or write history for invalid status', async () => {
      const input = {
        taskId: 'task-123',
        status: 'archived',
      } as UpdateTaskStatusInput;

      const result = await updateTaskStatus(input);

      expect(result.isErr()).toBe(true);
      expect(mocks.taskRepository.findById).not.toHaveBeenCalled();
      expect(mocks.taskRepository.addStatusHistory).not.toHaveBeenCalled();
    });
  });

  describe('status transitions', () => {
    beforeEach(() => {
      mocks.taskRepository.findById.mockResolvedValue(mockTask);
      mocks.taskRepository.updateStatus.mockResolvedValue(mockUpdatedTask);
      mocks.taskRepository.addStatusHistory.mockResolvedValue(undefined);
    });

    it('updates task status to completed', async () => {
      const input: UpdateTaskStatusInput = {
        taskId: 'task-123',
        status: 'completed',
        changedBy: 'user-001',
        reason: 'Task finished',
      };

      const result = await updateTaskStatus(input);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.id).toBe('task-123');
        expect(result.value.status).toBe('completed');
        expect(result.value.completedAt).toBeTruthy();
      }
    });

    it('updates task status to in_progress', async () => {
      mocks.taskRepository.updateStatus.mockResolvedValue({
        ...mockTask,
        status: 'in_progress',
      });

      const input: UpdateTaskStatusInput = {
        taskId: 'task-123',
        status: 'in_progress',
      };

      const result = await updateTaskStatus(input);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.status).toBe('in_progress');
        expect(result.value.completedAt).toBeNull();
      }
    });

    it('updates task status to cancelled', async () => {
      mocks.taskRepository.updateStatus.mockResolvedValue({
        ...mockTask,
        status: 'cancelled',
      });

      const input: UpdateTaskStatusInput = {
        taskId: 'task-123',
        status: 'cancelled',
        reason: 'Customer cancelled request',
      };

      const result = await updateTaskStatus(input);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.status).toBe('cancelled');
      }
    });

    it('adds status history with reason', async () => {
      const input: UpdateTaskStatusInput = {
        taskId: 'task-123',
        status: 'completed',
        changedBy: 'user-001',
        reason: 'Work is done',
      };

      await updateTaskStatus(input);

      expect(mocks.taskRepository.addStatusHistory).toHaveBeenCalledWith(
        'task-123',
        'completed',
        'user-001',
        'Work is done'
      );
    });

    it('adds status history without reason when not provided', async () => {
      mocks.taskRepository.addStatusHistory.mockClear();

      const input: UpdateTaskStatusInput = {
        taskId: 'task-123',
        status: 'in_progress',
      };

      await updateTaskStatus(input);

      expect(mocks.taskRepository.addStatusHistory).toHaveBeenCalledWith(
        'task-123',
        'in_progress',
        undefined,
        undefined
      );
    });
  });

  describe('audit logging', () => {
    beforeEach(() => {
      mocks.taskRepository.findById.mockResolvedValue(mockTask);
      mocks.taskRepository.updateStatus.mockResolvedValue(mockUpdatedTask);
      mocks.taskRepository.addStatusHistory.mockResolvedValue(undefined);
    });

    it('creates audit log when userId is provided', async () => {
      const input: UpdateTaskStatusInput = {
        taskId: 'task-123',
        status: 'completed',
        userId: 'user-001',
        changedBy: 'user-002',
        reason: 'Task finished',
      };

      await updateTaskStatus(input);

      expect(mocks.createAuditLog).toHaveBeenCalledWith({
        userId: 'user-001',
        action: 'task.status.changed',
        entityType: 'task',
        entityId: 'task-123',
        oldValue: { status: 'pending' },
        newValue: { status: 'completed' },
        metadata: {
          reason: 'Task finished',
          changedBy: 'user-002',
        },
      });
    });

    it('does not create audit log when userId is not provided', async () => {
      mocks.createAuditLog.mockClear();

      const input: UpdateTaskStatusInput = {
        taskId: 'task-123',
        status: 'completed',
      };

      await updateTaskStatus(input);

      expect(mocks.createAuditLog).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('returns error when repository throws', async () => {
      mocks.taskRepository.findById.mockResolvedValue(mockTask);
      mocks.taskRepository.updateStatus.mockRejectedValue(new Error('Database connection failed'));

      const input: UpdateTaskStatusInput = {
        taskId: 'task-123',
        status: 'completed',
      };

      const result = await updateTaskStatus(input);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Database connection failed');
      }
    });
  });
});
