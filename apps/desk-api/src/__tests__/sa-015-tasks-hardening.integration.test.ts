/**
 * SA-015 — endurecer tarefas vinculadas e concorrência de estados (B08, C01/C04, G03).
 *
 * Executado com PostgreSQL + Redis REAIS do runner isolado de SA-003:
 *   node scripts/production/run-integration-isolated.mjs --run-id <id> --worker <44-49> \
 *     --skip-seed -- pnpm --filter @cvg/desk-api exec vitest run \
 *     src/__tests__/sa-015-tasks-hardening.integration.test.ts
 *
 * Fecha as lacunas que as suítes existentes NÃO cobrem (as demais são citadas
 * no relatório, sem duplicar volume):
 *
 *  - AC1: POST /tasks com conversationId inexistente (404) ou de outro setor
 *    (404) NÃO cria tarefa nem efeitos órfãos (task/history/audit/outbox = 0);
 *    criação autorizada grava as QUATRO escritas na mesma transação e o
 *    vínculo tutor/paciente válido persiste; leitura cross-ator nega 404.
 *  - AC2: CAS por estado esperado com transação concorrente REAL segurando a
 *    linha: o operador que leu o estado antigo recebe 409 sem efeito parcial
 *    (histórico/audit/outbox intactos); recuperação relendo o estado e
 *    repetição idempotente não duplicam efeitos.
 *  - AC3: paginação canônica no repositório (default 100, teto 200, piso 1,
 *    offset >= 0) e 400 no HTTP fora da faixa; filtro conversationId devolve
 *    SÓ a conversa autorizada (outra conversa do MESMO setor não vaza) e 404
 *    para conversa inacessível.
 *
 * Defeitos abertos no candidato (documentados com `it.fails`, viram XPASS
 * quando o patch do lead entrar):
 *  - D1: tutorId inexistente responde 500 INTERNAL_ERROR (C01 pede 4xx).
 *  - D2: patientId inexistente responde 500 INTERNAL_ERROR (C01 pede 4xx).
 *  - D3: assignedTo fora do setor da conversa é ACEITO (AC1 "só entre permitidos").
 *  - D4: dueAt inválido responde 500 INTERNAL_ERROR (C01 pede 4xx).
 *
 * Guard-aware (padrão SA-013/SA-014): o marcador estrito `cvg_aaa_*` só é
 * exigido quando AAA_RUN_ID está presente (runner isolado); no ambiente
 * CI-shaped do `pnpm test:ci` a suíte usa o banco migrado do job.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db, getPool, schema } from '@cvg/database';
import { taskRepository } from '@cvg/tasks';
import { buildDeskApiApp } from '../app.ts';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || '10000';

const password = 'ChatRoutePass!42';
const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
const RUN_TAG = (process.env.AAA_RUN_ID || 'sa015').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 16) || 'sa015';
const suffix = `${RUN_TAG}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TITLE_PREFIX = `SA015 ${suffix}`;

interface Actor {
  id: string;
  email: string;
  token: string;
}

let app: FastifyInstance;
let actorA: Actor;
let actorB: Actor;
let actorC: Actor;
let sectorA = '';
let sectorB = '';
let sectorC = '';
let conversationA = '';
let conversationB = '';
let tutorId = '';
let patientId = '';

const userIds: string[] = [];
const roleIds: string[] = [];
const sectorIds: string[] = [];
const conversationIds: string[] = [];
const taskIds: string[] = [];
const tutorIds: string[] = [];
const patientIds: string[] = [];

interface ProbeObservation {
  probe: string;
  httpStatus: number;
}

/** Observações dos probes de vínculo/responsável/prazo (defeitos D1–D4). */
const probeObservations: ProbeObservation[] = [];

function recordProbe(probe: string, httpStatus: number): void {
  probeObservations.push({ probe, httpStatus });
  console.log(`[SA-015][probe] ${probe} -> HTTP ${httpStatus}`);
}

function title(label: string): string {
  return `${TITLE_PREFIX} ${label}`;
}

function correlationId(label: string): string {
  return `sa015-${label}-${suffix}-${randomUUID().slice(0, 8)}`;
}

function auth(actor: Actor): Record<string, string> {
  return { authorization: `Bearer ${actor.token}` };
}

function withCorrelation(actor: Actor, corr: string): Record<string, string> {
  return { ...auth(actor), 'x-correlation-id': corr };
}

function queryRows<T>(query: SQL): Promise<T[]> {
  return db.execute(query).then((result) => {
    const rows = (result as unknown as { rows?: T[] }).rows;
    return (rows ?? []) as T[];
  });
}

