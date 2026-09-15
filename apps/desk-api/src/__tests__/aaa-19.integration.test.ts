import { vi } from 'vitest';
vi.mock('@cvg/secretary-adapter', () => ({
  triggerHandoff: vi.fn().mockResolvedValue(undefined),
  invokeSecretary: vi.fn().mockResolvedValue({ isErr: () => true, isOk: () => false }),
}));
vi.mock('../../../../modules/chat/src/application/events/chat-publisher.ts', () => ({
  publishMessagePersisted: vi.fn().mockResolvedValue(undefined),
  publishConversationCreated: vi.fn().mockResolvedValue(undefined),
  publishConversationStatusChanged: vi.fn().mockResolvedValue(undefined),
}));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

/**
 * AAA-19 — autoria de notas vinculada à identidade autenticada (A16, QA03/QA17).
 *
 * Fonte de verdade: C01 §1/§12 ("o cliente não escolhe autor") e C02 §2
 * (`AuthzActor` vem da sessão). Sem delegação definida, `authorId` do corpo:
 *   - ausente  → autor = principal autenticado;
 *   - igual    → compatibilidade preservada (autor = principal);
 *   - divergente/`createdBy`/`changedBy` → 400 sem gravar linha.
 *
 * Prova em HTTP real (`app.inject`) + PostgreSQL real do run `aaa-20260912-a19`
 * em 127.0.0.1:56432 (marcador obrigatório no beforeAll; sem fallback 5432).
 * Regressão: leitura/escrita por conversa e task preservam as decisões de
 * AAA-04/C02 (404 fora do escopo, 403 sem nível, default-deny sem vínculo).
 */

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const DB_MARKER = 'aaa-20260912-a19';
const password = 'ChatRoutePass!42';
const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
const runId = `aaa19-${Date.now()}`;
const previousRateLimitMax = process.env.RATE_LIMIT_MAX;

interface Actor {
  id: string;
  email: string;
  token: string;
}

