import { db, schema, type DatabaseExecutor } from '@cvg/database';
import { eq, and, desc, type SQL } from 'drizzle-orm';

export const TASK_STATUSES = schema.tasks.status.enumValues;
export const TASK_PRIORITIES = schema.tasks.priority.enumValues;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type Task = typeof schema.tasks.$inferSelect;
export type NewTask = typeof schema.tasks.$inferInsert;

export interface TaskListFilters {
  status?: TaskStatus;
  assignedTo?: string;
  priority?: TaskPriority;
  /** C04: consulta contextual autorizada por conversa. */
  conversationId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Transições válidas de status da tarefa (PROD-18/AC3): status transitável e
 * documentado; repetir o mesmo status é idempotente (não passa por aqui).
 */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = Object.freeze({
  pending: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['pending', 'completed', 'cancelled'],
  completed: ['in_progress', 'cancelled'],
  cancelled: ['pending'],
});

export function isValidTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  return TASK_TRANSITIONS[from]?.includes(to) ?? false;
}

const TASK_ORDER = [desc(schema.tasks.createdAt), desc(schema.tasks.id)] as const;

function bounded(filters?: TaskListFilters): { limit: number; offset: number } {
  const limit = Math.min(Math.max(filters?.limit ?? 100, 1), 200);
  const offset = Math.max(filters?.offset ?? 0, 0);
  return { limit, offset };
}

export const taskRepository = {
  async create(data: NewTask, executor: DatabaseExecutor = db) {
    const [task] = await executor.insert(schema.tasks).values(data).returning();
    return task;
  },

  async findById(id: string, executor: DatabaseExecutor = db) {
    const [task] = await executor.select().from(schema.tasks).where(eq(schema.tasks.id, id));
    return task || null;
  },

  async findByConversationId(conversationId: string) {
    return db.select().from(schema.tasks).where(eq(schema.tasks.conversationId, conversationId));
  },

  async findByAssignee(userId: string) {
    return db.select().from(schema.tasks).where(eq(schema.tasks.assignedTo, userId));
  },

  async findAll(filters?: TaskListFilters) {
    const conditions: SQL[] = [];
    if (filters?.status) {
      conditions.push(eq(schema.tasks.status, filters.status));
    }
    if (filters?.assignedTo) {
      conditions.push(eq(schema.tasks.assignedTo, filters.assignedTo));
    }
    if (filters?.priority) {
      conditions.push(eq(schema.tasks.priority, filters.priority));
    }
    if (filters?.conversationId) {
      conditions.push(eq(schema.tasks.conversationId, filters.conversationId));
    }

    const { limit, offset } = bounded(filters);
    let query = db.select().from(schema.tasks).$dynamic();
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    return query.orderBy(...TASK_ORDER).limit(limit).offset(offset);
  },

  async update(id: string, data: Partial<NewTask>) {
    const [task] = await db
      .update(schema.tasks)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.tasks.id, id))
      .returning();
    return task;
  },

  async updateStatus(id: string, status: string) {
    return taskRepository.updateStatusIfCurrent(id, null, status as TaskStatus);
  },

  /**
   * CAS transacional (PROD-18/AC3): só muda quando o status ainda é
   * `expectedStatus` (null = qualquer). Retorna null quando outro operador
   * venceu a corrida — o chamador responde 409.
   */
  async updateStatusIfCurrent(
    id: string,
    expectedStatus: TaskStatus | null,
    status: TaskStatus,
    executor: DatabaseExecutor = db,
  ) {
    const updateData: Partial<NewTask> = { status, updatedAt: new Date() };
    if (status === 'completed') {
      updateData.completedAt = new Date();
    } else {
      updateData.completedAt = null;
    }
    const condition = expectedStatus
      ? and(eq(schema.tasks.id, id), eq(schema.tasks.status, expectedStatus))
      : eq(schema.tasks.id, id);
    const [task] = await executor
      .update(schema.tasks)
      .set(updateData)
      .where(condition)
      .returning();
    return task || null;
  },

  async addStatusHistory(
    taskId: string,
    status: string,
    changedBy?: string,
    reason?: string,
    executor: DatabaseExecutor = db,
  ) {
    const [history] = await executor
      .insert(schema.taskStatusHistory)
      .values({ taskId, status: status as any, changedBy, reason })
      .returning();
    return history;
  },
};