async function countTasksByTitle(taskTitle: string): Promise<number> {
  const rows = await queryRows<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM tasks WHERE title = ${taskTitle}`);
  return rows[0]?.n ?? 0;
}

async function effectsByCorrelation(corr: string): Promise<{ audit: number; outbox: number }> {
  const rows = await queryRows<{ audit: number; outbox: number }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM audit_logs WHERE correlation_id = ${corr}) AS audit,
      (SELECT COUNT(*)::int FROM outbox_events WHERE correlation_id = ${corr}) AS outbox
  `);
  return rows[0] ?? { audit: 0, outbox: 0 };
}

async function creationEffectCounts(taskId: string, corr: string): Promise<{ audits: number; outbox: number }> {
  const rows = await queryRows<{ audits: number; outbox: number }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM audit_logs
        WHERE action = 'task.created' AND entity_id = ${taskId} AND correlation_id = ${corr}) AS audits,
      (SELECT COUNT(*)::int FROM outbox_events
        WHERE event_type = 'task.created' AND aggregate_id = ${taskId}::text AND correlation_id = ${corr}) AS outbox
  `);
  return rows[0] ?? { audits: 0, outbox: 0 };
}

/**
 * Efeitos duráveis da tarefa: histórico (todas as linhas), auditoria e outbox
 * de mudança de status. `corr` opcional restringe audit/outbox à correlação —
 * usado para provar que um perdedor de CAS não deixou efeito parcial.
 */
async function taskEffectCounts(
  taskId: string,
  corr?: string,
): Promise<{ history: number; transitionAudits: number; transitionOutbox: number }> {
  const rows = await queryRows<{ history: number; transition_audits: number; transition_outbox: number }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM task_status_history WHERE task_id = ${taskId}) AS history,
      (SELECT COUNT(*)::int FROM audit_logs
        WHERE action = 'task.status.changed' AND entity_id = ${taskId}
          AND (${corr ?? null}::text IS NULL OR correlation_id = ${corr ?? null})) AS transition_audits,
      (SELECT COUNT(*)::int FROM outbox_events
        WHERE event_type = 'task.status.changed' AND aggregate_id = ${taskId}::text
          AND (${corr ?? null}::text IS NULL OR correlation_id = ${corr ?? null})) AS transition_outbox
  `);
  const row = rows[0];
  return {
    history: row?.history ?? 0,
    transitionAudits: row?.transition_audits ?? 0,
    transitionOutbox: row?.transition_outbox ?? 0,
  };
}

async function ensureRole(name: string): Promise<string> {
  const [existing] = await db.select().from(schema.roles).where(eq(schema.roles.name, name)).limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(schema.roles).values({ name }).returning();
  roleIds.push(created.id);
  return created.id;
}

async function ensurePermission(name: string): Promise<string> {
  const [existing] = await db.select().from(schema.permissions).where(eq(schema.permissions.name, name)).limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(schema.permissions).values({ name }).returning();
  return created.id;
}

async function grantRolePermissions(roleId: string, names: string[]): Promise<void> {
  for (const name of names) {
    const permissionId = await ensurePermission(name);
    await db
      .insert(schema.rolePermissions)
      .values({ roleId, permissionId })
      .onConflictDoNothing();
  }
}

async function createActor(label: string, roleId: string, sectorId: string): Promise<Actor> {
  const id = randomUUID();
  const email = `sa015.${suffix}.${label}@example.test`;
  await db.insert(schema.users).values({ id, name: `SA015 ${label}`, email, passwordHash, isActive: true });
  userIds.push(id);
  await db.insert(schema.userRoles).values({ userId: id, roleId });
  await db.insert(schema.userSectors).values({ userId: id, sectorId, accessLevel: 'write' });
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  if (login.statusCode !== 200) {
    throw new Error(`login falhou para ${label}: ${login.statusCode} ${login.body}`);
  }
  return { id, email, token: (login.json() as { token: string }).token };
}

async function createConversation(label: string, sectorId: string): Promise<string> {
  const [conversation] = await db
    .insert(schema.conversations)
    .values({
      status: 'open',
      statusV2: 'novo',
      currentHandler: 'bot',
      isActive: true,
      sectorId,
    })
    .returning();
  conversationIds.push(conversation.id);
  return conversation.id;
}

