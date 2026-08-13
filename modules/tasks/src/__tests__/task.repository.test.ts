import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockTask = {
  id: 'task-1',
  conversationId: 'conv-1',
  tutorId: 'tutor-1',
  patientId: 'patient-1',
  title: 'Mock task',
  description: 'Mock description',
  priority: 'medium' as const,
  status: 'pending',
  assignedTo: 'user-1',
  createdBy: 'creator-1',
  dueAt: new Date(),
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null as Date | null,
};

const dbSelect = vi.fn();
const dbInsert = vi.fn();
const dbUpdate = vi.fn();

vi.mock('@cvg/database', () => ({
  db: {
    insert: (...args: unknown[]) => dbInsert(...args),
    select: (...args: unknown[]) => dbSelect(...args),
    update: (...args: unknown[]) => dbUpdate(...args),
  },
  schema: {
    tasks: {
      id: 'id',
      conversationId: 'conversationId',
      assignedTo: 'assignedTo',
      status: 'status',
      priority: 'priority',
      createdAt: 'createdAt',
    },
    taskStatusHistory: {},
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (...args: unknown[]) => args,
  desc: (...args: unknown[]) => args,
  and: (...args: unknown[]) => args,
}));

import { taskRepository } from '../infrastructure/repositories/task.repository';

describe('taskRepository', () => {
  beforeEach(() => {
    dbSelect.mockReset();
    dbInsert.mockReset();
    dbUpdate.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('create', () => {
    it('creates task and returns inserted row', async () => {
      const returning = vi.fn().mockResolvedValue([mockTask]);
      const values = vi.fn().mockReturnValue({ returning });
      dbInsert.mockReturnValue({ values });

      const task = await taskRepository.create(mockTask as never);

      expect(dbInsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'id', conversationId: 'conversationId' }));
      expect(values).toHaveBeenCalledWith(mockTask);
      expect(task).toEqual(mockTask);
      expect(returning).toHaveBeenCalledTimes(1);
    });
  });

  describe('findById', () => {
    it('returns task when found', async () => {
      const where = vi.fn().mockResolvedValue([mockTask]);
      dbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({ where }),
      });

      const task = await taskRepository.findById('task-1');

      expect(task).toEqual(mockTask);
    });

    it('returns null when not found', async () => {
      const where = vi.fn().mockResolvedValue([]);
      dbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({ where }),
      });

      const task = await taskRepository.findById('missing');

      expect(task).toBeNull();
    });
  });

  describe('findByConversationId and findByAssignee', () => {
    it('returns tasks linked to conversation', async () => {
      const where = vi.fn().mockResolvedValue([mockTask]);
      dbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({ where }),
      });

      const tasks = await taskRepository.findByConversationId('conv-1');

      expect(tasks).toEqual([mockTask]);
    });

    it('returns tasks linked to assignee', async () => {
      const where = vi.fn().mockResolvedValue([mockTask]);
      dbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({ where }),
      });

      const tasks = await taskRepository.findByAssignee('user-1');

      expect(tasks).toEqual([mockTask]);
    });
  });

  describe('findAll', () => {
    it('returns ordered list without filters', async () => {
      const dynamic = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([mockTask]),
      };
      dbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          $dynamic: vi.fn().mockReturnValue(dynamic),
        }),
      });

      const tasks = await taskRepository.findAll();

      expect(tasks).toEqual([mockTask]);
      expect(dynamic.orderBy).toHaveBeenCalledTimes(1);
    });

    it('applies filters to dynamic query', async () => {
      const dynamic = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([mockTask]),
      };
      dbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          $dynamic: vi.fn().mockReturnValue(dynamic),
        }),
      });

      const tasks = await taskRepository.findAll({
        status: 'pending',
        assignedTo: 'user-1',
        priority: 'high',
      });

      expect(tasks).toEqual([mockTask]);
      expect(dynamic.where).toHaveBeenCalledTimes(1);
      expect(dynamic.orderBy).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('updates task and returns new value', async () => {
      const returning = vi.fn().mockResolvedValue([mockTask]);
      dbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning,
          }),
        }),
      });

      const updated = await taskRepository.update('task-1', { title: 'Updated' });

      expect(updated).toEqual(mockTask);
      expect(returning).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateStatus', () => {
    it('updates task status and timestamps', async () => {
      const returning = vi.fn().mockResolvedValue([{ ...mockTask, status: 'completed' }]);
      dbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning,
          }),
        }),
      });

      const updated = await taskRepository.updateStatus('task-1', 'completed');

      expect(updated.status).toBe('completed');
      expect(returning).toHaveBeenCalledTimes(1);
    });
  });

  describe('addStatusHistory', () => {
    it('adds task status history entry', async () => {
      const history = { id: 'history-1', taskId: 'task-1', status: 'pending' };
      const returning = vi.fn().mockResolvedValue([history]);
      dbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({ returning }),
      });

      const created = await taskRepository.addStatusHistory('task-1', 'pending', 'user-1', 'created');

      expect(created).toEqual(history);
      expect(returning).toHaveBeenCalledTimes(1);
    });
  });
});
