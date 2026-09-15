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
import { eq, inArray, or, sql } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

/**
 * AAA-04 — autorização por recurso (C02 v1.0.1, achado A02) e G-C02-1.
 * HTTP + PostgreSQL real do run aaa-20260912-a4 (DATABASE_URL obrigatório).
 * Não mocka @cvg/gateway-adapter: as rotas internas precisam ser reais.
 */

const SERVICE_KEY = 'aaa04-service-key';
const password = 'ChatRoutePass!42';
const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
const runId = `aaa04-${Date.now()}`;
const externalMessageId = `ext-${runId}-1`;
const previousRateLimitMax = process.env.RATE_LIMIT_MAX;

interface Actor {
  id: string;
  email: string;
  token: string;
}

describe('AAA-04 — authorization by resource + gateway service auth', () => {
  process.env.GATEWAY_API_KEY = SERVICE_KEY;

  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  const createdUserIds: string[] = [];
  const createdSectorIds: string[] = [];
  const createdConversationIds: string[] = [];
  const createdTaskIds: string[] = [];
  const createdAlertIds: string[] = [];
  const createdContactIds: string[] = [];
  const extraContactIds: string[] = [];
  const createdNoteIds: string[] = [];
  const createdLabelIds: string[] = [];
  const createdTransferIds: string[] = [];

  let sectorA = '';
  let sectorB = '';
  let conversationA = '';
  let conversationB = '';
  let sectorlessOwned = '';
  let messageA = '';
  let noteA = '';
  let noteB = '';
  let taskA = '';
  let taskB = '';
  let alertA = '';
  let alertB = '';
  let contactA = '';
  let contactB = '';
  let contactAB = '';
  let contactFree = '';
  let contactConvA = '';
  let contactConvB = '';
  let taskSectorlessOwn = '';
  let taskSectorlessAssigned = '';
  let taskSectorlessForeign = '';
  let alertSectorlessOwn = '';
  let alertSectorlessForeign = '';
  let alertViaOwnTask = '';
  let alertViaForeignTask = '';
  let noteTaskSectorlessOwn = '';
  let noteTaskSectorlessForeign = '';
  let kanbanConvA = '';
  let kanbanConvB = '';
  let kanbanConvSectorless = '';
  let kanbanConvSectorlessOwned = '';
  let transferOwnAccept = '';
  let transferOwnReject = '';
  let transferForeign = '';
  let transferSectorB = '';
  let transferSemRole = '';
  let noteUnlinked = '';
  let groupA = '';
  let groupB = '';
  let labelA = '';
  let labelB = '';

  let actorReadA: Actor;      // Receptionist, membership A nível read
  let actorWriteA: Actor;     // Receptionist, membership A nível write
  let actorNoSector: Actor;   // Receptionist, sem membership
  let actorNoRole: Actor;     // sem role, membership A read
  let admin: Actor;           // Admin, sem membership
  let actorOwner: Actor;      // Receptionist, dono da conversa sem setor (sem membership)
  let actorAB: Actor;         // Receptionist, A read + B write
  let actorRoleDrop: Actor;   // Receptionist, membership A read (role removida no teste)
  let actorVetA: Actor;       // Veterinarian (alerts:write), membership A read
  let actorVetWriteA: Actor;  // Veterinarian (alerts:write), membership A write

  async function ensureRole(name: 'Admin' | 'Receptionist' | 'Veterinarian'): Promise<string> {
    const [existing] = await db.select().from(schema.roles).where(eq(schema.roles.name, name)).limit(1);
    if (existing) return existing.id;
    const [created] = await db.insert(schema.roles).values({ name }).returning();
    return created.id;
  }

  async function createActor(
    label: string,
    role: 'Admin' | 'Receptionist' | 'Veterinarian' | null,
    memberships: Array<{ sectorId: string; accessLevel: 'read' | 'write' | 'admin' }> = [],
  ): Promise<Actor> {
    const id = randomUUID();
    const email = `${runId}.${label}@example.com`;
    await db.insert(schema.users).values({ id, name: `AAA04 ${label}`, email, passwordHash, isActive: true });
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

  async function createConversation(sectorId: string | null, assignedUserId?: string): Promise<string> {
    const [conv] = await db.insert(schema.conversations).values({
      status: 'open',
      statusV2: 'novo',
      currentHandler: 'bot',
      isActive: true,
      sectorId: sectorId ?? undefined,
      assignedUserId,
    }).returning();
    createdConversationIds.push(conv.id);
    return conv.id;
  }

  async function createMessage(conversationId: string, content: string): Promise<string> {
    const [msg] = await db.insert(schema.messages).values({
      conversationId,
      direction: 'inbound',
      content,
      sender: '+5511900000000',
      senderType: 'contact',
      status: 'delivered',
    }).returning();
    return msg.id;
  }

  beforeAll(async () => {
    process.env.GATEWAY_API_KEY = SERVICE_KEY;
    // A suíte excede 100 requisições por ator; o limite de produção é
    // exercitado em outras suítes (aqui só evita 429 espúrio).
    process.env.RATE_LIMIT_MAX = '100000';

    // Guarda de ambiente (FIND-INV-002): recusa URL sem marcador do run a4.
    const databaseUrl = process.env.DATABASE_URL ?? '';
    if (!/cvg_aaa_[a-z0-9_]*a4/.test(databaseUrl)) {
      throw new Error(`AAA-04 exige DATABASE_URL do run a4 (cvg_aaa_*a4); recebido: ${databaseUrl}`);
    }
    const markerResult = await db.execute(sql`SELECT run_id FROM aaa_environment_marker WHERE run_id = 'aaa-20260912-a4'`);
    const markerRows = (markerResult as unknown as { rows: Array<{ run_id: string }> }).rows ?? [];
    if (markerRows.length === 0) {
      throw new Error('Marcador do run aaa-20260912-a4 ausente no banco informado.');
    }

    app = await buildDeskApiApp();
    await app.ready();

    const suffix = String(Date.now()).slice(-6);
    const [a] = await db.insert(schema.sectors).values({ name: `AAA04 A ${suffix}`, code: `a04a${suffix}` }).returning();
    const [b] = await db.insert(schema.sectors).values({ name: `AAA04 B ${suffix}`, code: `a04b${suffix}` }).returning();
    sectorA = a.id;
    sectorB = b.id;
    createdSectorIds.push(sectorA, sectorB);

    actorReadA = await createActor('read-a', 'Receptionist', [{ sectorId: sectorA, accessLevel: 'read' }]);
    actorWriteA = await createActor('write-a', 'Receptionist', [{ sectorId: sectorA, accessLevel: 'write' }]);
    actorNoSector = await createActor('no-sector', 'Receptionist', []);
    actorNoRole = await createActor('no-role', null, [{ sectorId: sectorA, accessLevel: 'read' }]);
    admin = await createActor('admin', 'Admin', []);
    actorOwner = await createActor('owner', 'Receptionist', []);
    actorAB = await createActor('ab', 'Receptionist', [
      { sectorId: sectorA, accessLevel: 'read' },
      { sectorId: sectorB, accessLevel: 'write' },
    ]);
    actorRoleDrop = await createActor('role-drop', 'Receptionist', [{ sectorId: sectorA, accessLevel: 'read' }]);
    actorVetA = await createActor('vet-a', 'Veterinarian', [{ sectorId: sectorA, accessLevel: 'read' }]);
    actorVetWriteA = await createActor('vet-write-a', 'Veterinarian', [{ sectorId: sectorA, accessLevel: 'write' }]);

    conversationA = await createConversation(sectorA);
    conversationB = await createConversation(sectorB);
    sectorlessOwned = await createConversation(null, actorOwner.id);
    messageA = await createMessage(conversationA, 'conteudo do setor A');
    await createMessage(conversationB, 'conteudo do setor B');

    const [noteRowA] = await db.insert(schema.internalNotes).values({
      conversationId: conversationA, authorId: admin.id, content: 'nota do setor A',
    }).returning();
    const [noteRowB] = await db.insert(schema.internalNotes).values({
      conversationId: conversationB, authorId: admin.id, content: 'nota do setor B',
    }).returning();
    noteA = noteRowA.id;
    noteB = noteRowB.id;

    const [taskRowA] = await db.insert(schema.tasks).values({
      conversationId: conversationA, title: 'task do setor A', createdBy: admin.id,
    }).returning();
    const [taskRowB] = await db.insert(schema.tasks).values({
      conversationId: conversationB, title: 'task do setor B', createdBy: admin.id,
    }).returning();
    taskA = taskRowA.id;
    taskB = taskRowB.id;

    const [alertRowA] = await db.insert(schema.alerts).values({
      conversationId: conversationA, type: 'system', title: 'alert do setor A',
    }).returning();
    const [alertRowB] = await db.insert(schema.alerts).values({
      conversationId: conversationB, type: 'system', title: 'alert do setor B',
    }).returning();
    alertA = alertRowA.id;
    alertB = alertRowB.id;

    const suffixContacts = String(Date.now()).slice(-6);
    const [contactRowA] = await db.insert(schema.contacts).values({ name: `Contato A ${suffixContacts}`, phone: `551191${suffixContacts}` }).returning();
    const [contactRowB] = await db.insert(schema.contacts).values({ name: `Contato B ${suffixContacts}`, phone: `551192${suffixContacts}` }).returning();
    const [contactRowAB] = await db.insert(schema.contacts).values({ name: `Contato AB ${suffixContacts}`, phone: `551193${suffixContacts}` }).returning();
    const [contactRowFree] = await db.insert(schema.contacts).values({ name: `Contato Livre ${suffixContacts}`, phone: `551194${suffixContacts}` }).returning();
    contactA = contactRowA.id;
    contactB = contactRowB.id;
    contactAB = contactRowAB.id;
    contactFree = contactRowFree.id;

    await db.insert(schema.contactSectors).values([
      { contactId: contactA, sectorId: sectorA },
      { contactId: contactAB, sectorId: sectorA },
      { contactId: contactAB, sectorId: sectorB },
      { contactId: contactB, sectorId: sectorB },
    ]);

    // H1: contato com conversas em A e B para provar o filtro do detalhe.
    const [contactConvARow] = await db.insert(schema.conversations).values({
      status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true,
      sectorId: sectorA, contactId: contactAB,
    }).returning();
    const [contactConvBRow] = await db.insert(schema.conversations).values({
      status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true,
      sectorId: sectorB, contactId: contactAB,
    }).returning();
    contactConvA = contactConvARow.id;
    contactConvB = contactConvBRow.id;
    createdConversationIds.push(contactConvA, contactConvB);
    await createMessage(contactConvA, 'conteudo-contato-a');
    await createMessage(contactConvB, 'conteudo-contato-b');

    // v6 — recursos sem conversa e recursos das extensões autorizadas.
    const [ownTask] = await db.insert(schema.tasks).values({
      title: 'task solta propria v6', createdBy: actorReadA.id, assignedTo: actorVetA.id,
    }).returning();
    const [assignedTask] = await db.insert(schema.tasks).values({
      title: 'task solta atribuida v6', createdBy: admin.id, assignedTo: actorReadA.id,
    }).returning();
    const [foreignTask] = await db.insert(schema.tasks).values({
      title: 'task solta alheia v6', createdBy: admin.id,
    }).returning();
    taskSectorlessOwn = ownTask.id;
    taskSectorlessAssigned = assignedTask.id;
    taskSectorlessForeign = foreignTask.id;
    createdTaskIds.push(taskSectorlessOwn, taskSectorlessAssigned, taskSectorlessForeign);

    const [ownSectorlessAlert] = await db.insert(schema.alerts).values({
      type: 'system', title: 'alerta solto proprio v6', triggeredBy: actorVetA.id,
    }).returning();
    const [foreignSectorlessAlert] = await db.insert(schema.alerts).values({
      type: 'system', title: 'alerta solto alheio v6', triggeredBy: admin.id,
    }).returning();
    const [ownTaskAlert] = await db.insert(schema.alerts).values({
      type: 'system', title: 'alerta task solta propria v6', taskId: taskSectorlessOwn,
    }).returning();
    const [foreignTaskAlert] = await db.insert(schema.alerts).values({
      type: 'system', title: 'alerta task solta alheia v6', taskId: taskSectorlessForeign,
    }).returning();
    alertSectorlessOwn = ownSectorlessAlert.id;
    alertSectorlessForeign = foreignSectorlessAlert.id;
    alertViaOwnTask = ownTaskAlert.id;
    alertViaForeignTask = foreignTaskAlert.id;
    createdAlertIds.push(alertSectorlessOwn, alertSectorlessForeign, alertViaOwnTask, alertViaForeignTask);

    const [noteOwnTask] = await db.insert(schema.internalNotes).values({
      taskId: taskSectorlessOwn, authorId: admin.id, content: 'nota task solta propria v6',
    }).returning();
    const [noteForeignTask] = await db.insert(schema.internalNotes).values({
      taskId: taskSectorlessForeign, authorId: admin.id, content: 'nota task solta alheia v6',
    }).returning();
    noteTaskSectorlessOwn = noteOwnTask.id;
    noteTaskSectorlessForeign = noteForeignTask.id;
    createdNoteIds.push(noteTaskSectorlessOwn, noteTaskSectorlessForeign);

    // v7 — nota sem conversa nem task (default-deny na leitura).
    const [unlinkedNote] = await db.insert(schema.internalNotes).values({
      authorId: actorReadA.id, content: 'nota sem vinculo v7',
    }).returning();
    noteUnlinked = unlinkedNote.id;
    createdNoteIds.push(noteUnlinked);

    kanbanConvA = await createConversation(sectorA);
    kanbanConvB = await createConversation(sectorB);
    kanbanConvSectorless = await createConversation(null);
    kanbanConvSectorlessOwned = await createConversation(null, actorOwner.id);

    const [ownAccept] = await db.insert(schema.contactTransfers).values({
      contactId: contactA, conversationId: conversationA, toSectorId: sectorA, toUserId: actorReadA.id, status: 'pending',
    }).returning();
    const [ownReject] = await db.insert(schema.contactTransfers).values({
      contactId: contactA, conversationId: conversationA, toSectorId: sectorA, toUserId: actorReadA.id, status: 'pending',
    }).returning();
    const [foreign] = await db.insert(schema.contactTransfers).values({
      contactId: contactB, conversationId: conversationB, toSectorId: sectorB, status: 'pending',
    }).returning();
    const [sectorBTransfer] = await db.insert(schema.contactTransfers).values({
      contactId: contactAB, conversationId: conversationB, toSectorId: sectorB, status: 'pending',
    }).returning();
    const [semRole] = await db.insert(schema.contactTransfers).values({
      contactId: contactAB, conversationId: conversationA, toSectorId: sectorB, toUserId: actorReadA.id, status: 'pending',
    }).returning();
    transferOwnAccept = ownAccept.id;
    transferOwnReject = ownReject.id;
    transferForeign = foreign.id;
    transferSectorB = sectorBTransfer.id;
    transferSemRole = semRole.id;
    createdTransferIds.push(transferOwnAccept, transferOwnReject, transferForeign, transferSectorB, transferSemRole);

    const suffixGroups = String(Date.now()).slice(-6);
    const [groupRowA] = await db.insert(schema.contactGroups).values({
      name: `AAA04 grupo A ${suffixGroups}`, groupType: 'sector', sectorId: sectorA,
    }).returning();
    const [groupRowB] = await db.insert(schema.contactGroups).values({
      name: `AAA04 grupo B ${suffixGroups}`, groupType: 'sector', sectorId: sectorB,
    }).returning();
    groupA = groupRowA.id;
    groupB = groupRowB.id;

    const [labelRowA] = await db.insert(schema.labels).values({
      name: `aaa04-label-a-${runId}`,
    }).returning();
    const [labelRowB] = await db.insert(schema.labels).values({
      name: `aaa04-label-b-${runId}`,
    }).returning();
    labelA = labelRowA.id;
    labelB = labelRowB.id;
    createdLabelIds.push(labelA, labelB);
  });

  afterAll(async () => {
    // Alerts podem referenciar tasks (FK alerts.task_id) e notes referenciam
    // tasks/convites: remover dependentes antes dos pais.
    for (const alertId of createdAlertIds) {
      await db.delete(schema.alertEvents).where(eq(schema.alertEvents.alertId, alertId));
      await db.delete(schema.alerts).where(eq(schema.alerts.id, alertId));
    }
    // Alerts criados por POST durante a suíte podem ter alert_events (FK);
    // remover os eventos de todo alert vinculado às conversas/tasks do run
    // antes dos DELETEs por conversationId/taskId, para que uma falha de
    // teste não deixe lixo nem aborte o afterAll.
    const linkedAlerts = await db
      .select({ id: schema.alerts.id })
      .from(schema.alerts)
      .where(or(
        createdConversationIds.length > 0
          ? inArray(schema.alerts.conversationId, createdConversationIds)
          : sql`false`,
        createdTaskIds.length > 0
          ? inArray(schema.alerts.taskId, createdTaskIds)
          : sql`false`,
      ));
    if (linkedAlerts.length > 0) {
      await db.delete(schema.alertEvents).where(inArray(schema.alertEvents.alertId, linkedAlerts.map((row) => row.id)));
    }
    for (const noteId of createdNoteIds) {
      await db.delete(schema.internalNotes).where(eq(schema.internalNotes.id, noteId));
    }
    for (const transferId of createdTransferIds) {
      await db.delete(schema.contactTransfers).where(eq(schema.contactTransfers.id, transferId));
    }
    for (const groupId of [groupA, groupB]) {
      if (!groupId) continue;
      await db.delete(schema.contactGroupMembers).where(eq(schema.contactGroupMembers.groupId, groupId));
      await db.delete(schema.contactGroups).where(eq(schema.contactGroups.id, groupId));
    }
    for (const labelId of createdLabelIds) {
      await db.delete(schema.conversationLabels).where(eq(schema.conversationLabels.labelId, labelId));
      await db.delete(schema.contactLabels).where(eq(schema.contactLabels.labelId, labelId));
      await db.delete(schema.labels).where(eq(schema.labels.id, labelId));
    }
    for (const conversationId of createdConversationIds) {
      await db.delete(schema.messages).where(eq(schema.messages.conversationId, conversationId));
      await db.delete(schema.conversationStatusHistory).where(eq(schema.conversationStatusHistory.conversationId, conversationId));
      await db.delete(schema.internalNotes).where(eq(schema.internalNotes.conversationId, conversationId));
      await db.delete(schema.alerts).where(eq(schema.alerts.conversationId, conversationId));
      await db.delete(schema.tasks).where(eq(schema.tasks.conversationId, conversationId));
      await db.delete(schema.conversations).where(eq(schema.conversations.id, conversationId));
    }
    for (const taskId of createdTaskIds) {
      await db.delete(schema.internalNotes).where(eq(schema.internalNotes.taskId, taskId));
      await db.delete(schema.alerts).where(eq(schema.alerts.taskId, taskId));
      await db.delete(schema.taskStatusHistory).where(eq(schema.taskStatusHistory.taskId, taskId));
      await db.delete(schema.tasks).where(eq(schema.tasks.id, taskId));
    }
    for (const contactId of [contactA, contactB, contactAB, contactFree, ...extraContactIds]) {
      if (!contactId) continue;
      await db.delete(schema.contactSectors).where(eq(schema.contactSectors.contactId, contactId));
      await db.delete(schema.contacts).where(eq(schema.contacts.id, contactId));
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
    for (const contactId of createdContactIds) {
      await db.delete(schema.contactSectors).where(eq(schema.contactSectors.contactId, contactId));
      await db.delete(schema.contacts).where(eq(schema.contacts.id, contactId));
    }
    if (previousRateLimitMax === undefined) {
      delete process.env.RATE_LIMIT_MAX;
    } else {
      process.env.RATE_LIMIT_MAX = previousRateLimitMax;
    }
    await app.close();
  });

  describe('matriz HTTP (D-C02-2/3/4)', () => {
    it('par discriminante: A lê conversa de A (200) e conversa de B (404)', async () => {
      const own = await app.inject({ method: 'GET', url: `/conversations/${conversationA}/messages`, headers: auth(actorReadA) });
      expect(own.statusCode).toBe(200);
      expect(own.body).toContain('conteudo do setor A');

      const cross = await app.inject({ method: 'GET', url: `/conversations/${conversationB}/messages`, headers: auth(actorReadA) });
      expect(cross.statusCode).toBe(404);
      expect(cross.body).not.toContain('conteudo do setor B');
    });

    it('POST /messages cross-setor → 404 sem conteúdo', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: auth(actorReadA),
        payload: { conversationId: conversationB, content: 'tentativa cross-setor' },
      });
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain('conteudo do setor B');
    });

    it('POST /conversations/:id/read cross-setor → 404', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/conversations/${conversationB}/read`,
        headers: auth(actorReadA),
      });
      expect(response.statusCode).toBe(404);
    });

    it('membership nível read tentando enviar (write) na própria conversa → 403', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: auth(actorReadA),
        payload: { conversationId: conversationA, content: 'sem nível write' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('sem membership → 404; sem role → 403; admin → 200', async () => {
      const noSector = await app.inject({ method: 'GET', url: `/conversations/${conversationA}/messages`, headers: auth(actorNoSector) });
      expect(noSector.statusCode).toBe(404);

      const noRole = await app.inject({ method: 'GET', url: `/conversations/${conversationA}/messages`, headers: auth(actorNoRole) });
      expect(noRole.statusCode).toBe(403);

      const adminRead = await app.inject({ method: 'GET', url: `/conversations/${conversationB}/messages`, headers: auth(admin) });
      expect(adminRead.statusCode).toBe(200);
    });

    it('conversa sem setor (D-C02-3): dono → 200; outro não-admin → 404; admin → 200', async () => {
      const owner = await app.inject({ method: 'GET', url: `/conversations/${sectorlessOwned}/messages`, headers: auth(actorOwner) });
      expect(owner.statusCode).toBe(200);

      const other = await app.inject({ method: 'GET', url: `/conversations/${sectorlessOwned}/messages`, headers: auth(actorReadA) });
      expect(other.statusCode).toBe(404);

      const adminRead = await app.inject({ method: 'GET', url: `/conversations/${sectorlessOwned}/messages`, headers: auth(admin) });
      expect(adminRead.statusCode).toBe(200);
    });

    it('retirada de membership invalida decisão em sessão ativa (sem cache)', async () => {
      await db.insert(schema.userSectors).values({ userId: actorNoSector.id, sectorId: sectorA, accessLevel: 'read' }).onConflictDoNothing();

      const before = await app.inject({ method: 'GET', url: `/conversations/${conversationA}/messages`, headers: auth(actorNoSector) });
      expect(before.statusCode).toBe(200);

      await db.delete(schema.userSectors).where(eq(schema.userSectors.userId, actorNoSector.id));

      const after = await app.inject({ method: 'GET', url: `/conversations/${conversationA}/messages`, headers: auth(actorNoSector) });
      expect(after.statusCode).toBe(404);
    });

    it('retirada de role em sessão ativa invalida na próxima requisição (403 sem permissão)', async () => {
      const before = await app.inject({ method: 'GET', url: `/conversations/${conversationA}/messages`, headers: auth(actorRoleDrop) });
      expect(before.statusCode).toBe(200);

      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, actorRoleDrop.id));

      const after = await app.inject({ method: 'GET', url: `/conversations/${conversationA}/messages`, headers: auth(actorRoleDrop) });
      expect(after.statusCode).toBe(403);
    });

    it('POST /messages e /read sem membership → 404; admin acessa leitura alheia (200)', async () => {
      const send = await app.inject({
        method: 'POST',
        url: '/messages',
        headers: auth(actorNoSector),
        payload: { conversationId: conversationA, content: 'sem membership' },
      });
      expect(send.statusCode).toBe(404);

      const read = await app.inject({ method: 'POST', url: `/conversations/${conversationA}/read`, headers: auth(actorNoSector) });
      expect(read.statusCode).toBe(404);

      const adminRead = await app.inject({ method: 'POST', url: `/conversations/${conversationB}/read`, headers: auth(admin) });
      expect(adminRead.statusCode).toBe(200);
    });
  });

  describe('G-C02-1 — credencial de serviço nas rotas internas do gateway', () => {
    it('GET /gateway/outbound/pending sem credencial → 401; com credencial → 200 (shape preservado)', async () => {
      const denied = await app.inject({ method: 'GET', url: '/gateway/outbound/pending' });
      expect(denied.statusCode).toBe(401);

      const granted = await app.inject({
        method: 'GET',
        url: '/gateway/outbound/pending',
        headers: { 'x-api-key': SERVICE_KEY },
      });
      expect(granted.statusCode).toBe(200);
      const body = granted.json() as { count: number; messages: unknown[] };
      expect(typeof body.count).toBe('number');
      expect(Array.isArray(body.messages)).toBe(true);
    });

    it('POST /gateway/outbound/:id/sent sem credencial → 401; com credencial → {success:true}', async () => {
      const denied = await app.inject({
        method: 'POST',
        url: `/gateway/outbound/${messageA}/sent`,
        payload: { messageId: externalMessageId },
      });
      expect(denied.statusCode).toBe(401);

      const granted = await app.inject({
        method: 'POST',
        url: `/gateway/outbound/${messageA}/sent`,
        headers: { 'x-api-key': SERVICE_KEY },
        payload: { messageId: externalMessageId },
      });
      expect(granted.statusCode).toBe(200);
      expect(granted.json()).toEqual({ success: true });

      const [stored] = await db.select().from(schema.messages).where(eq(schema.messages.id, messageA));
      expect(stored.status).toBe('sent');
      expect(stored.externalMessageId).toBe(externalMessageId);
    });

    it('POST /sent com id interno desconhecido preserva {success:true} sem 500', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/gateway/outbound/${randomUUID()}/sent`,
        headers: { 'x-api-key': SERVICE_KEY },
        payload: { messageId: 'ext-unknown' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
    });

    it('chave inválida e sessão Bearer sem x-api-key → 401; /pending preserva shape CW_OUTBOUND', async () => {
      const invalid = await app.inject({ method: 'GET', url: '/gateway/outbound/pending', headers: { 'x-api-key': 'chave-invalida' } });
      expect(invalid.statusCode).toBe(401);

      const bearerOnly = await app.inject({ method: 'GET', url: '/gateway/outbound/pending', headers: auth(actorReadA) });
      expect(bearerOnly.statusCode).toBe(401);

      const [pending] = await db.insert(schema.messages).values({
        conversationId: conversationA,
        direction: 'outbound',
        senderType: 'human',
        content: 'pendente shape',
        recipient: '+5511900000000',
        status: 'pending',
      }).returning();

      const granted = await app.inject({ method: 'GET', url: '/gateway/outbound/pending', headers: { 'x-api-key': SERVICE_KEY } });
      expect(granted.statusCode).toBe(200);
      const body = granted.json() as { messages: Array<{ event_type: string; event_id: string; payload: { content: string } }> };
      const match = body.messages.find((m) => m.event_id === pending.id);
      expect(match).toBeDefined();
      expect(match?.event_type).toBe('CW_OUTBOUND');
      expect(match?.payload.content).toBe('pendente shape');
    });
  });

  describe('recursos relacionados (notes/tasks/alerts)', () => {
    it('notes por conversa: leitura no próprio setor; 404 no alheio; escrita sem nível → 403', async () => {
      const own = await app.inject({ method: 'GET', url: `/notes?conversationId=${conversationA}`, headers: auth(actorReadA) });
      expect(own.statusCode).toBe(200);
      expect(own.body).toContain('nota do setor A');

      const cross = await app.inject({ method: 'GET', url: `/notes?conversationId=${conversationB}`, headers: auth(actorReadA) });
      expect(cross.statusCode).toBe(404);
      expect(cross.body).not.toContain('nota do setor B');

      const detailCross = await app.inject({ method: 'GET', url: `/notes/${noteB}`, headers: auth(actorReadA) });
      expect(detailCross.statusCode).toBe(404);
      expect(detailCross.body).not.toContain('nota do setor B');

      const detailOwn = await app.inject({ method: 'GET', url: `/notes/${noteA}`, headers: auth(actorReadA) });
      expect(detailOwn.statusCode).toBe(200);

      const createReadOnly = await app.inject({
        method: 'POST',
        url: '/notes',
        headers: auth(actorReadA),
        payload: { conversationId: conversationA, content: 'tentativa sem write', authorId: actorReadA.id },
      });
      expect(createReadOnly.statusCode).toBe(403);
    });

    it('tasks por conversa: 200 no próprio setor e 404 no alheio', async () => {
      const own = await app.inject({ method: 'GET', url: `/tasks/${taskA}`, headers: auth(actorReadA) });
      expect(own.statusCode).toBe(200);

      const cross = await app.inject({ method: 'GET', url: `/tasks/${taskB}`, headers: auth(actorReadA) });
      expect(cross.statusCode).toBe(404);
      expect(cross.body).not.toContain('task do setor B');
    });

    it('alerts por conversa: 200 no próprio setor e 404 no alheio', async () => {
      const own = await app.inject({ method: 'GET', url: `/alerts/${alertA}`, headers: auth(actorReadA) });
      expect(own.statusCode).toBe(200);

      const cross = await app.inject({ method: 'GET', url: `/alerts/${alertB}`, headers: auth(actorReadA) });
      expect(cross.statusCode).toBe(404);
      expect(cross.body).not.toContain('alert do setor B');
    });

    it('tasks/alerts: escrita cross-setor → 404 sem vazamento', async () => {
      const taskCross = await app.inject({
        method: 'PATCH',
        url: `/tasks/${taskB}/status`,
        headers: auth(actorReadA),
        payload: { status: 'in_progress' },
      });
      expect(taskCross.statusCode).toBe(404);
      expect(taskCross.body).not.toContain('task do setor B');

      const alertCross = await app.inject({
        method: 'POST',
        url: `/alerts/${alertB}/acknowledge`,
        headers: auth(actorVetA),
        payload: { acknowledgedBy: actorVetA.id },
      });
      expect(alertCross.statusCode).toBe(404);
      expect(alertCross.body).not.toContain('alert do setor B');
    });
  });

  describe('contatos (recurso com vínculo de setor)', () => {
    it('contato sem vínculo permanece no diretório autenticado (decisão registrada)', async () => {
      const reader = await app.inject({ method: 'GET', url: `/contacts/${contactFree}`, headers: auth(actorReadA) });
      expect(reader.statusCode).toBe(200);

      const noSector = await app.inject({ method: 'GET', url: `/contacts/${contactFree}`, headers: auth(actorNoSector) });
      expect(noSector.statusCode).toBe(200);
    });

    it('vínculo de setor: membro lê do seu setor; terceiro recebe 404', async () => {
      const own = await app.inject({ method: 'GET', url: `/contacts/${contactA}`, headers: auth(actorReadA) });
      expect(own.statusCode).toBe(200);

      const cross = await app.inject({ method: 'GET', url: `/contacts/${contactB}`, headers: auth(actorReadA) });
      expect(cross.statusCode).toBe(404);

      const noSector = await app.inject({ method: 'GET', url: `/contacts/${contactA}`, headers: auth(actorNoSector) });
      expect(noSector.statusCode).toBe(404);
    });

    it('detalhe do contato não vaza conversas de setor sem acesso (H1)', async () => {
      const single = await app.inject({ method: 'GET', url: `/contacts/${contactAB}`, headers: auth(actorReadA) });
      expect(single.statusCode).toBe(200);
      expect(single.body).toContain('conteudo-contato-a');
      expect(single.body).not.toContain('conteudo-contato-b');

      const dual = await app.inject({ method: 'GET', url: `/contacts/${contactAB}`, headers: auth(actorAB) });
      expect(dual.statusCode).toBe(200);
      expect(dual.body).toContain('conteudo-contato-a');
      expect(dual.body).toContain('conteudo-contato-b');
    });

    it('múltiplos setores com níveis diferentes: qualquer vínculo com o nível exigido autoriza', async () => {
      const readAB = await app.inject({ method: 'GET', url: `/contacts/${contactAB}`, headers: auth(actorAB) });
      expect(readAB.statusCode).toBe(200);

      const writeAB = await app.inject({
        method: 'PUT',
        url: `/contacts/${contactAB}`,
        headers: auth(actorAB),
        payload: { name: 'Contato AB atualizado' },
      });
      expect(writeAB.statusCode).toBe(200);

      const writeA = await app.inject({
        method: 'PUT',
        url: `/contacts/${contactA}`,
        headers: auth(actorAB),
        payload: { name: 'Contato A tentativa' },
      });
      expect(writeA.statusCode).toBe(403);

      const readB = await app.inject({ method: 'GET', url: `/contacts/${contactB}`, headers: auth(actorAB) });
      expect(readB.statusCode).toBe(200);
    });

    it('contato sem vínculo: escrita (PUT) segue D-AUTHZ-01 para qualquer autenticado', async () => {
      const put = await app.inject({
        method: 'PUT',
        url: `/contacts/${contactFree}`,
        headers: auth(actorNoSector),
        payload: { name: 'Contato Livre atualizado' },
      });
      expect(put.statusCode).toBe(200);
    });

    it('independência de ordem: vínculos inseridos em ordem inversa também autorizam', async () => {
      const suffix = String(Date.now()).slice(-6);
      const [contactBA] = await db.insert(schema.contacts).values({ name: `Contato BA ${suffix}`, phone: `551196${suffix}` }).returning();
      extraContactIds.push(contactBA.id);
      await db.insert(schema.contactSectors).values([
        { contactId: contactBA.id, sectorId: sectorB },
        { contactId: contactBA.id, sectorId: sectorA },
      ]);

      const put = await app.inject({
        method: 'PUT',
        url: `/contacts/${contactBA.id}`,
        headers: auth(actorAB),
        payload: { name: 'Contato BA atualizado' },
      });
      expect(put.statusCode).toBe(200);

      const get = await app.inject({ method: 'GET', url: `/contacts/${contactBA.id}`, headers: auth(actorAB) });
      expect(get.statusCode).toBe(200);
    });

    it('start-conversation: write no setor autoriza; leitura sem nível e sem membership negam', async () => {
      const positive = await app.inject({
        method: 'POST',
        url: `/contacts/${contactAB}/start-conversation`,
        headers: auth(actorAB),
        payload: { sectorId: sectorB },
      });
      expect(positive.statusCode).toBe(201);
      const created = positive.json() as { conversationId?: string };
      if (created.conversationId) createdConversationIds.push(created.conversationId);

      const readOnly = await app.inject({
        method: 'POST',
        url: `/contacts/${contactA}/start-conversation`,
        headers: auth(actorReadA),
        payload: { sectorId: sectorA },
      });
      expect(readOnly.statusCode).toBe(403);

      const noMembership = await app.inject({
        method: 'POST',
        url: `/contacts/${contactA}/start-conversation`,
        headers: auth(actorNoSector),
        payload: { sectorId: sectorA },
      });
      expect(noMembership.statusCode).toBe(404);
    });
  });

  describe('v5 — listagens com escopo (H2)', () => {
    it('GET /tasks esconde tarefa de conversa sem acesso e mantem as proprias sem conversa', async () => {
      const [ownTask] = await db.insert(schema.tasks).values({ title: 'task solta do ator', createdBy: actorReadA.id }).returning();
      createdTaskIds.push(ownTask.id);
      const [otherTask] = await db.insert(schema.tasks).values({ title: 'task solta alheia', createdBy: admin.id }).returning();
      createdTaskIds.push(otherTask.id);

      const list = await app.inject({ method: 'GET', url: '/tasks', headers: auth(actorReadA) });
      expect(list.statusCode).toBe(200);
      const ids = (list.json() as Array<{ id: string }>).map((task) => task.id);
      expect(ids).toContain(taskA);
      expect(ids).toContain(ownTask.id);
      expect(ids).not.toContain(taskB);
      expect(ids).not.toContain(otherTask.id);
      expect(list.body).not.toContain('task do setor B');

      const adminList = await app.inject({ method: 'GET', url: '/tasks', headers: auth(admin) });
      const adminIds = (adminList.json() as Array<{ id: string }>).map((task) => task.id);
      expect(adminIds).toContain(taskB);
      expect(adminIds).toContain(otherTask.id);
    });

    it('GET /alerts esconde alerta de conversa/task sem acesso (taskId indireto conta)', async () => {
      const [indirect] = await db.insert(schema.alerts).values({ taskId: taskB, type: 'system', title: 'alerta indireto B' }).returning();
      createdAlertIds.push(indirect.id);
      const [own] = await db.insert(schema.alerts).values({ type: 'system', title: 'alerta proprio', triggeredBy: actorReadA.id }).returning();
      createdAlertIds.push(own.id);

      const list = await app.inject({ method: 'GET', url: '/alerts', headers: auth(actorReadA) });
      expect(list.statusCode).toBe(200);
      const ids = (list.json() as Array<{ id: string }>).map((alert) => alert.id);
      expect(ids).toContain(alertA);
      expect(ids).toContain(own.id);
      expect(ids).not.toContain(alertB);
      expect(ids).not.toContain(indirect.id);
      expect(list.body).not.toContain('alerta indireto B');
    });

    it('GET /contacts esconde contato de setor sem acesso e mantem sem vinculo', async () => {
      const list = await app.inject({ method: 'GET', url: '/contacts', headers: auth(actorReadA) });
      expect(list.statusCode).toBe(200);
      const ids = (list.json() as Array<{ id: string }>).map((contact) => contact.id);
      expect(ids).toContain(contactA);
      expect(ids).toContain(contactAB);
      expect(ids).toContain(contactFree);
      expect(ids).not.toContain(contactB);

      const noSector = await app.inject({ method: 'GET', url: '/contacts', headers: auth(actorNoSector) });
      const noSectorIds = (noSector.json() as Array<{ id: string }>).map((contact) => contact.id);
      expect(noSectorIds).toContain(contactFree);
      expect(noSectorIds).not.toContain(contactA);
      expect(noSectorIds).not.toContain(contactB);

      const adminList = await app.inject({ method: 'GET', url: '/contacts', headers: auth(admin) });
      const adminIds = (adminList.json() as Array<{ id: string }>).map((contact) => contact.id);
      expect(adminIds).toContain(contactB);
    });
  });

  describe('v5 — notes por referencia a task (FIND-AAA04-003)', () => {
    it('referenceType task + referenceId nao atravessa setor; criador sem conversa pode', async () => {
      const createdNoteIds: string[] = [];
      try {
        const cross = await app.inject({
          method: 'POST',
          url: '/notes',
          headers: auth(actorReadA),
          payload: { referenceType: 'task', referenceId: taskB, content: 'nota cross-setor', authorId: actorReadA.id },
        });
        expect(cross.statusCode).toBe(404);

        const allowed = await app.inject({
          method: 'POST',
          url: '/notes',
          headers: auth(actorAB),
          payload: { referenceType: 'task', referenceId: taskB, content: 'nota permitida B', authorId: actorAB.id },
        });
        expect(allowed.statusCode).toBe(201);
        createdNoteIds.push((allowed.json() as { id: string }).id);

        const [ownTask] = await db.insert(schema.tasks).values({ title: 'task sem conversa do ator', createdBy: actorReadA.id }).returning();
        createdTaskIds.push(ownTask.id);
        const own = await app.inject({
          method: 'POST',
          url: '/notes',
          headers: auth(actorReadA),
          payload: { referenceType: 'task', referenceId: ownTask.id, content: 'nota propria', authorId: actorReadA.id },
        });
        expect(own.statusCode).toBe(201);
        createdNoteIds.push((own.json() as { id: string }).id);

        const [foreignTask] = await db.insert(schema.tasks).values({ title: 'task sem conversa alheia', createdBy: admin.id }).returning();
        createdTaskIds.push(foreignTask.id);
        const foreign = await app.inject({
          method: 'POST',
          url: '/notes',
          headers: auth(actorReadA),
          payload: { referenceType: 'task', referenceId: foreignTask.id, content: 'nota alheia', authorId: actorReadA.id },
        });
        expect(foreign.statusCode).toBe(404);
      } finally {
        for (const noteId of createdNoteIds) {
          await db.delete(schema.internalNotes).where(eq(schema.internalNotes.id, noteId));
        }
      }
    });
  });

  describe('v5 — start-conversation (FIND-AAA04-004)', () => {
    it('nao revela conversa existente sem acesso; sem setor exige membership', async () => {
      const hidden = await app.inject({
        method: 'POST',
        url: `/contacts/${contactAB}/start-conversation`,
        headers: auth(actorReadA),
        payload: {},
      });
      expect(hidden.statusCode).toBe(404);
      expect(hidden.body).not.toContain(contactConvB);

      const adminCall = await app.inject({
        method: 'POST',
        url: `/contacts/${contactAB}/start-conversation`,
        headers: auth(admin),
        payload: {},
      });
      expect(adminCall.statusCode).toBe(201);
      expect((adminCall.json() as { conversationId: string }).conversationId).toBe(contactConvB);

      const noMembership = await app.inject({
        method: 'POST',
        url: `/contacts/${contactFree}/start-conversation`,
        headers: auth(actorNoSector),
        payload: {},
      });
      expect(noMembership.statusCode).toBe(403);
    });
  });

  describe('v5 — detalhe/admin e ordem (H1/D-AUTHZ-01)', () => {
    it('admin ve todas as conversas do contato; decisao independe da ordem dos vinculos', async () => {
      const adminDetail = await app.inject({ method: 'GET', url: `/contacts/${contactAB}`, headers: auth(admin) });
      expect(adminDetail.statusCode).toBe(200);
      expect(adminDetail.body).toContain('conteudo-contato-a');
      expect(adminDetail.body).toContain('conteudo-contato-b');

      const suffix = String(Date.now()).slice(-6);
      const [contactBA] = await db.insert(schema.contacts).values({ name: `Contato BA v5 ${suffix}`, phone: `551197${suffix}` }).returning();
      extraContactIds.push(contactBA.id);
      await db.insert(schema.contactSectors).values([
        { contactId: contactBA.id, sectorId: sectorB },
        { contactId: contactBA.id, sectorId: sectorA },
      ]);

      for (const contactId of [contactAB, contactBA.id]) {
        const allowed = await app.inject({
          method: 'PUT',
          url: `/contacts/${contactId}`,
          headers: auth(actorAB),
          payload: { name: 'Atualizado v5' },
        });
        expect(allowed.statusCode).toBe(200);

        const denied = await app.inject({
          method: 'PUT',
          url: `/contacts/${contactId}`,
          headers: auth(actorReadA),
          payload: { name: 'Sem nivel v5' },
        });
        expect(denied.statusCode).toBe(403);
      }
    });
  });

  describe('v6 — notes: referência de task sempre autorizada (FIND-AAA04-003)', () => {
    it('conversationId autorizado não curto-circuita task de outro setor', async () => {
      const before = await db
        .select({ id: schema.internalNotes.id })
        .from(schema.internalNotes)
        .where(eq(schema.internalNotes.taskId, taskB));

      const crossReference = await app.inject({
        method: 'POST',
        url: '/notes',
        headers: auth(actorReadA),
        payload: { conversationId: conversationA, referenceType: 'task', referenceId: taskB, content: 'bypass task B ref', authorId: actorReadA.id },
      });
      expect(crossReference.statusCode).toBe(404);
      expect(crossReference.body).not.toContain('bypass task B ref');

      const crossTaskId = await app.inject({
        method: 'POST',
        url: '/notes',
        headers: auth(actorReadA),
        payload: { conversationId: conversationA, taskId: taskB, content: 'bypass task B id', authorId: actorReadA.id },
      });
      expect(crossTaskId.statusCode).toBe(404);

      const foreignSectorless = await app.inject({
        method: 'POST',
        url: '/notes',
        headers: auth(actorReadA),
        payload: { conversationId: conversationA, referenceType: 'task', referenceId: taskSectorlessForeign, content: 'bypass task solta alheia', authorId: actorReadA.id },
      });
      expect(foreignSectorless.statusCode).toBe(404);

      const after = await db
        .select({ id: schema.internalNotes.id })
        .from(schema.internalNotes)
        .where(eq(schema.internalNotes.taskId, taskB));
      expect(after.length).toBe(before.length);
    });

    it('task resolvida e autorizada define a referência persistida', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/notes',
        headers: auth(actorAB),
        payload: { conversationId: conversationB, referenceType: 'task', referenceId: taskB, content: 'nota task B resolvida', authorId: actorAB.id },
      });
      expect(response.statusCode).toBe(201);
      const noteId = (response.json() as { id: string }).id;
      createdNoteIds.push(noteId);

      const [stored] = await db.select().from(schema.internalNotes).where(eq(schema.internalNotes.id, noteId));
      expect(stored.taskId).toBe(taskB);
      expect(stored.conversationId).toBeNull();
      expect(stored.referenceType).toBe('task');
      expect(stored.referenceId).toBe(taskB);
    });

    it('task sem conversa: criador/assignee/admin autorizam mesmo com conversationId no corpo', async () => {
      const asCreator = await app.inject({
        method: 'POST',
        url: '/notes',
        headers: auth(actorReadA),
        payload: { conversationId: conversationA, referenceType: 'task', referenceId: taskSectorlessOwn, content: 'nota task propria v6', authorId: actorReadA.id },
      });
      expect(asCreator.statusCode).toBe(201);
      createdNoteIds.push((asCreator.json() as { id: string }).id);

      const asAssignee = await app.inject({
        method: 'POST',
        url: '/notes',
        headers: auth(actorReadA),
        payload: { taskId: taskSectorlessAssigned, content: 'nota task atribuida v6', authorId: actorReadA.id },
      });
      expect(asAssignee.statusCode).toBe(201);
      createdNoteIds.push((asAssignee.json() as { id: string }).id);

      const adminPositive = await app.inject({
        method: 'POST',
        url: '/notes',
        headers: auth(admin),
        payload: { conversationId: conversationB, referenceType: 'task', referenceId: taskSectorlessForeign, content: 'nota admin v6', authorId: admin.id },
      });
      expect(adminPositive.statusCode).toBe(201);
      createdNoteIds.push((adminPositive.json() as { id: string }).id);
    });
  });

  describe('v6 — notes: leitura por task sem conversa', () => {
    it('GET /notes?taskId= exige criador/assignee/admin', async () => {
      const foreign = await app.inject({ method: 'GET', url: `/notes?taskId=${taskSectorlessForeign}`, headers: auth(actorReadA) });
      expect(foreign.statusCode).toBe(404);
      expect(foreign.body).not.toContain('nota task solta alheia v6');

      const own = await app.inject({ method: 'GET', url: `/notes?taskId=${taskSectorlessOwn}`, headers: auth(actorReadA) });
      expect(own.statusCode).toBe(200);
      expect(own.body).toContain('nota task solta propria v6');

      const adminRead = await app.inject({ method: 'GET', url: `/notes?taskId=${taskSectorlessForeign}`, headers: auth(admin) });
      expect(adminRead.statusCode).toBe(200);

      const noSector = await app.inject({ method: 'GET', url: `/notes?taskId=${taskSectorlessAssigned}`, headers: auth(actorNoSector) });
      expect(noSector.statusCode).toBe(404);
    });

    it('GET /notes/:id de nota ligada a task sem conversa alheia nega', async () => {
      const foreign = await app.inject({ method: 'GET', url: `/notes/${noteTaskSectorlessForeign}`, headers: auth(actorReadA) });
      expect(foreign.statusCode).toBe(404);
      expect(foreign.body).not.toContain('nota task solta alheia v6');

      const own = await app.inject({ method: 'GET', url: `/notes/${noteTaskSectorlessOwn}`, headers: auth(actorReadA) });
      expect(own.statusCode).toBe(200);

      const adminRead = await app.inject({ method: 'GET', url: `/notes/${noteTaskSectorlessForeign}`, headers: auth(admin) });
      expect(adminRead.statusCode).toBe(200);
    });
  });

  describe('v6 — tasks sem conversa: detalhe e efeito', () => {
    it('GET/PATCH de task alheia sem conversa negam sem vazar título', async () => {
      const crossGet = await app.inject({ method: 'GET', url: `/tasks/${taskSectorlessForeign}`, headers: auth(actorReadA) });
      expect(crossGet.statusCode).toBe(404);
      expect(crossGet.body).not.toContain('task solta alheia v6');

      const crossPatch = await app.inject({
        method: 'PATCH', url: `/tasks/${taskSectorlessForeign}/status`, headers: auth(actorReadA), payload: { status: 'completed' },
      });
      expect(crossPatch.statusCode).toBe(404);
      const [unchanged] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskSectorlessForeign));
      expect(unchanged.status).toBe('pending');

      const ownGet = await app.inject({ method: 'GET', url: `/tasks/${taskSectorlessOwn}`, headers: auth(actorReadA) });
      expect(ownGet.statusCode).toBe(200);

      const assignedGet = await app.inject({ method: 'GET', url: `/tasks/${taskSectorlessAssigned}`, headers: auth(actorReadA) });
      expect(assignedGet.statusCode).toBe(200);

      const ownPatch = await app.inject({
        method: 'PATCH', url: `/tasks/${taskSectorlessOwn}/status`, headers: auth(actorReadA), payload: { status: 'in_progress' },
      });
      expect(ownPatch.statusCode).toBe(200);

      const adminGet = await app.inject({ method: 'GET', url: `/tasks/${taskSectorlessForeign}`, headers: auth(admin) });
      expect(adminGet.statusCode).toBe(200);

      const noSector = await app.inject({ method: 'GET', url: `/tasks/${taskSectorlessOwn}`, headers: auth(actorNoSector) });
      expect(noSector.statusCode).toBe(404);
    });
  });

  describe('v6 — alerts sem conversa/task: detalhe e efeito', () => {
    it('GET/ack/resolve de alerta sem vínculo negam sem mutar', async () => {
      const crossGet = await app.inject({ method: 'GET', url: `/alerts/${alertSectorlessForeign}`, headers: auth(actorVetA) });
      expect(crossGet.statusCode).toBe(404);
      expect(crossGet.body).not.toContain('alerta solto alheio v6');

      const crossAck = await app.inject({
        method: 'POST', url: `/alerts/${alertSectorlessForeign}/acknowledge`, headers: auth(actorVetA), payload: { acknowledgedBy: actorVetA.id },
      });
      expect(crossAck.statusCode).toBe(404);
      const [stillActive] = await db.select().from(schema.alerts).where(eq(schema.alerts.id, alertSectorlessForeign));
      expect(stillActive.status).toBe('active');

      const crossResolve = await app.inject({
        method: 'POST', url: `/alerts/${alertSectorlessForeign}/resolve`, headers: auth(actorVetA), payload: { resolvedBy: actorVetA.id },
      });
      expect(crossResolve.statusCode).toBe(404);

      const viaForeignTask = await app.inject({ method: 'GET', url: `/alerts/${alertViaForeignTask}`, headers: auth(actorVetA) });
      expect(viaForeignTask.statusCode).toBe(404);
      expect(viaForeignTask.body).not.toContain('alerta task solta alheia v6');

      const ownGet = await app.inject({ method: 'GET', url: `/alerts/${alertSectorlessOwn}`, headers: auth(actorVetA) });
      expect(ownGet.statusCode).toBe(200);

      const ownAck = await app.inject({
        method: 'POST', url: `/alerts/${alertSectorlessOwn}/acknowledge`, headers: auth(actorVetA), payload: { acknowledgedBy: actorVetA.id },
      });
      expect(ownAck.statusCode).toBe(200);

      const taskOwnGet = await app.inject({ method: 'GET', url: `/alerts/${alertViaOwnTask}`, headers: auth(actorReadA) });
      expect(taskOwnGet.statusCode).toBe(200);

      const taskOwnResolve = await app.inject({
        method: 'POST', url: `/alerts/${alertViaOwnTask}/resolve`, headers: auth(actorVetA), payload: { resolvedBy: actorVetA.id },
      });
      expect(taskOwnResolve.statusCode).toBe(200);

      const adminGet = await app.inject({ method: 'GET', url: `/alerts/${alertSectorlessForeign}`, headers: auth(admin) });
      expect(adminGet.statusCode).toBe(200);
    });
  });

  describe('v6 — kanban: board e movimento por recurso', () => {
    it('board esconde card de conversa sem leitura', async () => {
      const board = await app.inject({ method: 'GET', url: '/kanban/board', headers: auth(actorReadA) });
      expect(board.statusCode).toBe(200);
      const ids = (board.json() as { columns: Array<{ cards: Array<{ id: string }> }> }).columns.flatMap((column) => column.cards.map((card) => card.id));
      expect(ids).toContain(kanbanConvA);
      expect(ids).not.toContain(kanbanConvB);

      const adminBoard = await app.inject({ method: 'GET', url: '/kanban/board', headers: auth(admin) });
      expect(adminBoard.statusCode).toBe(200);
      const adminIds = (adminBoard.json() as { columns: Array<{ cards: Array<{ id: string }> }> }).columns.flatMap((column) => column.cards.map((card) => card.id));
      expect(adminIds).toContain(kanbanConvB);
    });

    it('mover card exige membership; leitura sem write recebe 403', async () => {
      const cross = await app.inject({
        method: 'PATCH', url: `/kanban/card/${kanbanConvB}/move`, headers: auth(actorReadA), payload: { status: 'em_atendimento' },
      });
      expect(cross.statusCode).toBe(404);
      const [unchanged] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, kanbanConvB));
      expect(unchanged.statusV2).toBe('novo');

      const readOnly = await app.inject({
        method: 'PATCH', url: `/kanban/card/${kanbanConvA}/move`, headers: auth(actorReadA), payload: { status: 'em_atendimento' },
      });
      expect(readOnly.statusCode).toBe(403);

      const write = await app.inject({
        method: 'PATCH', url: `/kanban/card/${kanbanConvA}/move`, headers: auth(actorWriteA), payload: { status: 'em_atendimento' },
      });
      expect(write.statusCode).toBe(200);

      const adminMove = await app.inject({
        method: 'PATCH', url: `/kanban/card/${kanbanConvB}/move`, headers: auth(admin), payload: { status: 'pendente' },
      });
      expect(adminMove.statusCode).toBe(200);
    });
  });

  describe('v6 — transfers por recurso', () => {
    it('lista esconde transferência de contato/conversa sem acesso', async () => {
      const list = await app.inject({ method: 'GET', url: '/transfers', headers: auth(actorReadA) });
      expect(list.statusCode).toBe(200);
      const ids = (list.json() as Array<{ id: string }>).map((transfer) => transfer.id);
      expect(ids).toContain(transferOwnAccept);
      expect(ids).not.toContain(transferForeign);

      const adminList = await app.inject({ method: 'GET', url: '/transfers', headers: auth(admin) });
      const adminIds = (adminList.json() as Array<{ id: string }>).map((transfer) => transfer.id);
      expect(adminIds).toContain(transferForeign);
    });

    it('histórico do contato exige acesso ao contato', async () => {
      const own = await app.inject({ method: 'GET', url: `/contacts/${contactA}/transfers`, headers: auth(actorReadA) });
      expect(own.statusCode).toBe(200);

      const cross = await app.inject({ method: 'GET', url: `/contacts/${contactB}/transfers`, headers: auth(actorReadA) });
      expect(cross.statusCode).toBe(404);
      expect(cross.body).not.toContain(transferForeign);
    });

    it('accept/reject exigem destinatário (toUserId/setor) ou admin', async () => {
      const crossAccept = await app.inject({ method: 'POST', url: `/transfers/${transferForeign}/accept`, headers: auth(actorReadA) });
      expect(crossAccept.statusCode).toBe(404);

      const crossReject = await app.inject({ method: 'POST', url: `/transfers/${transferForeign}/reject`, headers: auth(actorReadA) });
      expect(crossReject.statusCode).toBe(404);

      const [stillPending] = await db.select().from(schema.contactTransfers).where(eq(schema.contactTransfers.id, transferForeign));
      expect(stillPending.status).toBe('pending');

      const ownAccept = await app.inject({ method: 'POST', url: `/transfers/${transferOwnAccept}/accept`, headers: auth(actorReadA) });
      expect(ownAccept.statusCode).toBe(200);

      const ownReject = await app.inject({ method: 'POST', url: `/transfers/${transferOwnReject}/reject`, headers: auth(actorReadA) });
      expect(ownReject.statusCode).toBe(200);

      const sectorRecipient = await app.inject({ method: 'POST', url: `/transfers/${transferSectorB}/accept`, headers: auth(actorAB) });
      expect(sectorRecipient.statusCode).toBe(200);

      const adminAccept = await app.inject({ method: 'POST', url: `/transfers/${transferForeign}/accept`, headers: auth(admin) });
      expect(adminAccept.statusCode).toBe(200);
    });
  });

  describe('v6 — contact-groups por vínculo/admin', () => {
    it('lista e membros de grupo alheio negam para não-admin', async () => {
      const list = await app.inject({ method: 'GET', url: '/contact-groups', headers: auth(actorReadA) });
      expect(list.statusCode).toBe(200);
      const ids = (list.json() as Array<{ id: string }>).map((group) => group.id);
      expect(ids).toContain(groupA);
      expect(ids).not.toContain(groupB);

      const adminList = await app.inject({ method: 'GET', url: '/contact-groups', headers: auth(admin) });
      const adminIds = (adminList.json() as Array<{ id: string }>).map((group) => group.id);
      expect(adminIds).toContain(groupB);

      const ownMembers = await app.inject({ method: 'GET', url: `/contact-groups/${groupA}/members`, headers: auth(actorReadA) });
      expect(ownMembers.statusCode).toBe(200);

      const crossMembers = await app.inject({ method: 'GET', url: `/contact-groups/${groupB}/members`, headers: auth(actorReadA) });
      expect(crossMembers.statusCode).toBe(404);

      const crossAdd = await app.inject({
        method: 'POST', url: `/contact-groups/${groupB}/members`, headers: auth(actorReadA), payload: { contactId: contactA },
      });
      expect(crossAdd.statusCode).toBe(404);

      const crossRemove = await app.inject({
        method: 'DELETE', url: `/contact-groups/${groupB}/members/${contactA}`, headers: auth(actorReadA),
      });
      expect(crossRemove.statusCode).toBe(404);

      const noSector = await app.inject({ method: 'GET', url: `/contact-groups/${groupA}/members`, headers: auth(actorNoSector) });
      expect(noSector.statusCode).toBe(404);
    });

    it('GET /contacts/:id/groups exige contato acessível', async () => {
      const own = await app.inject({ method: 'GET', url: `/contacts/${contactA}/groups`, headers: auth(actorReadA) });
      expect(own.statusCode).toBe(200);

      const cross = await app.inject({ method: 'GET', url: `/contacts/${contactB}/groups`, headers: auth(actorReadA) });
      expect(cross.statusCode).toBe(404);
    });
  });

  describe('v6 — labels por recurso', () => {
    it('labels de conversa exigem acesso à conversa', async () => {
      const ownGet = await app.inject({ method: 'GET', url: `/conversations/${conversationA}/labels`, headers: auth(actorReadA) });
      expect(ownGet.statusCode).toBe(200);

      const crossGet = await app.inject({ method: 'GET', url: `/conversations/${conversationB}/labels`, headers: auth(actorReadA) });
      expect(crossGet.statusCode).toBe(404);

      const crossAdd = await app.inject({
        method: 'POST', url: `/conversations/${conversationB}/labels`, headers: auth(actorReadA), payload: { labelId: labelA },
      });
      expect(crossAdd.statusCode).toBe(404);

      const crossRemove = await app.inject({
        method: 'DELETE', url: `/conversations/${conversationB}/labels/${labelA}`, headers: auth(actorReadA),
      });
      expect(crossRemove.statusCode).toBe(404);

      const adminGet = await app.inject({ method: 'GET', url: `/conversations/${conversationB}/labels`, headers: auth(admin) });
      expect(adminGet.statusCode).toBe(200);

      const ownWrite = await app.inject({
        method: 'POST', url: `/conversations/${conversationA}/labels`, headers: auth(actorWriteA), payload: { labelId: labelB },
      });
      expect(ownWrite.statusCode).toBe(201);
    });

    it('labels de contato exigem acesso ao contato', async () => {
      const ownGet = await app.inject({ method: 'GET', url: `/contacts/${contactA}/labels`, headers: auth(actorReadA) });
      expect(ownGet.statusCode).toBe(200);

      const crossGet = await app.inject({ method: 'GET', url: `/contacts/${contactB}/labels`, headers: auth(actorReadA) });
      expect(crossGet.statusCode).toBe(404);

      const crossAdd = await app.inject({
        method: 'POST', url: `/contacts/${contactB}/labels`, headers: auth(actorReadA), payload: { labelId: labelA },
      });
      expect(crossAdd.statusCode).toBe(404);

      const adminGet = await app.inject({ method: 'GET', url: `/contacts/${contactB}/labels`, headers: auth(admin) });
      expect(adminGet.statusCode).toBe(200);

      const ownWrite = await app.inject({
        method: 'POST', url: `/contacts/${contactA}/labels`, headers: auth(actorWriteA), payload: { labelId: labelB },
      });
      expect(ownWrite.statusCode).toBe(201);
    });
  });

  describe('v7 — notes: referência de conversa resolvida no servidor', () => {
    it('rejeita divergência entre conversationId e referenceId sem gravar no id não autorizado', async () => {
      const before = await db
        .select({ id: schema.internalNotes.id })
        .from(schema.internalNotes)
        .where(eq(schema.internalNotes.conversationId, conversationB));

      const response = await app.inject({
        method: 'POST',
        url: '/notes',
        headers: auth(actorWriteA),
        payload: {
          conversationId: conversationA,
          referenceType: 'conversation',
          referenceId: conversationB,
          content: `bypass referencia conversa B ${runId}`,
          authorId: actorWriteA.id,
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain(conversationB);

      const persisted = await db
        .select({ id: schema.internalNotes.id })
        .from(schema.internalNotes)
        .where(eq(schema.internalNotes.conversationId, conversationB));
      expect(persisted.length).toBe(before.length);
      const leak = await db
        .select({ id: schema.internalNotes.id })
        .from(schema.internalNotes)
        .where(eq(schema.internalNotes.content, `bypass referencia conversa B ${runId}`));
      expect(leak).toHaveLength(0);
    });

    it('persiste a referência autorizada quando conversationId e referenceId coincidem', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/notes',
        headers: auth(actorWriteA),
        payload: {
          conversationId: conversationA,
          referenceType: 'conversation',
          referenceId: conversationA,
          content: 'nota conversa normalizada v7',
          authorId: actorWriteA.id,
        },
      });
      expect(response.statusCode).toBe(201);
      const noteId = (response.json() as { id: string }).id;
      createdNoteIds.push(noteId);

      const [stored] = await db.select().from(schema.internalNotes).where(eq(schema.internalNotes.id, noteId));
      expect(stored.conversationId).toBe(conversationA);
      expect(stored.referenceType).toBe('conversation');
      expect(stored.referenceId).toBe(conversationA);
    });
  });

  describe('v7 — kanban: conversa sem setor exige vínculo (D-AUTHZ-02)', () => {
    it('terceiro sem vínculo recebe 404 sem mutação; dono e admin movem', async () => {
      const thirdParty = await app.inject({
        method: 'PATCH', url: `/kanban/card/${kanbanConvSectorless}/move`, headers: auth(actorReadA), payload: { status: 'em_atendimento' },
      });
      expect(thirdParty.statusCode).toBe(404);
      const [unchanged] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, kanbanConvSectorless));
      expect(unchanged.statusV2).toBe('novo');

      const noMembership = await app.inject({
        method: 'PATCH', url: `/kanban/card/${kanbanConvSectorless}/move`, headers: auth(actorNoSector), payload: { status: 'em_atendimento' },
      });
      expect(noMembership.statusCode).toBe(404);

      const adminMove = await app.inject({
        method: 'PATCH', url: `/kanban/card/${kanbanConvSectorless}/move`, headers: auth(admin), payload: { status: 'em_atendimento' },
      });
      expect(adminMove.statusCode).toBe(200);

      const ownerMove = await app.inject({
        method: 'PATCH', url: `/kanban/card/${kanbanConvSectorlessOwned}/move`, headers: auth(actorOwner), payload: { status: 'em_atendimento' },
      });
      expect(ownerMove.statusCode).toBe(200);

      const thirdOnOwned = await app.inject({
        method: 'PATCH', url: `/kanban/card/${kanbanConvSectorlessOwned}/move`, headers: auth(actorReadA), payload: { status: 'pendente' },
      });
      expect(thirdOnOwned.statusCode).toBe(404);
      const [ownedState] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, kanbanConvSectorlessOwned));
      expect(ownedState.statusV2).toBe('em_atendimento');
    });
  });

  describe('v7 — alerts: referências combinadas autorizadas separadamente', () => {
    it('nega task sem acesso mesmo com conversa autorizada e não cria alerta', async () => {
      const crossTask = await app.inject({
        method: 'POST',
        url: '/alerts',
        headers: auth(actorVetWriteA),
        payload: {
          conversationId: conversationA,
          taskId: taskB,
          type: 'system',
          title: `alerta combinado task B ${runId}`,
          triggeredBy: actorVetWriteA.id,
        },
      });
      expect(crossTask.statusCode).toBe(404);

      const sectorlessTask = await app.inject({
        method: 'POST',
        url: '/alerts',
        headers: auth(actorVetWriteA),
        payload: {
          conversationId: conversationA,
          taskId: taskSectorlessForeign,
          type: 'system',
          title: `alerta combinado task solta ${runId}`,
          triggeredBy: actorVetWriteA.id,
        },
      });
      expect(sectorlessTask.statusCode).toBe(404);

      const leaked = await db.select().from(schema.alerts).where(eq(schema.alerts.title, `alerta combinado task B ${runId}`));
      expect(leaked).toHaveLength(0);
      const leakedSectorless = await db.select().from(schema.alerts).where(eq(schema.alerts.title, `alerta combinado task solta ${runId}`));
      expect(leakedSectorless).toHaveLength(0);
    });

    it('cria alerta quando conversa e task estão ambas autorizadas', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/alerts',
        headers: auth(actorVetWriteA),
        payload: {
          conversationId: conversationA,
          taskId: taskA,
          type: 'system',
          title: 'alerta combinado ok v7',
          triggeredBy: actorVetWriteA.id,
        },
      });
      expect(response.statusCode).toBe(201);
      const alertId = (response.json() as { id: string }).id;
      createdAlertIds.push(alertId);

      const [stored] = await db.select().from(schema.alerts).where(eq(schema.alerts.id, alertId));
      expect(stored.conversationId).toBe(conversationA);
      expect(stored.taskId).toBe(taskA);
    });
  });

  describe('v7 — notes sem conversa nem task', () => {
    it('GET /notes/:id nega terceiro; autor e admin leem', async () => {
      const thirdParty = await app.inject({ method: 'GET', url: `/notes/${noteUnlinked}`, headers: auth(actorVetA) });
      expect(thirdParty.statusCode).toBe(404);
      expect(thirdParty.body).not.toContain('nota sem vinculo v7');

      const author = await app.inject({ method: 'GET', url: `/notes/${noteUnlinked}`, headers: auth(actorReadA) });
      expect(author.statusCode).toBe(200);
      expect(author.body).toContain('nota sem vinculo v7');

      const adminRead = await app.inject({ method: 'GET', url: `/notes/${noteUnlinked}`, headers: auth(admin) });
      expect(adminRead.statusCode).toBe(200);
    });
  });

  describe('v7 — sem-role: kanban/transfers/contact-groups/labels', () => {
    it('ator sem role não ganha escrita por membership read', async () => {
      const [kanbanBefore] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, kanbanConvA));
      const kanban = await app.inject({
        method: 'PATCH', url: `/kanban/card/${kanbanConvA}/move`, headers: auth(actorNoRole), payload: { status: 'em_atendimento' },
      });
      expect(kanban.statusCode).toBe(403);
      const [kanbanAfter] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, kanbanConvA));
      expect(kanbanAfter.statusV2).toBe(kanbanBefore.statusV2);

      const transfer = await app.inject({
        method: 'POST', url: `/transfers/${transferSemRole}/accept`, headers: auth(actorNoRole),
      });
      expect(transfer.statusCode).toBe(404);
      const [transferAfter] = await db.select().from(schema.contactTransfers).where(eq(schema.contactTransfers.id, transferSemRole));
      expect(transferAfter.status).toBe('pending');

      const groupMember = await app.inject({
        method: 'POST', url: `/contact-groups/${groupA}/members`, headers: auth(actorNoRole), payload: { contactId: contactA },
      });
      expect(groupMember.statusCode).toBe(403);
      const groupRows = await db
        .select()
        .from(schema.contactGroupMembers)
        .where(eq(schema.contactGroupMembers.groupId, groupA));
      expect(groupRows.map((row) => row.contactId)).not.toContain(contactA);

      const groupWrite = await app.inject({
        method: 'PUT', url: `/contact-groups/${groupA}`, headers: auth(actorNoRole), payload: { name: 'sem role' },
      });
      expect(groupWrite.statusCode).toBe(403);

      const labelAdmin = await app.inject({
        method: 'POST', url: '/labels', headers: auth(actorNoRole), payload: { name: `sem-role-label-${runId}` },
      });
      expect(labelAdmin.statusCode).toBe(403);

      const labelConversation = await app.inject({
        method: 'POST', url: `/conversations/${conversationA}/labels`, headers: auth(actorNoRole), payload: { labelId: labelA },
      });
      expect(labelConversation.statusCode).toBe(403);

      const labelContact = await app.inject({
        method: 'POST', url: `/contacts/${contactA}/labels`, headers: auth(actorNoRole), payload: { labelId: labelA },
      });
      expect(labelContact.statusCode).toBe(403);
    });
  });
});
