import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { taskRepository } from '../infrastructure/repositories/task.repository';

let dbInitError = '';

async function probeRealDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1 FROM tasks LIMIT 1`);
    return true;
  } catch (error) {
    dbInitError = error instanceof Error ? error.message : String(error);
    return false;
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    '[tasks/filters] DATABASE_URL obrigatório: a suíte exige o PostgreSQL isolado do run (sem fallback para o default local).',
  );
}

const realDbAvailable = await probeRealDatabase();
if (!realDbAvailable) {
  throw new Error(
    `[tasks/filters] PostgreSQL isolado indisponível em DATABASE_URL; a suíte comportamental não pode ser pulada em silêncio: ${dbInitError}`,
  );
}

describe('taskRepository.findAll — filtros combinados (regressão AAA-16)', () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  let userA = '';
  let userB = '';
  const taskIds: string[] = [];
  let taskA_pending_low = '';
  let taskA_completed_low = '';
  let taskB_pending_low = '';
  let taskA_pending_high = '';

  beforeAll(async () => {
    const [a] = await db
      .insert(schema.users)
      .values({ name: `A16 Filter A ${suffix}`, email: `a16-filter-a-${suffix}@example.test`, passwordHash: 'x' })
      .returning();
    const [b] = await db
      .insert(schema.users)
      .values({ name: `A16 Filter B ${suffix}`, email: `a16-filter-b-${suffix}@example.test`, passwordHash: 'x' })
      .returning();
    userA = a.id;
    userB = b.id;

    const rows = await db
      .insert(schema.tasks)
      .values([
        { title: `A16 pending/low/A ${suffix}`, status: 'pending', priority: 'low', assignedTo: userA },
        { title: `A16 completed/low/A ${suffix}`, status: 'completed', priority: 'low', assignedTo: userA },
        { title: `A16 pending/low/B ${suffix}`, status: 'pending', priority: 'low', assignedTo: userB },
        { title: `A16 pending/high/A ${suffix}`, status: 'pending', priority: 'high', assignedTo: userA },
      ])
      .returning();

    taskA_pending_low = rows[0].id;
    taskA_completed_low = rows[1].id;
    taskB_pending_low = rows[2].id;
    taskA_pending_high = rows[3].id;
    taskIds.push(...rows.map((row) => row.id));
  });

  afterAll(async () => {
    if (taskIds.length > 0) {
      await db.delete(schema.tasks).where(inArray(schema.tasks.id, taskIds));
    }
    for (const userId of [userA, userB]) {
      if (userId) await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });

  it('status+assignedTo+priority retorna apenas a interseção (não sobrescreve where)', async () => {
    const found = await taskRepository.findAll({ status: 'pending', assignedTo: userA, priority: 'low' });
    expect(found.map((t) => t.id)).toEqual([taskA_pending_low]);

    // Se um filtro sobrescrevesse os demais, o resultado traria 3 tarefas:
    // somente priority=low -> T1,T2,T3; somente status -> T1,T3,T4;
    // somente assignedTo -> T1,T2,T4.
    expect(found).toHaveLength(1);
  });

  it('dois filtros combinados também coexistem', async () => {
    const statusAndAssignee = await taskRepository.findAll({ status: 'pending', assignedTo: userA });
    expect(new Set(statusAndAssignee.map((t) => t.id))).toEqual(new Set([taskA_pending_low, taskA_pending_high]));

    const statusAndPriority = await taskRepository.findAll({ status: 'pending', priority: 'low' });
    expect(new Set(statusAndPriority.map((t) => t.id))).toEqual(new Set([taskA_pending_low, taskB_pending_low]));

    const assigneeAndPriority = await taskRepository.findAll({ assignedTo: userA, priority: 'low' });
    expect(new Set(assigneeAndPriority.map((t) => t.id))).toEqual(new Set([taskA_pending_low, taskA_completed_low]));
  });

  it('filtro único continua retornando todos os correspondentes', async () => {
    const byStatus = await taskRepository.findAll({ status: 'pending' });
    expect(new Set(byStatus.map((t) => t.id))).toEqual(
      new Set([taskA_pending_low, taskB_pending_low, taskA_pending_high]),
    );

    const all = await taskRepository.findAll();
    expect(all.map((t) => t.id)).toEqual(expect.arrayContaining(taskIds));
  });
});