async function createTaskViaHttp(
  actor: Actor,
  payload: Record<string, unknown>,
  corr?: string,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const response = await app.inject({
    method: 'POST',
    url: '/tasks',
    headers: corr ? withCorrelation(actor, corr) : auth(actor),
    payload,
  });
  const body = response.json() as Record<string, unknown>;
  if (typeof body.id === 'string') {
    taskIds.push(body.id);
  }
  return { statusCode: response.statusCode, body };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
  const url = process.env.DATABASE_URL ?? '';
  if (!url) {
    throw new Error('SA-015 exige DATABASE_URL (use o runner isolado de SA-003 ou o banco de CI migrado).');
  }
  // Guard-aware (padrão SA-013/SA-014): marcador estrito apenas no runner.
  if (process.env.AAA_RUN_ID) {
    if (!/^postgres(ql)?:\/\/[^/]*127\.0\.0\.1:\d+\/cvg_aaa_/.test(url)) {
      throw new Error(
        `SA-015 exige DATABASE_URL isolado do runner (cvg_aaa_* em 127.0.0.1); recebido: ${url}`,
      );
    }
    const marker = await db.execute(sql`SELECT run_id FROM aaa_environment_marker`);
    const rows = (marker as unknown as { rows: Array<{ run_id: string }> }).rows ?? [];
    if (rows.length !== 1 || rows[0].run_id !== process.env.AAA_RUN_ID) {
      throw new Error(`SA-015 exige o marcador do run ${process.env.AAA_RUN_ID}: ${JSON.stringify(rows)}`);
    }
  }

  app = await buildDeskApiApp();
  await app.ready();

  const [a] = await db
    .insert(schema.sectors)
    .values({ name: `SA015 A ${suffix}`, code: `sa015a-${suffix}`.slice(0, 50), isActive: true })
    .returning();
  const [b] = await db
    .insert(schema.sectors)
    .values({ name: `SA015 B ${suffix}`, code: `sa015b-${suffix}`.slice(0, 50), isActive: true })
    .returning();
  const [c] = await db
    .insert(schema.sectors)
    .values({ name: `SA015 C ${suffix}`, code: `sa015c-${suffix}`.slice(0, 50), isActive: true })
    .returning();
  sectorA = a.id;
  sectorB = b.id;
  sectorC = c.id;
  sectorIds.push(sectorA, sectorB, sectorC);

  const roleId = await ensureRole(`SA015 Operador ${suffix}`.slice(0, 60));
  await grantRolePermissions(roleId, ['tasks:read', 'tasks:write']);

  actorA = await createActor('ator-a', roleId, sectorA);
  actorB = await createActor('ator-b', roleId, sectorB);
  actorC = await createActor('ator-c', roleId, sectorC);

  conversationA = await createConversation('principal', sectorA);
  conversationB = await createConversation('outro-setor', sectorB);

  const [tutor] = await db
    .insert(schema.tutors)
    .values({ name: `SA015 Tutor ${suffix}`.slice(0, 80), phone: `+55119${String(Date.now()).slice(-8)}` })
    .returning();
  tutorId = tutor.id;
  tutorIds.push(tutorId);
  const [patient] = await db
    .insert(schema.patients)
    .values({ name: `SA015 Paciente ${suffix}`.slice(0, 80), species: 'canino', tutorId })
    .returning();
  patientId = patient.id;
  patientIds.push(patientId);
});

afterAll(async () => {
  try {
    const tasksFromActors = userIds.length
      ? (
          await db
            .select({ id: schema.tasks.id })
            .from(schema.tasks)
            .where(inArray(schema.tasks.createdBy, userIds))
        ).map((row) => row.id)
      : [];
    const allTaskIds = Array.from(new Set([...tasksFromActors, ...taskIds]));
    if (allTaskIds.length > 0) {
      await db.delete(schema.taskStatusHistory).where(inArray(schema.taskStatusHistory.taskId, allTaskIds));
      await db.delete(schema.tasks).where(inArray(schema.tasks.id, allTaskIds));
      await db.delete(schema.outboxEvents).where(inArray(schema.outboxEvents.aggregateId, allTaskIds));
    }
    if (userIds.length > 0) {
      await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.userId, userIds));
      await db.delete(schema.sessions).where(inArray(schema.sessions.userId, userIds));
      await db.delete(schema.userSectors).where(inArray(schema.userSectors.userId, userIds));
      await db.delete(schema.userRoles).where(inArray(schema.userRoles.userId, userIds));
    }
    if (roleIds.length > 0) {
      await db.delete(schema.rolePermissions).where(inArray(schema.rolePermissions.roleId, roleIds));
    }
    if (conversationIds.length > 0) {
      await db.delete(schema.conversations).where(inArray(schema.conversations.id, conversationIds));
    }
    if (patientIds.length > 0) {
      await db.delete(schema.patients).where(inArray(schema.patients.id, patientIds));
    }
    if (tutorIds.length > 0) {
      await db.delete(schema.tutors).where(inArray(schema.tutors.id, tutorIds));
    }
    if (userIds.length > 0) {
      await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    }
    if (roleIds.length > 0) {
      await db.delete(schema.roles).where(inArray(schema.roles.id, roleIds));
    }
    if (sectorIds.length > 0) {
      await db.delete(schema.sectors).where(inArray(schema.sectors.id, sectorIds));
    }
  } catch (error) {
    console.error('[SA-015] cleanup falhou:', error);
  }
  // Evidência machine-readable dos probes de defeito — somente no runner
  // isolado (AAA_RUN_ID presente), para não sujar a árvore no `test:ci`.
  if (process.env.AAA_RUN_ID && process.env.CVG_PROGRAM_DIR) {
    try {
      const evidenceDir = join(process.env.CVG_PROGRAM_DIR, 'evidencias', 'SA-015');
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(
        join(evidenceDir, 'probe-observations.json'),
        `${JSON.stringify(
          {
            runId: process.env.AAA_RUN_ID,
            workerIndex: process.env.AAA_WORKER_INDEX ?? null,
            generatedAt: new Date().toISOString(),
            defects: [
              'D1 tutorId inexistente: AC1 exige 4xx; observado no probe',
              'D2 patientId inexistente: AC1 exige 4xx; observado no probe',
              'D3 assignedTo fora do setor da conversa: AC1 exige rejeição; observado no probe',
              'D4 dueAt inválido: C01 exige 4xx; observado no probe',
            ],
            observations: probeObservations,
          },
          null,
          2,
        )}\n`,
      );
    } catch (error) {
      console.error('[SA-015] falha ao gravar probe-observations.json:', error);
    }
  }
  try {
    const events = await import('@cvg/events');
    await events.stopSharedRealtimeBus();
  } catch {
    // Barramento best-effort; o teardown do runner cobre o restante.
  }
  await app?.close().catch(() => undefined);
  await getPool().end().catch(() => undefined);
});

