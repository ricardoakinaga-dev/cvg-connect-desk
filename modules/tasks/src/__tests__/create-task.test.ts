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

describe('createTask', () => {
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
  };

  describe('input validation', () => {
    it('returns error when title is missing', async () => {
      const input: CreateTaskInput = {
        title: '',
      };

      const result = await createTask(input);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Title is required');
      }
    });

    it('returns error when title is only whitespace', async () => {
      const input: CreateTaskInput = {
        title: '   ',
      };

      const result = await createTask(input);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Title is required');
      }
    });
  });

  describe('task creation', () => {
    beforeEach(() => {
      mocks.taskRepository.create.mockResolvedValue(mockTask);
      mocks.taskRepository.addStatusHistory.mockResolvedValue(undefined);
    });

    it('creates task with correct fields', async () => {
      const input: CreateTaskInput = {
        title: 'Follow up with client',
        description: 'Call back to confirm appointment',
        priority: 'high',
        conversationId: 'conv-456',
        tutorId: 'tutor-789',
        patientId: 'patient-101',
        assignedTo: 'user-001',
        createdBy: 'user-002',
        dueAt: new Date('2026-04-30'),
      };

      await createTask(input);

      expect(mocks.taskRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-456',
          tutorId: 'tutor-789',
          patientId: 'patient-101',
          title: 'Follow up with client',
          description: 'Call back to confirm appointment',
          priority: 'high',
          status: 'pending',
          assignedTo: 'user-001',
          createdBy: 'user-002',
          dueAt: expect.any(Date),
        })
      );
    });

    it('defaults priority to medium when not provided', async () => {
      mocks.taskRepository.create.mockClear();

      const input: CreateTaskInput = {
        title: 'Simple task',
      };

      await createTask(input);

      expect(mocks.taskRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          priority: 'medium',
        })
      );
    });

    it('adds status history when task is created', async () => {
      const input: CreateTaskInput = {
        title: 'Follow up with client',
      };

      await createTask(input);

      expect(mocks.taskRepository.addStatusHistory).toHaveBeenCalledWith(
        'task-123',
        'pending',
        undefined,
        'Task created'
      );
    });

    it('creates audit log when userId is provided', async () => {
      const input: CreateTaskInput = {
        title: 'Follow up with client',
        userId: 'user-001',
        createdBy: 'user-002',
        priority: 'high',
        assignedTo: 'user-003',
        dueAt: new Date('2026-04-30'),
      };

      await createTask(input);

      expect(mocks.createAuditLog).toHaveBeenCalledWith({
        userId: 'user-001',
        action: 'task.created',
        entityType: 'task',
        entityId: 'task-123',
        newValue: {
          title: mockTask.title,
          priority: mockTask.priority,
          assignedTo: mockTask.assignedTo,
          dueAt: mockTask.dueAt,
        },
        metadata: {
          conversationId: undefined,
          createdBy: 'user-002',
        },
      });
    });

    it('returns ok result with task data', async () => {
      const input: CreateTaskInput = {
        title: 'Follow up with client',
      };

      const result = await createTask(input);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.id).toBe('task-123');
        expect(result.value.title).toBe('Follow up with client');
        expect(result.value.status).toBe('pending');
      }
    });

    it('stringifies metadata when provided', async () => {
      mocks.taskRepository.create.mockClear();

      const input: CreateTaskInput = {
        title: 'Task with metadata',
        metadata: { source: 'chat', channel: 'whatsapp' },
      };

      await createTask(input);

      expect(mocks.taskRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: JSON.stringify({ source: 'chat', channel: 'whatsapp' }),
        })
      );
    });

    it('handles missing optional fields correctly', async () => {
      mocks.taskRepository.create.mockClear();

      const input: CreateTaskInput = {
        title: 'Minimal task',
      };

      await createTask(input);

      expect(mocks.taskRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: undefined,
          tutorId: undefined,
          patientId: undefined,
          description: undefined,
          assignedTo: undefined,
          createdBy: undefined,
          dueAt: undefined,
          metadata: undefined,
        })
      );
    });
  });

  it('does not create audit log when userId is missing', async () => {
    const input: CreateTaskInput = {
      title: 'Task without audit',
    };

    mocks.taskRepository.create.mockResolvedValue(mockTask);
    mocks.createAuditLog.mockClear();

    await createTask(input);

    expect(mocks.createAuditLog).not.toHaveBeenCalled();
  });

  describe('error handling', () => {
    it('returns error when repository create fails and does not add history', async () => {
      mocks.taskRepository.create.mockRejectedValue(new Error('Database unavailable'));
      mocks.taskRepository.addStatusHistory.mockClear();

      const input: CreateTaskInput = {
        title: 'Task failing create',
      };

      const result = await createTask(input);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Database unavailable');
      }
      expect(mocks.taskRepository.addStatusHistory).not.toHaveBeenCalled();
    });
  });
}); 