describe('AAA-19 — autoria de notas vinculada à identidade autenticada', () => {
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  let suiteReady = false;
  const createdUserIds: string[] = [];
  const createdSectorIds: string[] = [];
  const createdConversationIds: string[] = [];
  const createdTaskIds: string[] = [];
  const createdNoteIds: string[] = [];

  let sectorA = '';
  let sectorB = '';
  let conversationA = '';
  let conversationB = '';
  let standaloneTask = '';
  let taskInConversationB = '';
  let noteUnlinked = '';

  let actorWriteA: Actor;
  let actorReadA: Actor;
  let actorB: Actor;
  let admin: Actor;

  async function ensureRole(name: 'Admin' | 'Receptionist'): Promise<string> {
    const [existing] = await db.select().from(schema.roles).where(eq(schema.roles.name, name)).limit(1);
    if (existing) return existing.id;
    const [created] = await db.insert(schema.roles).values({ name }).returning();
    return created.id;
  }

  async function createActor(
    label: string,
    role: 'Admin' | 'Receptionist' | null,
    memberships: Array<{ sectorId: string; accessLevel: 'read' | 'write' }> = [],
  ): Promise<Actor> {
    const id = randomUUID();
    const email = `${runId}.${label}@example.com`;
    await db.insert(schema.users).values({ id, name: `AAA19 ${label}`, email, passwordHash, isActive: true });
    createdUserIds.push(id);
    if (role) {
      const roleId = await ensureRole(role);
      await db.insert(schema.userRoles).values({ userId: id, roleId });
    }
    for (const membership of memberships) {
      await db.insert(schema.userSectors).values({ userId: id, sectorId: membership.sectorId, accessLevel: membership.accessLevel });
    }
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    if (login.statusCode !== 200) {
      throw new Error(`login falhou para ${label}: ${login.statusCode} ${login.body}`);
    }
    return { id, email, token: (login.json() as { token: string }).token };
  }

  function auth(actor: Actor) {
    return { authorization: `Bearer ${actor.token}` };
  }

  async function createConversation(sectorId: string): Promise<string> {
    const [conv] = await db.insert(schema.conversations).values({
      status: 'open',
      statusV2: 'novo',
      currentHandler: 'bot',
      isActive: true,
      sectorId,
    }).returning();
    createdConversationIds.push(conv.id);
    return conv.id;
  }

  async function findNotesByContent(content: string) {
    return db.select().from(schema.internalNotes).where(eq(schema.internalNotes.content, content));
  }

  beforeAll(async () => {
    // Guarda de ambiente: URL do run a19 em 56432 com marcador; sem fallback.
    if (!/cvg_aaa_[a-z0-9_]*a19/.test(DATABASE_URL) || !DATABASE_URL.includes('127.0.0.1:56432')) {
      throw new Error(`AAA-19 exige DATABASE_URL do run a19 em 127.0.0.1:56432; recebido: ${DATABASE_URL}`);
    }
    const markerResult = await db.execute(sql`SELECT run_id FROM aaa_environment_marker WHERE run_id = ${DB_MARKER}`);
    const markerRows = (markerResult as unknown as { rows: Array<{ run_id: string }> }).rows ?? [];
    if (markerRows.length === 0) {
      throw new Error(`Marcador ${DB_MARKER} ausente no banco informado.`);
    }

    suiteReady = true;
    process.env.RATE_LIMIT_MAX = '100000';
    app = await buildDeskApiApp();
    await app.ready();

    const suffix = String(Date.now()).slice(-6);
    const [a] = await db.insert(schema.sectors).values({ name: `AAA19 A ${suffix}`, code: `a19a${suffix}` }).returning();
    const [b] = await db.insert(schema.sectors).values({ name: `AAA19 B ${suffix}`, code: `a19b${suffix}` }).returning();
    sectorA = a.id;
    sectorB = b.id;
    createdSectorIds.push(sectorA, sectorB);

    actorWriteA = await createActor('write-a', 'Receptionist', [{ sectorId: sectorA, accessLevel: 'write' }]);
    actorReadA = await createActor('read-a', 'Receptionist', [{ sectorId: sectorA, accessLevel: 'read' }]);
    actorB = await createActor('write-b', 'Receptionist', [{ sectorId: sectorB, accessLevel: 'write' }]);
    admin = await createActor('admin', 'Admin', []);

    conversationA = await createConversation(sectorA);
    conversationB = await createConversation(sectorB);

    const [task] = await db.insert(schema.tasks).values({
      title: `AAA19 tarefa solta ${suffix}`,
      status: 'pending',
      priority: 'medium',
      createdBy: actorWriteA.id,
    }).returning();
    standaloneTask = task.id;
    createdTaskIds.push(standaloneTask);

    const [taskB] = await db.insert(schema.tasks).values({
      title: `AAA19 tarefa do setor B ${suffix}`,
      status: 'pending',
      priority: 'medium',
      conversationId: conversationB,
      createdBy: actorB.id,
    }).returning();
    taskInConversationB = taskB.id;
    createdTaskIds.push(taskInConversationB);

    const [unlinked] = await db.insert(schema.internalNotes).values({
      authorId: actorWriteA.id,
      content: `nota sem vinculo ${runId}`,
      referenceType: 'tutor',
      referenceId: randomUUID(),
    }).returning();
    noteUnlinked = unlinked.id;
    createdNoteIds.push(noteUnlinked);
  });

  afterAll(async () => {
    if (suiteReady) {
      await db.delete(schema.internalNotes).where(eq(schema.internalNotes.content, `${runId} spoof para B`));
      for (const noteId of createdNoteIds) {
        await db.delete(schema.internalNotes).where(eq(schema.internalNotes.id, noteId));
      }
      for (const content of [
        `${runId} admin personifica`,
        `${runId} autor inexistente`,
        `${runId} createdBy`,
        `${runId} changedBy`,
        `${runId} sem authorId`,
        `${runId} authorId igual`,
        `${runId} task cross-setor`,
        `${runId} task solta alheia`,
        `${runId} admin em conversa B`,
        `${runId} leitura alheia`,
        `${runId} read-only`,
      ]) {
        await db.delete(schema.internalNotes).where(eq(schema.internalNotes.content, content));
      }
      for (const taskId of createdTaskIds) {
        await db.delete(schema.internalNotes).where(eq(schema.internalNotes.taskId, taskId));
        await db.delete(schema.taskStatusHistory).where(eq(schema.taskStatusHistory.taskId, taskId));
        await db.delete(schema.tasks).where(eq(schema.tasks.id, taskId));
      }
      for (const conversationId of createdConversationIds) {
        await db.delete(schema.internalNotes).where(eq(schema.internalNotes.conversationId, conversationId));
        await db.delete(schema.conversationStatusHistory).where(eq(schema.conversationStatusHistory.conversationId, conversationId));
        await db.delete(schema.messages).where(eq(schema.messages.conversationId, conversationId));
        await db.delete(schema.conversations).where(eq(schema.conversations.id, conversationId));
      }
      for (const userId of createdUserIds) {
        await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, userId));
        await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
        await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
        await db.delete(schema.userSectors).where(eq(schema.userSectors.userId, userId));
        await db.delete(schema.users).where(eq(schema.users.id, userId));
      }
      for (const sectorId of createdSectorIds) {
        await db.delete(schema.sectors).where(eq(schema.sectors.id, sectorId));
      }
    }
    if (previousRateLimitMax === undefined) {
      delete process.env.RATE_LIMIT_MAX;
    } else {
      process.env.RATE_LIMIT_MAX = previousRateLimitMax;
    }
    if (app) {
      await app.close();
    }
  });

  describe('spoof de autoria', () => {
    it('A não escreve como B: authorId divergente → 400 e nenhuma linha gravada', async () => {
      const content = `${runId} spoof para B`;
      const response = await app.inject({
        method: 'POST',
        url: '/notes',
        headers: auth(actorWriteA),
        payload: { conversationId: conversationA, content, authorId: actorB.id },
      });
      const persisted = await findNotesByContent(content);
      expect(persisted.map((row) => row.authorId)).toEqual([]);

      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain(actorB.id);
    });

    it('Admin não personifica usuário: authorId de terceiro → 400 sem gravação', async () => {
      const content = `${runId} admin personifica`;
      const response = await app.inject({
        method: 'POST',
        url: '/notes',
        headers: auth(admin),
        payload: { conversationId: conversationA, content, authorId: actorWriteA.id },
      });
      const persisted = await findNotesByContent(content);
      expect(persisted.map((row) => row.authorId)).toEqual([]);

      expect(response.statusCode).toBe(400);
    });

    it('authorId inexistente → 400 (não FK/500) e sem gravação', async () => {
      const content = `${runId} autor inexistente`;
      const response = await app.inject({
        method: 'POST',
        url: '/notes',
        headers: auth(actorWriteA),
        payload: { conversationId: conversationA, content, authorId: randomUUID() },
      });
      const persisted = await findNotesByContent(content);
      expect(persisted.map((row) => row.authorId)).toEqual([]);

      expect(response.statusCode).toBe(400);
      expect(response.statusCode).not.toBe(500);
    });

    it('createdBy/changedBy não são aceitos como autoria → 400 sem gravação', async () => {
      for (const field of ['createdBy', 'changedBy']) {
        const content = `${runId} ${field}`;
        const response = await app.inject({
          method: 'POST',
          url: '/notes',
          headers: auth(actorWriteA),
          payload: { conversationId: conversationA, content, authorId: actorWriteA.id, [field]: actorB.id },
        });
        const persisted = await findNotesByContent(content);
        expect(persisted.map((row) => row.authorId)).toEqual([]);

        expect(response.statusCode).toBe(400);
      }
    });

    it('task de outro setor: guarda de recurso nega (404) mesmo com authorId do próprio ator', async () => {
      const content = `${runId} task cross-setor`;
      const response = await app.inject({
        method: 'POST',
        url: '/notes',
        headers: auth(actorWriteA),
        payload: { referenceType: 'task', referenceId: taskInConversationB, content, authorId: actorWriteA.id },
      });
      const persisted = await findNotesByContent(content);
      expect(persisted.map((row) => row.authorId)).toEqual([]);

      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain(taskInConversationB);
    });

    it('task solta alheia: guarda de recurso nega (404) mesmo com authorId do próprio ator', async () => {
      const content = `${runId} task solta alheia`;
      const response = await app.inject({
        method: 'POST',
        url: '/notes',
        headers: auth(actorB),
        payload: { referenceType: 'task', referenceId: standaloneTask, content, authorId: actorB.id },
      });
      const persisted = await findNotesByContent(content);
      expect(persisted.map((row) => row.authorId)).toEqual([]);

      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain(standaloneTask);
    });
  });

  describe('autor padrão = principal autenticado', () => {
    it('sem authorId: autoria persistida é o principal e a auditoria registra o ator real', async () => {
      const content = `${runId} sem authorId`;
      const response = await app.inject({
        method: 'POST',
        url: '/notes',
        headers: auth(actorWriteA),
        payload: { conversationId: conversationA, content },
      });
      expect(response.statusCode).toBe(201);
      const noteId = (response.json() as { id: string }).id;
      createdNoteIds.push(noteId);

      const [stored] = await db.select().from(schema.internalNotes).where(eq(schema.internalNotes.id, noteId));
      expect(stored.authorId).toBe(actorWriteA.id);

      const [audit] = await db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.entityId, noteId));
      expect(audit.userId).toBe(actorWriteA.id);
      expect(audit.action).toBe('note.created');
      expect(JSON.parse(audit.metadata ?? '{}')).toEqual({ authorId: actorWriteA.id });
    });

    it('authorId igual ao principal continua aceito (compatibilidade)', async () => {
      const content = `${runId} authorId igual`;
      const response = await app.inject({
        method: 'POST',
        url: '/notes',
        headers: auth(actorWriteA),
        payload: { conversationId: conversationA, content, authorId: actorWriteA.id },
      });
      expect(response.statusCode).toBe(201);
      const noteId = (response.json() as { id: string }).id;
      createdNoteIds.push(noteId);
      const [stored] = await db.select().from(schema.internalNotes).where(eq(schema.internalNotes.id, noteId));
      expect(stored.authorId).toBe(actorWriteA.id);
    });

    it('admin global escreve em conversa de setor com autoria administrativa (sem authorId)', async () => {
      const content = `${runId} admin em conversa B`;
      const response = await app.inject({
        method: 'POST',
        url: '/notes',
        headers: auth(admin),
        payload: { conversationId: conversationB, content },
      });
      expect(response.statusCode).toBe(201);
      const noteId = (response.json() as { id: string }).id;
      createdNoteIds.push(noteId);
      const [stored] = await db.select().from(schema.internalNotes).where(eq(schema.internalNotes.id, noteId));
      expect(stored.authorId).toBe(admin.id);
      expect(stored.conversationId).toBe(conversationB);
    });
  });

  describe('regressão de autorização (AAA-04/C02 preservado)', () => {
    it('leitura por conversa: próprio setor 200, setor alheio 404 sem conteúdo', async () => {
      const content = `${runId} leitura alheia`;
      const [note] = await db.insert(schema.internalNotes).values({
        conversationId: conversationA,
        authorId: actorWriteA.id,
        content,
      }).returning();
      createdNoteIds.push(note.id);

      const own = await app.inject({ method: 'GET', url: `/notes?conversationId=${conversationA}`, headers: auth(actorReadA) });
      expect(own.statusCode).toBe(200);
      expect(own.body).toContain(content);

      const cross = await app.inject({ method: 'GET', url: `/notes?conversationId=${conversationB}`, headers: auth(actorReadA) });
      expect(cross.statusCode).toBe(404);

      const detailCross = await app.inject({ method: 'GET', url: `/notes/${note.id}`, headers: auth(actorB) });
      expect(detailCross.statusCode).toBe(404);
      expect(detailCross.body).not.toContain(content);
    });

    it('escrita sem nível de membership → 403 mesmo com authorId do principal', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/notes',
        headers: auth(actorReadA),
        payload: { conversationId: conversationA, content: `${runId} read-only`, authorId: actorReadA.id },
      });
      expect(response.statusCode).toBe(403);
    });

    it('nota sem vínculo: terceiro 404; autor e admin leem', async () => {
      const thirdParty = await app.inject({ method: 'GET', url: `/notes/${noteUnlinked}`, headers: auth(actorB) });
      expect(thirdParty.statusCode).toBe(404);

      const author = await app.inject({ method: 'GET', url: `/notes/${noteUnlinked}`, headers: auth(actorWriteA) });
      expect(author.statusCode).toBe(200);

      const adminRead = await app.inject({ method: 'GET', url: `/notes/${noteUnlinked}`, headers: auth(admin) });
      expect(adminRead.statusCode).toBe(200);
    });
  });
});