describe('SA-015 — tarefas vinculadas e concorrência de estados (PG/Redis reais)', () => {
  describe('AC1 — vínculo validado no servidor e criação atômica', () => {
    it('conversa inexistente/inacessível responde 404 sem linha órfã; conversa autorizada grava task+histórico+audit+outbox', async () => {
      // (1) conversa Inexistente: 404 antes de qualquer escrita.
      const missingCorr = correlationId('ac1-conv-missing');
      const missing = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers: withCorrelation(actorA, missingCorr),
        payload: { conversationId: randomUUID(), title: title('conversa-inexistente') },
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toMatchObject({ error: 'NOT_FOUND' });
      expect(await countTasksByTitle(title('conversa-inexistente'))).toBe(0);
      expect(await effectsByCorrelation(missingCorr)).toEqual({ audit: 0, outbox: 0 });

      // (2) conversa de OUTRO setor: 404 sem revelar existência nem criar nada.
      const deniedCorr = correlationId('ac1-conv-denied');
      const denied = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers: withCorrelation(actorA, deniedCorr),
        payload: { conversationId: conversationB, title: title('conversa-inacessivel') },
      });
      expect(denied.statusCode).toBe(404);
      expect(denied.json()).toMatchObject({ error: 'NOT_FOUND' });
      expect(await countTasksByTitle(title('conversa-inacessivel'))).toBe(0);
      expect(await effectsByCorrelation(deniedCorr)).toEqual({ audit: 0, outbox: 0 });

      // (3) Autorizado: as quatro escritas entram na MESMA transação.
      const dueAt = '2026-12-01T15:30:00.000Z';
      const okCorr = correlationId('ac1-conv-ok');
      const created = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers: withCorrelation(actorA, okCorr),
        payload: {
          conversationId: conversationA,
          title: title('conversa-autorizada'),
          priority: 'urgent',
          dueAt,
          assignedTo: actorA.id,
        },
      });
      expect(created.statusCode).toBe(201);
      const createdBody = created.json() as { id: string; status: string; createdBy: string };
      taskIds.push(createdBody.id);

      const stored = await taskRepository.findById(createdBody.id);
      expect(stored?.conversationId).toBe(conversationA);
      expect(stored?.createdBy).toBe(actorA.id);
      expect(stored?.status).toBe('pending');
      expect(stored?.priority).toBe('urgent');
      expect(stored?.dueAt?.getTime()).toBe(Date.parse(dueAt));

      expect(await taskEffectCounts(createdBody.id, okCorr)).toEqual({
        history: 1,
        transitionAudits: 0,
        transitionOutbox: 0,
      });
      expect(await creationEffectCounts(createdBody.id, okCorr)).toEqual({ audits: 1, outbox: 1 });
      const history = await db
        .select()
        .from(schema.taskStatusHistory)
        .where(eq(schema.taskStatusHistory.taskId, createdBody.id));
      expect(history).toHaveLength(1);
      expect(history[0]?.status).toBe('pending');
      expect(history[0]?.changedBy).toBe(actorA.id);

      // (4) Leitura do vínculo: ator autorizado 200; outro setor 404.
      const ownRead = await app.inject({ method: 'GET', url: `/tasks/${createdBody.id}`, headers: auth(actorA) });
      expect(ownRead.statusCode).toBe(200);
      expect(new Date((ownRead.json() as { dueAt: string }).dueAt).getTime()).toBe(Date.parse(dueAt));

      const crossRead = await app.inject({ method: 'GET', url: `/tasks/${createdBody.id}`, headers: auth(actorB) });
      expect(crossRead.statusCode).toBe(404);

      // (5) Filtro canônico por prioridade dentro do contexto autorizado.
      const byPriority = await app.inject({
        method: 'GET',
        url: `/tasks?conversationId=${conversationA}&priority=urgent`,
        headers: auth(actorA),
      });
      expect(byPriority.statusCode).toBe(200);
      expect((byPriority.json() as Array<{ id: string }>).map((task) => task.id)).toContain(createdBody.id);

      const otherPriority = await app.inject({
        method: 'GET',
        url: `/tasks?conversationId=${conversationA}&priority=low`,
        headers: auth(actorA),
      });
      expect(otherPriority.statusCode).toBe(200);
      expect((otherPriority.json() as Array<{ id: string }>).map((task) => task.id)).not.toContain(createdBody.id);
    });

    it('tutor/paciente válidos persistem; vínculo inexistente não é aceito nem deixa órfãos', async () => {
      const okCorr = correlationId('ac1-links-ok');
      const created = await createTaskViaHttp(
        actorA,
        {
          tutorId,
          patientId,
          title: title('tutor-paciente-validos'),
          priority: 'medium',
        },
        okCorr,
      );
      expect(created.statusCode).toBe(201);
      const taskId = created.body.id as string;

      const stored = await taskRepository.findById(taskId);
      expect(stored?.tutorId).toBe(tutorId);
      expect(stored?.patientId).toBe(patientId);
      expect(await taskEffectCounts(taskId, okCorr)).toEqual({ history: 1, transitionAudits: 0, transitionOutbox: 0 });
      expect(await creationEffectCounts(taskId, okCorr)).toEqual({ audits: 1, outbox: 1 });

      // Criador sem conversa lê o próprio vínculo; outro ator não enxerga.
      const ownRead = await app.inject({ method: 'GET', url: `/tasks/${taskId}`, headers: auth(actorA) });
      expect(ownRead.statusCode).toBe(200);
      const crossRead = await app.inject({ method: 'GET', url: `/tasks/${taskId}`, headers: auth(actorB) });
      expect(crossRead.statusCode).toBe(404);

      // Vínculos inexistentes: rejeitados e sem efeito durável (nem órfão).
      const invalidCases: Array<{ label: string; payload: Record<string, unknown> }> = [
        { label: 'tutor-inexistente', payload: { tutorId: randomUUID(), title: title('tutor-inexistente') } },
        { label: 'paciente-inexistente', payload: { patientId: randomUUID(), title: title('paciente-inexistente') } },
        { label: 'responsavel-inexistente', payload: { assignedTo: randomUUID(), title: title('responsavel-inexistente') } },
      ];
      for (const probe of invalidCases) {
        const corr = correlationId(`ac1-${probe.label}`);
        const response = await app.inject({
          method: 'POST',
          url: '/tasks',
          headers: withCorrelation(actorA, corr),
          payload: probe.payload,
        });
        recordProbe(probe.label, response.statusCode);
        expect(response.statusCode).not.toBe(201);
        expect(await countTasksByTitle(probe.payload.title as string)).toBe(0);
        expect(await effectsByCorrelation(corr)).toEqual({ audit: 0, outbox: 0 });
      }
    });

    it('CORRIGIDO SA-015-D1 — tutorId inexistente é 404 sem linha órfã', async () => {
      const corr = correlationId('d1-tutor-4xx');
      const taskTitle = title('d1-tutor-4xx');
      const response = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers: withCorrelation(actorA, corr),
        payload: { tutorId: randomUUID(), title: taskTitle },
      });
      recordProbe('d1-tutor-inexistente-espera-4xx', response.statusCode);
      expect(response.statusCode).toBe(404);
      expect(await countTasksByTitle(taskTitle)).toBe(0);
      expect(await effectsByCorrelation(corr)).toEqual({ audit: 0, outbox: 0 });
    });

    it('CORRIGIDO SA-015-D2 — patientId inexistente é 404 sem linha órfã', async () => {
      const corr = correlationId('d2-paciente-4xx');
      const taskTitle = title('d2-paciente-4xx');
      const response = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers: withCorrelation(actorA, corr),
        payload: { patientId: randomUUID(), title: taskTitle },
      });
      recordProbe('d2-paciente-inexistente-espera-4xx', response.statusCode);
      expect(response.statusCode).toBe(404);
      expect(await countTasksByTitle(taskTitle)).toBe(0);
      expect(await effectsByCorrelation(corr)).toEqual({ audit: 0, outbox: 0 });
    });

    it('CORRIGIDO SA-015-D3 — assignedTo fora do setor é 400 INVALID_ASSIGNEE sem linha órfã', async () => {
      const corr = correlationId('d3-fora-do-setor');
      const taskTitle = title('d3-fora-do-setor');
      const response = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers: withCorrelation(actorA, corr),
        payload: { conversationId: conversationA, assignedTo: actorC.id, title: taskTitle },
      });
      recordProbe('d3-assignee-fora-do-setor-espera-400-403', response.statusCode);
      expect(response.statusCode).toBe(400);
      expect((response.json() as { error?: string }).error).toBe('INVALID_ASSIGNEE');
      expect(await countTasksByTitle(taskTitle)).toBe(0);
      expect(await effectsByCorrelation(corr)).toEqual({ audit: 0, outbox: 0 });
    });

    it('CORRIGIDO SA-015-D5 — assignedTo inativo é 400 INVALID_ASSIGNEE sem linha órfã', async () => {
      const inactiveId = randomUUID();
      await db.insert(schema.users).values({
        id: inactiveId,
        name: `SA015 inativo ${suffix}`,
        email: `sa015.inativo.${suffix}@example.com`,
        passwordHash,
        isActive: false,
      });
      userIds.push(inactiveId);
      const corr = correlationId('d5-assignee-inativo');
      const taskTitle = title('d5-assignee-inativo');
      const response = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers: withCorrelation(actorA, corr),
        payload: { assignedTo: inactiveId, title: taskTitle },
      });
      expect(response.statusCode).toBe(400);
      expect((response.json() as { error?: string }).error).toBe('INVALID_ASSIGNEE');
      expect(await countTasksByTitle(taskTitle)).toBe(0);
      expect(await effectsByCorrelation(corr)).toEqual({ audit: 0, outbox: 0 });
    });
  });

  describe('AC2 — CAS por estado esperado, 409 previsível e repetição idempotente', () => {
    it('concorrência real: CAS perdedor recebe 409 e não deixa efeito parcial (linha travada por outra transação)', async () => {
      const conversation = await createConversation('ac2-cas', sectorA);
      const created = await createTaskViaHttp(actorA, {
        conversationId: conversation,
        title: title('ac2-cas'),
      });
      expect(created.statusCode).toBe(201);
      const taskId = created.body.id as string;

      let releaseWinner!: () => void;
      const winnerRelease = new Promise<void>((resolve) => {
        releaseWinner = resolve;
      });
      let markLocked!: () => void;
      const locked = new Promise<void>((resolve) => {
        markLocked = resolve;
      });

      // Vencedor: transação REAL que segura o lock da linha até o teste liberar.
      const winner = db.transaction(async (tx) => {
        await tx.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).for('update');
        await tx
          .update(schema.tasks)
          .set({ status: 'in_progress', updatedAt: new Date() })
          .where(eq(schema.tasks.id, taskId));
        markLocked();
        await winnerRelease;
      });

      await locked;
      const loserCorr = correlationId('ac2-cas-loser');
      const loserRequest = app.inject({
        method: 'PATCH',
        url: `/tasks/${taskId}/status`,
        headers: withCorrelation(actorA, loserCorr),
        payload: { status: 'completed', expectedStatus: 'pending' },
      });
      // Dá tempo do PATCH ler o estado antigo e bloquear no CAS.
      await sleep(300);
      releaseWinner();
      await winner;

      const response = await loserRequest;
      expect(response.statusCode).toBe(409);
      expect((response.json() as { error: string }).error).toBe('TASK_STATUS_CONFLICT');

      const finalTask = await taskRepository.findById(taskId);
      expect(finalTask?.status).toBe('in_progress');
      expect(await taskEffectCounts(taskId, loserCorr)).toEqual({
        history: 1,
        transitionAudits: 0,
        transitionOutbox: 0,
      });
    });

    it('corrida com o MESMO estado esperado produz UM único efeito de transição e não regride', async () => {
      const conversation = await createConversation('ac2-race', sectorA);
      const created = await createTaskViaHttp(actorA, {
        conversationId: conversation,
        title: title('ac2-race'),
      });
      expect(created.statusCode).toBe(201);
      const taskId = created.body.id as string;

      const [first, second] = await Promise.all([
        app.inject({
          method: 'PATCH',
          url: `/tasks/${taskId}/status`,
          headers: withCorrelation(actorA, correlationId('ac2-race-1')),
          payload: { status: 'in_progress', expectedStatus: 'pending' },
        }),
        app.inject({
          method: 'PATCH',
          url: `/tasks/${taskId}/status`,
          headers: withCorrelation(actorA, correlationId('ac2-race-2')),
          payload: { status: 'in_progress', expectedStatus: 'pending' },
        }),
      ]);

      const responses = [first, second];
      expect(responses.map((response) => response.statusCode).filter((code) => code === 200).length).toBeGreaterThanOrEqual(1);
      expect(responses.every((response) => [200, 409].includes(response.statusCode))).toBe(true);

      const accepted = responses.filter((response) => response.statusCode === 200);
      const deduplicatedFlags = accepted.map(
        (response) => (response.json() as { deduplicated: boolean }).deduplicated,
      );
      // Exatamente UMA resposta efetiva; a outra é dedup (200) ou conflito (409).
      expect(deduplicatedFlags.filter((deduplicated) => !deduplicated)).toHaveLength(1);

      const finalTask = await taskRepository.findById(taskId);
      expect(finalTask?.status).toBe('in_progress');
      expect(finalTask?.completedAt).toBeNull();
      expect(await taskEffectCounts(taskId)).toEqual({
        history: 2,
        transitionAudits: 1,
        transitionOutbox: 1,
      });
    });

    it('409 stale preserva estado/efeitos; recuperação relendo o estado e repetição idempotente', async () => {
      const conversation = await createConversation('ac2-recover', sectorA);
      const created = await createTaskViaHttp(actorA, {
        conversationId: conversation,
        title: title('ac2-recover'),
      });
      expect(created.statusCode).toBe(201);
      const taskId = created.body.id as string;

      const moved = await app.inject({
        method: 'PATCH',
        url: `/tasks/${taskId}/status`,
        headers: auth(actorA),
        payload: { status: 'in_progress', expectedStatus: 'pending' },
      });
      expect(moved.statusCode).toBe(200);
      expect((moved.json() as { deduplicated: boolean; previousStatus: string }).deduplicated).toBe(false);
      expect((moved.json() as { previousStatus: string }).previousStatus).toBe('pending');

      // Perdedor com estado esperado defasado: 409 sem escrever nada.
      const stale = await app.inject({
        method: 'PATCH',
        url: `/tasks/${taskId}/status`,
        headers: auth(actorA),
        payload: { status: 'cancelled', expectedStatus: 'pending' },
      });
      expect(stale.statusCode).toBe(409);
      expect((stale.json() as { error: string }).error).toBe('TASK_STATUS_CONFLICT');
      expect(await taskEffectCounts(taskId)).toEqual({
        history: 2,
        transitionAudits: 1,
        transitionOutbox: 1,
      });

      // Recuperação: relê o estado e repete com o expected correto.
      const reread = await app.inject({ method: 'GET', url: `/tasks/${taskId}`, headers: auth(actorA) });
      expect(reread.statusCode).toBe(200);
      expect((reread.json() as { status: string }).status).toBe('in_progress');

      const retry = await app.inject({
        method: 'PATCH',
        url: `/tasks/${taskId}/status`,
        headers: auth(actorA),
        payload: { status: 'cancelled', expectedStatus: 'in_progress', reason: 'retry após 409' },
      });
      expect(retry.statusCode).toBe(200);
      expect((retry.json() as { previousStatus: string; deduplicated: boolean }).previousStatus).toBe('in_progress');
      expect((retry.json() as { deduplicated: boolean }).deduplicated).toBe(false);
      expect(await taskEffectCounts(taskId)).toEqual({
        history: 3,
        transitionAudits: 2,
        transitionOutbox: 2,
      });

      // Repetição idempotente: mesmo status não duplica histórico/audit/outbox.
      const repeat = await app.inject({
        method: 'PATCH',
        url: `/tasks/${taskId}/status`,
        headers: auth(actorA),
        payload: { status: 'cancelled' },
      });
      expect(repeat.statusCode).toBe(200);
      expect((repeat.json() as { deduplicated: boolean }).deduplicated).toBe(true);
      expect(await taskEffectCounts(taskId)).toEqual({
        history: 3,
        transitionAudits: 2,
        transitionOutbox: 2,
      });

      // Retry com expected defasado de novo: 409 e estado permanece o último.
      const staleAgain = await app.inject({
        method: 'PATCH',
        url: `/tasks/${taskId}/status`,
        headers: auth(actorA),
        payload: { status: 'pending', expectedStatus: 'in_progress' },
      });
      expect(staleAgain.statusCode).toBe(409);
      expect((staleAgain.json() as { error: string }).error).toBe('TASK_STATUS_CONFLICT');
      expect((await taskRepository.findById(taskId))?.status).toBe('cancelled');
      expect(await taskEffectCounts(taskId)).toEqual({
        history: 3,
        transitionAudits: 2,
        transitionOutbox: 2,
      });
    });
  });

  describe('AC3 — paginação canônica e filtro contextual autorizado', () => {
    it('filtro conversationId devolve só a conversa pedida (mesmo setor não vaza) e 404 para inacessível', async () => {
      const conversationSameSector = await createConversation('ac3-mesmo-setor', sectorA);
      const otherSectorConversation = await createConversation('ac3-outro-setor', sectorB);

      const [taskSameSector] = await db
        .insert(schema.tasks)
        .values({
          conversationId: conversationSameSector,
          title: title('ac3-same-sector'),
          status: 'pending',
          priority: 'medium',
          createdBy: actorA.id,
        })
        .returning();
      const [taskOtherSector] = await db
        .insert(schema.tasks)
        .values({
          conversationId: otherSectorConversation,
          title: title('ac3-other-sector'),
          status: 'pending',
          priority: 'medium',
          createdBy: actorA.id,
        })
        .returning();
      const [taskUnlinked] = await db
        .insert(schema.tasks)
        .values({
          title: title('ac3-sem-vinculo'),
          status: 'pending',
          priority: 'medium',
          createdBy: actorA.id,
        })
        .returning();
      taskIds.push(taskSameSector.id, taskOtherSector.id, taskUnlinked.id);

      const contextual = await app.inject({
        method: 'GET',
        url: `/tasks?conversationId=${conversationSameSector}&limit=200`,
        headers: auth(actorA),
      });
      expect(contextual.statusCode).toBe(200);
      const contextualIds = (contextual.json() as Array<{ id: string }>).map((task) => task.id);
      expect(contextualIds).toContain(taskSameSector.id);
      expect(contextualIds).not.toContain(taskOtherSector.id);
      expect(contextualIds).not.toContain(taskUnlinked.id);
      expect(JSON.stringify(contextual.json())).not.toContain(title('ac3-other-sector'));

      const inaccessible = await app.inject({
        method: 'GET',
        url: `/tasks?conversationId=${otherSectorConversation}`,
        headers: auth(actorA),
      });
      expect(inaccessible.statusCode).toBe(404);
      expect(JSON.stringify(inaccessible.json())).not.toContain(title('ac3-other-sector'));

      const nonexistent = await app.inject({
        method: 'GET',
        url: `/tasks?conversationId=${randomUUID()}`,
        headers: auth(actorA),
      });
      expect(nonexistent.statusCode).toBe(404);

      const unfiltered = await app.inject({ method: 'GET', url: '/tasks?limit=200', headers: auth(actorA) });
      expect(unfiltered.statusCode).toBe(200);
      const unfilteredIds = (unfiltered.json() as Array<{ id: string }>).map((task) => task.id);
      expect(unfilteredIds).toContain(taskSameSector.id);
      expect(unfilteredIds).toContain(taskUnlinked.id);
      expect(unfilteredIds).not.toContain(taskOtherSector.id);
    });

    it('paginação é limitada: default 100, teto 200, piso 1, offset >= 0 e HTTP 400 fora da faixa', async () => {
      const conversation = await createConversation('ac3-paginacao', sectorA);
      const bulk: Array<typeof schema.tasks.$inferInsert> = Array.from({ length: 205 }, (_, index) => ({
        conversationId: conversation,
        title: title(`page-${String(index).padStart(3, '0')}`),
        status: 'pending',
        priority: 'low',
        createdBy: actorA.id,
      }));
      await db.insert(schema.tasks).values(bulk);

      // Repositório: limites canônicos (bounded()).
      const defaultPage = await taskRepository.findAll({ conversationId: conversation });
      expect(defaultPage).toHaveLength(100);
      const capped = await taskRepository.findAll({ conversationId: conversation, limit: 500 });
      expect(capped).toHaveLength(200);
      const minClamped = await taskRepository.findAll({ conversationId: conversation, limit: 0 });
      expect(minClamped).toHaveLength(1);
      const negativeOffset = await taskRepository.findAll({ conversationId: conversation, offset: -10 });
      expect(negativeOffset).toHaveLength(100);

      // Offset paginação sem sobreposição e sem buraco.
      const pageOne = await taskRepository.findAll({ conversationId: conversation, limit: 50, offset: 0 });
      const pageTwo = await taskRepository.findAll({ conversationId: conversation, limit: 50, offset: 50 });
      expect(pageOne).toHaveLength(50);
      expect(pageTwo).toHaveLength(50);
      const pageOneIds = new Set(pageOne.map((task) => task.id));
      expect(pageTwo.every((task) => !pageOneIds.has(task.id))).toBe(true);

      // HTTP: teto do schema e offset negativo.
      const httpCapped = await app.inject({
        method: 'GET',
        url: `/tasks?conversationId=${conversation}&limit=200&offset=0`,
        headers: auth(actorA),
      });
      expect(httpCapped.statusCode).toBe(200);
      expect((httpCapped.json() as unknown[])).toHaveLength(200);

      const overMax = await app.inject({
        method: 'GET',
        url: `/tasks?conversationId=${conversation}&limit=201`,
        headers: auth(actorA),
      });
      expect(overMax.statusCode).toBe(400);

      const zeroLimit = await app.inject({
        method: 'GET',
        url: `/tasks?conversationId=${conversation}&limit=0`,
        headers: auth(actorA),
      });
      expect(zeroLimit.statusCode).toBe(400);

      const negativeOffsetHttp = await app.inject({
        method: 'GET',
        url: `/tasks?conversationId=${conversation}&offset=-1`,
        headers: auth(actorA),
      });
      expect(negativeOffsetHttp.statusCode).toBe(400);
    });

    it('CORRIGIDO SA-015-D4 — dueAt inválido deve ser rejeitado com 4xx (hoje 500)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers: auth(actorA),
        payload: { conversationId: conversationA, dueAt: 'nao-e-data', title: title('d4-dueAt-4xx') },
      });
      recordProbe('d4-dueat-invalido-espera-4xx', response.statusCode);
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.statusCode).toBeLessThan(500);
    });
  });
});
