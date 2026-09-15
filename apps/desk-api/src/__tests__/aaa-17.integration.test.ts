import { vi } from 'vitest';
vi.mock('@cvg/secretary-adapter', () => ({
  triggerHandoff: vi.fn().mockResolvedValue(undefined),
  invokeSecretary: vi.fn().mockResolvedValue({ isErr: () => true, isOk: () => false }),
}));
vi.mock('../../../../modules/chat/src/application/events/chat-publisher.ts', () => ({
  publishMessagePersisted: vi.fn().mockResolvedValue(undefined),
  publishConversationCreated: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@cvg/gateway-adapter', () => ({
  registerGatewayRoutes: vi.fn().mockResolvedValue(undefined),
  gatewayService: {
    sendOutbound: vi.fn().mockResolvedValue({ success: true, messageId: 'gw-mock-a17' }),
    healthCheck: vi.fn().mockResolvedValue(true),
    getInstanceStatus: vi.fn().mockResolvedValue(null),
  },
  mediaService: {
    sendText: vi.fn().mockResolvedValue({ success: true, messageId: 'mock-text' }),
    sendImage: vi.fn().mockResolvedValue({ success: true, messageId: 'mock-image' }),
    sendAudio: vi.fn().mockResolvedValue({ success: true, messageId: 'mock-audio' }),
    sendDocument: vi.fn().mockResolvedValue({ success: true, messageId: 'mock-document' }),
  },
}));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';
import { S3MediaStorage } from '../../../../packages/media/src/index.ts';

/**
 * AAA-17 — privacidade, retenção e cópias de dados (C07; achado A14; QA05/QA17).
 *
 * Fronteiras REAIS:
 *   - PostgreSQL real do run `aaa-20260912-a17` em 127.0.0.1:56432
 *     (marcador obrigatório no beforeAll; sem fallback 5432);
 *   - S3 real compatível (moto server) em 127.0.0.1:59010 para as cópias de
 *     mídia; sem MinIO/porta padrão;
 *   - HTTP real via `app.inject` e auditoria REAL (não mockada).
 *
 * A política D02 NÃO está aprovada: os testes provam primeiro o default
 * seguro (dry-run, nenhuma mutação) e só então, com configuração explícita
 * de execução aprovada no processo de teste, o comportamento de
 * pseudonimização — sempre reportado como PARCIAL, nunca como eliminação
 * integral.
 */

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const DB_MARKER = 'aaa-20260912-a17';
const S3_ENDPOINT = 'http://127.0.0.1:59010';
const S3_BUCKET = 'cvg-media-a17';
const password = 'ChatRoutePass!42';
const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';

const PRIVACY_ENV_KEYS = [
  'PRIVACY_OPERATION_MODE',
  'PRIVACY_APPROVED_PSEUDONYMIZE_TYPES',
  'PRIVACY_APPROVED_DELETE_TYPES',
  'PRIVACY_ALLOW_IRREVERSIBLE_DELETE',
  'PRIVACY_POLICY_VERSION',
  'RATE_LIMIT_MAX',
] as const;

interface Actor {
  id: string;
  email: string;
  token: string;
}

interface ContactFixture {
  id: string;
  phone: string;
  name: string;
  email: string;
  externalId: string;
  tutorId?: string;
  patientId?: string;
}

function identifiers(fixture: ContactFixture) {
  return {
    phone: fixture.phone,
    name: fixture.name,
    email: fixture.email,
    externalId: fixture.externalId,
  };
}

async function appService() {
  return import('@cvg/privacy');
}

describe('AAA-17 — privacidade, retenção e cópias de dados', () => {
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  let suiteReady = false;
  let storage: S3MediaStorage;
  const envSnapshot = new Map<string, string | undefined>();

  const userIds: string[] = [];
  const roleIds: string[] = [];
  const sectorIds: string[] = [];
  const contactFixtures: ContactFixture[] = [];
  const contactIds: string[] = [];
  const conversationIds: string[] = [];
  const messageIds: string[] = [];
  const noteIds: string[] = [];
  const outboxEventIds: string[] = [];
  const dlqIds: string[] = [];
  const mediaAssetIds: string[] = [];
  const auditEntityIds: string[] = [];
  const objectKeys: string[] = [];

  let sectorA = '';
  let sectorB = '';
  let admin: Actor;
  let managerA: Actor;
  let writerA: Actor;

  let contactMain!: ContactFixture;
  let contactBOnly!: ContactFixture;
  let contactErase!: ContactFixture;
  let contactMedia!: ContactFixture;
  let contactFault!: ContactFixture;
  let contactComms!: ContactFixture;

  let convMainA = '';
  let convMainB = '';
  let convBOnly = '';
  let convErase = '';
  let convMedia = '';
  let convFault = '';
  let convComms = '';
  let msgEraseIn = '';
  let msgEraseOut = '';
  let noteEraseId = '';
  let outboxEraseId = '';
  let outboxEraseEventId = '';
  let dlqEraseId = '';
  let auditEraseSeedId = '';
  let msgFault = '';
  let noteFaultId = '';
  let outboxFaultEventId = '';
  let dlqFaultId = '';
  let auditFaultSeedId = '';
  let mediaAssetId = '';
  let mediaKey = '';
  let msgMedia = '';

  const auth = (actor: Actor) => ({ authorization: `Bearer ${actor.token}` });

  async function ensureRole(name: 'Admin' | 'Manager' | 'Receptionist'): Promise<string> {
    const [existing] = await db.select().from(schema.roles).where(eq(schema.roles.name, name)).limit(1);
    if (existing) return existing.id;
    const [created] = await db.insert(schema.roles).values({ name }).returning();
    roleIds.push(created.id);
    return created.id;
  }

  async function createActor(
    label: string,
    role: 'Admin' | 'Manager' | 'Receptionist',
    memberships: Array<{ sectorId: string; accessLevel: 'read' | 'write' }> = [],
  ): Promise<Actor> {
    const id = randomUUID();
    const email = `aaa17.${label}.${Date.now()}@example.com`;
    await db.insert(schema.users).values({ id, name: `AAA17 ${label}`, email, passwordHash, isActive: true });
    userIds.push(id);
    const roleId = await ensureRole(role);
    await db.insert(schema.userRoles).values({ userId: id, roleId });
    for (const membership of memberships) {
      await db.insert(schema.userSectors).values({ userId: id, sectorId: membership.sectorId, accessLevel: membership.accessLevel });
    }
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    if (login.statusCode !== 200) throw new Error(`login falhou para ${label}: ${login.statusCode} ${login.body}`);
    return { id, email, token: (login.json() as { token: string }).token };
  }

  async function createSector(label: string): Promise<string> {
    const suffix = String(Date.now()).slice(-5);
    const [sector] = await db.insert(schema.sectors).values({ name: `AAA17 ${label} ${suffix}`, code: `a17${label}${suffix}` }).returning();
    sectorIds.push(sector.id);
    return sector.id;
  }

  async function createContact(fixture: Omit<ContactFixture, 'id'> & { withLinks?: boolean }): Promise<ContactFixture> {
    const id = randomUUID();
    let tutorId: string | undefined;
    let patientId: string | undefined;
    if (fixture.withLinks) {
      const linkSuffix = randomUUID().slice(0, 6);
      const [tutor] = await db.insert(schema.tutors).values({ name: `Tutor Distinto ${linkSuffix}`, phone: `+55119000${linkSuffix}` }).returning();
      tutorId = tutor.id;
      const [patient] = await db.insert(schema.patients).values({ name: `Paciente Distinto ${linkSuffix}`, species: 'canino', tutorId }).returning();
      patientId = patient.id;
    }
    await db.insert(schema.contacts).values({
      id,
      phone: fixture.phone,
      name: fixture.name,
      email: fixture.email,
      externalId: fixture.externalId,
      tutorId,
      patientId,
    });
    const created = { id, phone: fixture.phone, name: fixture.name, email: fixture.email, externalId: fixture.externalId, tutorId, patientId };
    contactFixtures.push(created);
    contactIds.push(id);
    return created;
  }

  async function createConversation(contactId: string, sectorId: string): Promise<string> {
    const [conversation] = await db.insert(schema.conversations).values({
      contactId,
      status: 'open',
      statusV2: 'novo',
      currentHandler: 'bot',
      isActive: true,
      sectorId,
    }).returning();
    conversationIds.push(conversation.id);
    return conversation.id;
  }

  async function insertMessage(input: {
    conversationId: string;
    direction: 'inbound' | 'outbound';
    content: string;
    sender?: string;
    recipient?: string;
    externalMessageId?: string;
  }): Promise<string> {
    const [message] = await db.insert(schema.messages).values({
      conversationId: input.conversationId,
      direction: input.direction,
      content: input.content,
      sender: input.sender,
      recipient: input.recipient,
      externalMessageId: input.externalMessageId ?? `a17-${randomUUID()}`,
    }).returning();
    messageIds.push(message.id);
    return message.id;
  }

  async function insertNote(input: { conversationId: string; authorId: string; content: string }): Promise<string> {
    const [note] = await db.insert(schema.internalNotes).values({
      conversationId: input.conversationId,
      authorId: input.authorId,
      content: input.content,
      referenceType: 'conversation',
      referenceId: input.conversationId,
    }).returning();
    noteIds.push(note.id);
    return note.id;
  }

  async function insertOutbox(input: { aggregateId: string; eventType: string; payload: object }): Promise<{ id: string; eventId: string }> {
    const eventId = `a17-${randomUUID()}`;
    const [event] = await db.insert(schema.outboxEvents).values({
      eventId,
      eventType: input.eventType,
      aggregateType: 'message',
      aggregateId: input.aggregateId,
      occurredAt: new Date(),
      payload: JSON.stringify(input.payload),
    }).returning();
    outboxEventIds.push(event.id);
    return { id: event.id, eventId };
  }

  async function insertDlq(input: { originalEventId: string; payload: object; errorMessage: string }): Promise<string> {
    const [event] = await db.insert(schema.deadLetterEvents).values({
      originalEventId: input.originalEventId,
      consumerId: 'aaa17-consumer',
      eventType: 'message.persisted',
      payload: input.payload,
      errorCode: 'SYNTHETIC',
      errorMessage: input.errorMessage,
    }).returning();
    dlqIds.push(event.id);
    return event.id;
  }

  async function insertMediaAsset(input: { messageId: string; key: string; filename: string }): Promise<string> {
    const [asset] = await db.insert(schema.mediaAssets).values({
      messageId: input.messageId,
      storageDriver: 's3',
      storageBucket: S3_BUCKET,
      storageKey: input.key,
      sha256: 'a'.repeat(64),
      mimeType: 'application/pdf',
      sizeBytes: 128,
      filename: input.filename,
      scanStatus: 'CLEAN',
      storageStatus: 'STORED',
    }).returning();
    mediaAssetIds.push(asset.id);
    return asset.id;
  }

  async function insertAuditSeed(input: { entityId: string; payload: object; actorId: string }): Promise<string> {
    const [row] = await db.insert(schema.auditLogs).values({
      userId: input.actorId,
      action: 'message.outbound.sent',
      entityType: 'message',
      entityId: input.entityId,
      oldValue: JSON.stringify({ content: 'conteudo antigo', recipient: input.payload }),
      newValue: JSON.stringify(input.payload),
      metadata: JSON.stringify(input.payload),
    }).returning();
    auditEntityIds.push(input.entityId);
    return row.id;
  }

  function serializeAudit(rows: Array<Record<string, unknown>>): string {
    return JSON.stringify(rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      oldValue: row.oldValue,
      newValue: row.newValue,
      metadata: row.metadata,
    })));
  }

  async function operationRows(requestId: string): Promise<Array<Record<string, unknown>>> {
    const result = await db.execute(sql`SELECT * FROM privacy_operations WHERE request_id = ${requestId}`);
    return ((result as unknown as { rows: Array<Record<string, unknown>> }).rows ?? []);
  }

  beforeAll(async () => {
    for (const key of PRIVACY_ENV_KEYS) envSnapshot.set(key, process.env[key]);

    if (!DATABASE_URL.includes('127.0.0.1:56432') || !/\/cvg_aaa_[a-z0-9_]*a17(\?|$)/.test(DATABASE_URL)) {
      throw new Error(`AAA-17 exige DATABASE_URL do run a17 em 127.0.0.1:56432; recebido: ${DATABASE_URL}`);
    }
    const marker = await db.execute(sql`SELECT run_id FROM aaa_environment_marker WHERE run_id = ${DB_MARKER}`);
    const markerRows = (marker as unknown as { rows: Array<{ run_id: string }> }).rows ?? [];
    if (markerRows.length === 0) throw new Error(`Marcador ${DB_MARKER} ausente no banco a17.`);

    const s3Up = await fetch(`${S3_ENDPOINT}/`).then((r) => r.ok || r.status === 403).catch(() => false);
    if (!s3Up) throw new Error(`S3-compatible real ausente em ${S3_ENDPOINT} (porta dedicada AAA-17).`);
    await fetch(`${S3_ENDPOINT}/${S3_BUCKET}`, { method: 'PUT' }).catch(() => undefined);
    storage = new S3MediaStorage({
      endpoint: S3_ENDPOINT,
      region: 'us-east-1',
      bucket: S3_BUCKET,
      accessKeyId: 'aaa17key',
      secretAccessKey: 'aaa17secret',
      forcePathStyle: true,
    });

    process.env.RATE_LIMIT_MAX = '100000';
    app = await buildDeskApiApp();
    await app.ready();

    sectorA = await createSector('A');
    sectorB = await createSector('B');
    admin = await createActor('admin', 'Admin');
    managerA = await createActor('manager-a', 'Manager', [{ sectorId: sectorA, accessLevel: 'write' }]);
    writerA = await createActor('writer-a', 'Receptionist', [{ sectorId: sectorA, accessLevel: 'write' }]);

    // Contato principal: conversas em A e B, mensagens, nota, outbox, DLQ,
    // mídia, auditoria com PII e vínculos tutor/paciente.
    contactMain = await createContact({
      phone: '+5511900001001',
      name: 'Mariana Titular',
      email: 'mariana@example.com',
      externalId: 'EXT-A17-MAIN',
      withLinks: true,
    });
    convMainA = await createConversation(contactMain.id, sectorA);
    convMainB = await createConversation(contactMain.id, sectorB);
    const msgMainA = await insertMessage({ conversationId: convMainA, direction: 'inbound', content: `ola ${contactMain.name}`, sender: contactMain.phone });
    await insertMessage({ conversationId: convMainA, direction: 'outbound', content: 'resposta da equipe', sender: 'Atendente', recipient: contactMain.phone });
    await insertMessage({ conversationId: convMainB, direction: 'inbound', content: 'B SECRETO do setor B', sender: contactMain.phone });
    await insertNote({ conversationId: convMainA, authorId: writerA.id, content: `nota interna sobre ${contactMain.name} ${contactMain.phone}` });
    const main = await insertOutbox({
      aggregateId: msgMainA,
      eventType: 'message.persisted',
      payload: { recipient: contactMain.phone, content: `outbox ${contactMain.name}`, email: contactMain.email },
    });
    await insertDlq({
      originalEventId: main.eventId,
      payload: { recipient: contactMain.phone, content: `dlq ${contactMain.name}` },
      errorMessage: `falha para ${contactMain.email}`,
    });
    const mainKey = `media/aaa17/${randomUUID()}.pdf`;
    objectKeys.push(mainKey);
    await storage.put({ key: mainKey, body: Buffer.from(`bytes com ${contactMain.phone}`, 'utf8'), contentType: 'application/pdf' });
    await insertMediaAsset({ messageId: msgMainA, key: mainKey, filename: `laudo-${contactMain.name}.pdf` });
    await insertAuditSeed({ entityId: msgMainA, payload: { recipient: contactMain.phone, name: contactMain.name }, actorId: admin.id });

    // Contato apenas do setor B (negativa de escopo).
    contactBOnly = await createContact({ phone: '+5511900001002', name: 'Bruno SoB', email: 'bruno@example.com', externalId: 'EXT-A17-BONLY' });
    convBOnly = await createConversation(contactBOnly.id, sectorB);
    await insertMessage({ conversationId: convBOnly, direction: 'inbound', content: 'somente setor B', sender: contactBOnly.phone });

    // Contato de pseudonimização completa (dry-run e execute).
    contactErase = await createContact({
      phone: '+5511900001003',
      name: 'Carla Apagar',
      email: 'carla@example.com',
      externalId: 'EXT-A17-ERASE',
      withLinks: true,
    });
    convErase = await createConversation(contactErase.id, sectorA);
    msgEraseIn = await insertMessage({ conversationId: convErase, direction: 'inbound', content: `mensagem de ${contactErase.name}`, sender: contactErase.phone });
    msgEraseOut = await insertMessage({ conversationId: convErase, direction: 'outbound', content: `resposta para ${contactErase.phone}`, sender: 'Atendente', recipient: contactErase.phone });
    noteEraseId = await insertNote({ conversationId: convErase, authorId: writerA.id, content: `nota sobre ${contactErase.name} e ${contactErase.email}` });
    const outboxErase = await insertOutbox({
      aggregateId: msgEraseIn,
      eventType: 'message.persisted',
      payload: { recipient: contactErase.phone, content: `outbox ${contactErase.name}`, email: contactErase.email },
    });
    outboxEraseId = outboxErase.id;
    outboxEraseEventId = outboxErase.eventId;
    dlqEraseId = await insertDlq({
      originalEventId: outboxErase.eventId,
      payload: { recipient: contactErase.phone, content: `dlq ${contactErase.name}` },
      errorMessage: `falha ${contactErase.email}`,
    });
    auditEraseSeedId = await insertAuditSeed({
      entityId: msgEraseOut,
      payload: { recipient: contactErase.phone, name: contactErase.name, email: contactErase.email },
      actorId: admin.id,
    });

    // Contato com mídia (flag de exclusão irreversível).
    contactMedia = await createContact({ phone: '+5511900001004', name: 'Diego Midia', email: 'diego@example.com', externalId: 'EXT-A17-MEDIA' });
    convMedia = await createConversation(contactMedia.id, sectorA);
    msgMedia = await insertMessage({ conversationId: convMedia, direction: 'outbound', content: `anexo para ${contactMedia.name}`, sender: 'Atendente', recipient: contactMedia.phone });
    mediaKey = `media/aaa17/${randomUUID()}.pdf`;
    objectKeys.push(mediaKey);
    await storage.put({ key: mediaKey, body: Buffer.from('bytes da midia', 'utf8'), contentType: 'application/pdf' });
    mediaAssetId = await insertMediaAsset({ messageId: msgMedia, key: mediaKey, filename: `exame-${contactMedia.name}.pdf` });

    // Contato de falha/resume com checkpoint.
    contactFault = await createContact({ phone: '+5511900001005', name: 'Elisa Falha', email: 'elisa@example.com', externalId: 'EXT-A17-FAULT' });
    convFault = await createConversation(contactFault.id, sectorA);
    msgFault = await insertMessage({ conversationId: convFault, direction: 'inbound', content: `falha ${contactFault.name}`, sender: contactFault.phone });
    noteFaultId = await insertNote({ conversationId: convFault, authorId: writerA.id, content: `nota falha ${contactFault.email}` });
    const outboxFault = await insertOutbox({
      aggregateId: msgFault,
      eventType: 'message.persisted',
      payload: { recipient: contactFault.phone, content: contactFault.name },
    });
    outboxFaultEventId = outboxFault.eventId;
    dlqFaultId = await insertDlq({
      originalEventId: outboxFault.eventId,
      payload: { recipient: contactFault.phone, content: `dlq ${contactFault.name}` },
      errorMessage: contactFault.email,
    });
    auditFaultSeedId = await insertAuditSeed({
      entityId: msgFault,
      payload: { recipient: contactFault.phone, name: contactFault.name },
      actorId: admin.id,
    });

    // Contato para auditoria minimizada no caminho de escrita (chat/notes).
    contactComms = await createContact({ phone: '+5511900001006', name: 'Fabio Comunic', email: 'fabio@example.com', externalId: 'EXT-A17-COMMS' });
    convComms = await createConversation(contactComms.id, sectorA);

    const privacy = await appService();
    if (typeof privacy.setPrivacyMediaStorage === 'function') {
      privacy.setPrivacyMediaStorage({
        delete: (key: string) => storage.delete(key),
        exists: (key: string) => storage.exists(key),
      });
    }

    suiteReady = true;
  });

  afterAll(async () => {
    if (suiteReady) {
      const reg = await db.execute(sql`SELECT to_regclass('public.privacy_operations') AS reg`).catch(() => undefined);
      const regRows = (reg as unknown as { rows: Array<{ reg: string | null }> } | undefined)?.rows ?? [];
      if (regRows[0]?.reg) {
        for (const contactId of contactIds) {
          await db.execute(sql`DELETE FROM privacy_operations WHERE contact_id = ${contactId}`).catch(() => undefined);
        }
      }
      if (auditEntityIds.length > 0) {
        await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.entityId, auditEntityIds)).catch(() => undefined);
      }
      await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.userId, userIds)).catch(() => undefined);
      await db.delete(schema.deadLetterEvents).where(inArray(schema.deadLetterEvents.id, dlqIds)).catch(() => undefined);
      await db.delete(schema.outboxEvents).where(inArray(schema.outboxEvents.id, outboxEventIds)).catch(() => undefined);
      if (messageIds.length > 0) {
        await db.delete(schema.outboundDeliveries).where(inArray(schema.outboundDeliveries.internalMessageId, messageIds)).catch(() => undefined);
      }
      await db.delete(schema.mediaAssets).where(inArray(schema.mediaAssets.id, mediaAssetIds)).catch(() => undefined);
      await db.delete(schema.internalNotes).where(inArray(schema.internalNotes.id, noteIds)).catch(() => undefined);
      await db.delete(schema.messages).where(inArray(schema.messages.id, messageIds)).catch(() => undefined);
      await db.delete(schema.conversationStatusHistory).where(inArray(schema.conversationStatusHistory.conversationId, conversationIds)).catch(() => undefined);
      await db.delete(schema.conversations).where(inArray(schema.conversations.id, conversationIds)).catch(() => undefined);
      await db.delete(schema.contactSectors).where(inArray(schema.contactSectors.contactId, contactIds)).catch(() => undefined);
      await db.delete(schema.contacts).where(inArray(schema.contacts.id, contactIds)).catch(() => undefined);
      await db.delete(schema.sessions).where(inArray(schema.sessions.userId, userIds)).catch(() => undefined);
      await db.delete(schema.userSectors).where(inArray(schema.userSectors.userId, userIds)).catch(() => undefined);
      await db.delete(schema.userRoles).where(inArray(schema.userRoles.userId, userIds)).catch(() => undefined);
      await db.delete(schema.users).where(inArray(schema.users.id, userIds)).catch(() => undefined);
      await db.delete(schema.sectors).where(inArray(schema.sectors.id, sectorIds)).catch(() => undefined);
      // Tutores/pacientes criados com os contatos (sem cascade).
      const tutorIds = contactFixtures.map((c) => c.tutorId).filter((v): v is string => Boolean(v));
      const patientIds = contactFixtures.map((c) => c.patientId).filter((v): v is string => Boolean(v));
      if (patientIds.length > 0) await db.delete(schema.patients).where(inArray(schema.patients.id, patientIds)).catch(() => undefined);
      if (tutorIds.length > 0) await db.delete(schema.tutors).where(inArray(schema.tutors.id, tutorIds)).catch(() => undefined);
      for (const key of objectKeys) await storage.delete(key).catch(() => undefined);
      await app.close();
    }
    for (const [key, value] of envSnapshot) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function resetPrivacyEnv() {
    delete process.env.PRIVACY_OPERATION_MODE;
    delete process.env.PRIVACY_APPROVED_PSEUDONYMIZE_TYPES;
    delete process.env.PRIVACY_APPROVED_DELETE_TYPES;
    delete process.env.PRIVACY_ALLOW_IRREVERSIBLE_DELETE;
    delete process.env.PRIVACY_POLICY_VERSION;
  }

  function enableExecutePolicy(options: { deleteMedia?: boolean } = {}) {
    process.env.PRIVACY_OPERATION_MODE = 'execute';
    process.env.PRIVACY_APPROVED_PSEUDONYMIZE_TYPES = 'contact,tutor-link,conversation,message,note,outbox,dlq,media-asset,audit';
    process.env.PRIVACY_POLICY_VERSION = 'test-d02-approved-v1';
    if (options.deleteMedia) {
      process.env.PRIVACY_APPROVED_DELETE_TYPES = 'media-asset';
      process.env.PRIVACY_ALLOW_IRREVERSIBLE_DELETE = 'true';
    } else {
      delete process.env.PRIVACY_APPROVED_DELETE_TYPES;
      delete process.env.PRIVACY_ALLOW_IRREVERSIBLE_DELETE;
    }
  }

  it('inventário cobre contato/conversa/mensagem/nota/outbox/DLQ/mídia/audit/backup/tutores sem expor PII', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/privacy/contacts/${contactMain.id}/inventory`,
      headers: auth(admin),
    });
    expect(response.statusCode).toBe(200);
    const inventory = response.json() as {
      sections: Array<{ copy: string; count: number; inScopeCount: number; outOfScopeCount: number; observed?: boolean }>;
      totals: { copies: number };
      policy: { mode: string };
    };
    const byCopy = new Map(inventory.sections.map((section) => [section.copy, section]));
    for (const copy of ['contact', 'tutor-link', 'conversation', 'message', 'note', 'outbox', 'dlq', 'media-asset', 'audit', 'backup']) {
      expect(byCopy.get(copy), `seção ${copy} ausente`).toBeTruthy();
    }
    expect(byCopy.get('contact')!.count).toBe(1);
    expect(byCopy.get('tutor-link')!.count).toBeGreaterThanOrEqual(1);
    expect(byCopy.get('conversation')!.inScopeCount).toBe(2);
    expect(byCopy.get('message')!.inScopeCount).toBe(3);
    expect(byCopy.get('note')!.inScopeCount).toBe(1);
    expect(byCopy.get('outbox')!.inScopeCount).toBe(1);
    expect(byCopy.get('dlq')!.inScopeCount).toBe(1);
    expect(byCopy.get('media-asset')!.inScopeCount).toBe(1);
    expect(byCopy.get('audit')!.inScopeCount).toBeGreaterThanOrEqual(1);
    expect(byCopy.get('backup')!.observed).toBe(false);
    expect(inventory.policy.mode).toBe('dry-run');

    const serialized = JSON.stringify(inventory);
    expect(serialized).not.toContain(contactMain.phone);
    expect(serialized).not.toContain(contactMain.name);
    expect(serialized).not.toContain(contactMain.email);

    // Escopo do Manager A: só o setor A aparece; B fica contado como fora.
    const scoped = await app.inject({
      method: 'GET',
      url: `/privacy/contacts/${contactMain.id}/inventory`,
      headers: auth(managerA),
    });
    expect(scoped.statusCode).toBe(200);
    const scopedInventory = scoped.json() as {
      sections: Array<{ copy: string; inScopeCount: number; outOfScopeCount: number }>;
    };
    const scopedByCopy = new Map(scopedInventory.sections.map((section) => [section.copy, section]));
    expect(scopedByCopy.get('conversation')!.inScopeCount).toBe(1);
    expect(scopedByCopy.get('conversation')!.outOfScopeCount).toBe(1);
    expect(scopedByCopy.get('message')!.outOfScopeCount).toBe(1);
    expect(JSON.stringify(scopedInventory)).not.toContain('B SECRETO');

    // A tabela de operações (checkpoint) existe no candidato.
    const reg = await db.execute(sql`SELECT to_regclass('public.privacy_operations') AS reg`);
    const regRows = (reg as unknown as { rows: Array<{ reg: string | null }> }).rows ?? [];
    expect(regRows[0]?.reg).toBe('privacy_operations');
  });

  it('exportação autorizada não atravessa setor e omite cópias fora do escopo', async () => {
    const scoped = await app.inject({
      method: 'GET',
      url: `/privacy/contacts/${contactMain.id}/export?reason=aaa17-scope&scope=authorized`,
      headers: auth(managerA),
    });
    expect(scoped.statusCode).toBe(200);
    const body = scoped.json() as {
      conversations: Array<{ id: string; sectorId: string }>;
      messages: Array<{ conversationId: string }>;
      notes: Array<{ conversationId: string }>;
      omitted: { conversations: number; messages: number };
      scope: { mode: string; sectorIds: string[] };
      partial: boolean;
      fullErasureClaimed: boolean;
    };
    expect(body.conversations).toHaveLength(1);
    expect(body.conversations[0].id).toBe(convMainA);
    for (const message of body.messages) expect(message.conversationId).toBe(convMainA);
    for (const note of body.notes) expect(note.conversationId).toBe(convMainA);
    expect(body.omitted.conversations).toBe(1);
    expect(body.omitted.messages).toBe(1);
    expect(body.scope.mode).toBe('sectors');
    expect(body.scope.sectorIds).toContain(sectorA);
    expect(body.scope.sectorIds).not.toContain(sectorB);
    expect(body.partial).toBe(true);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('B SECRETO');

    // Contato exclusivo do setor B: negado sem revelar conteúdo.
    const denied = await app.inject({
      method: 'GET',
      url: `/privacy/contacts/${contactBOnly.id}/export?reason=aaa17-scope&scope=authorized`,
      headers: auth(managerA),
    });
    expect(denied.statusCode).toBe(404);
    expect(denied.body).not.toContain(contactBOnly.phone);

    // Export integral do Admin permanece compatível (2 conversas).
    const full = await app.inject({
      method: 'GET',
      url: `/privacy/contacts/${contactMain.id}/export?reason=aaa17-full`,
      headers: auth(admin),
    });
    expect(full.statusCode).toBe(200);
    expect((full.json() as { conversations: unknown[] }).conversations).toHaveLength(2);

    // Serviço de operação também respeita o escopo (não só a rota).
    const privacy = await appService();
    const outOfScope = await privacy.runContactErasure({
      contactId: contactBOnly.id,
      actor: { userId: managerA.id, reason: 'aaa17-scope' },
      scope: { all: false, sectorIds: [sectorA] },
      requestId: `scope-denied-${Date.now()}`,
    });
    expect(outOfScope.ok).toBe(false);
    if (!outOfScope.ok) expect(outOfScope.reason).toBe('out_of_scope');
  });

  it('default seguro: planejamento dry-run não muta nenhuma cópia', async () => {
    resetPrivacyEnv();
    const privacy = await appService();

    const scanBefore = await privacy.scanResidualIdentifiers(contactErase.id, identifiers(contactErase));
    expect(scanBefore.length).toBeGreaterThan(0);

    const dryRequestId = `dry-${Date.now()}`;
    const response = await app.inject({
      method: 'POST',
      url: `/privacy/contacts/${contactErase.id}/erasure`,
      headers: auth(admin),
      payload: { reason: 'aaa17-dry-run', requestId: dryRequestId },
    });
    expect(response.statusCode).toBe(200);
    const report = response.json() as {
      operationId: string;
      mode: string;
      status: string;
      result: string;
      mutatedCopies: number;
      partial: boolean;
      fullErasureClaimed: boolean;
      steps: Array<{ copy: string; action: string; affected: number; residual: string | null }>;
      residuals: Array<{ copy: string; reason: string }>;
    };
    expect(report.mode).toBe('dry-run');
    expect(report.status).toBe('planned');
    expect(report.result).toBe('planned-dry-run');
    expect(report.mutatedCopies).toBe(0);
    expect(report.partial).toBe(true);
    expect(report.fullErasureClaimed).toBe(false);
    const contactStep = report.steps.find((step) => step.copy === 'contact')!;
    expect(contactStep.action).toBe('planned');
    expect(contactStep.affected).toBe(1);
    const messageStep = report.steps.find((step) => step.copy === 'message')!;
    expect(messageStep.action).toBe('planned');
    expect(messageStep.affected).toBeGreaterThanOrEqual(1);
    expect(report.steps.find((step) => step.copy === 'backup')!.action).toBe('residual');
    expect(report.residuals.map((residual) => residual.copy)).toContain('backup');

    // Nenhuma cópia foi mutada.
    const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, contactErase.id));
    expect(contact.phone).toBe(contactErase.phone);
    expect(contact.name).toBe(contactErase.name);
    const [message] = await db.select().from(schema.messages).where(eq(schema.messages.id, msgEraseIn));
    expect(message.sender).toBe(contactErase.phone);
    expect(message.content).toContain(contactErase.name);
    const [note] = await db.select().from(schema.internalNotes).where(eq(schema.internalNotes.id, noteEraseId));
    expect(note.content).toContain(contactErase.name);
    const [outbox] = await db.select().from(schema.outboxEvents).where(eq(schema.outboxEvents.id, outboxEraseId));
    expect(outbox.payload).toContain(contactErase.phone);

    const persistedRows = await operationRows(dryRequestId);
    expect(persistedRows).toHaveLength(1);
    expect(persistedRows[0].status).toBe('planned');
    expect(persistedRows[0].mode).toBe('dry-run');
    expect(persistedRows[0].contact_id).toBe(contactErase.id);
  });

  it('política aprovada em configuração pseudonimiza cópias e reporta resultado PARCIAL', async () => {
    enableExecutePolicy();
    const privacy = await appService();
    const requestId = `exec-${Date.now()}`;
    const response = await app.inject({
      method: 'POST',
      url: `/privacy/contacts/${contactErase.id}/erasure`,
      headers: auth(admin),
      payload: { reason: 'aaa17-execute', requestId },
    });
    expect(response.statusCode).toBe(200);
    const report = response.json() as {
      operationId: string;
      mode: string;
      status: string;
      result: string;
      mutatedCopies: number;
      partial: boolean;
      fullErasureClaimed: boolean;
      steps: Array<{ copy: string; action: string; affected: number }>;
      residuals: Array<{ copy: string; reason: string }>;
    };
    expect(report.mode).toBe('execute');
    expect(report.status).toBe('partial');
    expect(report.result).toBe('partial-pseudonymization');
    expect(report.fullErasureClaimed).toBe(false);
    expect(report.partial).toBe(true);
    expect(report.mutatedCopies).toBeGreaterThanOrEqual(7);
    expect(report.steps.find((step) => step.copy === 'message')!.action).toBe('pseudonymized');
    expect(report.residuals.map((residual) => residual.copy)).toContain('backup');

    const markerLike = (value: string | null) => (value ?? '').includes('ANONYMIZED');
    const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, contactErase.id));
    expect(markerLike(contact.phone)).toBe(true);
    expect(contact.email).toBeNull();
    expect(contact.externalId).toBeNull();
    expect(contact.metadata).toBeNull();

    const messages = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, convErase));
    expect(messages.length).toBe(2);
    for (const message of messages) {
      expect(message.content).not.toContain(contactErase.phone);
      expect(message.content).not.toContain(contactErase.name);
      expect(message.content).not.toContain(contactErase.email);
      if (message.direction === 'inbound') expect(markerLike(message.sender)).toBe(true);
      if (message.direction === 'outbound') expect(markerLike(message.recipient)).toBe(true);
    }
    const [note] = await db.select().from(schema.internalNotes).where(eq(schema.internalNotes.id, noteEraseId));
    expect(note.content).not.toContain(contactErase.name);
    expect(note.content).not.toContain(contactErase.email);
    const [outbox] = await db.select().from(schema.outboxEvents).where(eq(schema.outboxEvents.id, outboxEraseId));
    expect(outbox.payload).not.toContain(contactErase.phone);
    expect(outbox.payload).not.toContain(contactErase.name);
    const [dlq] = await db.select().from(schema.deadLetterEvents).where(eq(schema.deadLetterEvents.id, dlqEraseId));
    const dlqSerialized = JSON.stringify(dlq.payload) + (dlq.errorMessage ?? '');
    expect(dlqSerialized).not.toContain(contactErase.phone);
    expect(dlqSerialized).not.toContain(contactErase.name);
    expect(dlqSerialized).not.toContain(contactErase.email);

    // Cópia na auditoria foi pseudonimizada preservando ação/ator.
    const seeded = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.id, auditEraseSeedId));
    expect(seeded).toHaveLength(1);
    expect(seeded[0].action).toBe('message.outbound.sent');
    expect(seeded[0].userId).toBe(admin.id);
    expect(serializeAudit(seeded as unknown as Array<Record<string, unknown>>)).not.toContain(contactErase.phone);
    expect(serializeAudit(seeded as unknown as Array<Record<string, unknown>>)).not.toContain(contactErase.name);

    // Teste de reidentificação residual sobre a fixture: nada reidentificável
    // no banco (backups e bytes de mídia são residuais declarados).
    const residualScan = await privacy.scanResidualIdentifiers(contactErase.id, identifiers(contactErase));
    expect(residualScan).toEqual([]);

    // Auditoria da operação é minimizada (sem PII) e referencia a política.
    const operationAudit = await db.select().from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, 'lgpd.pseudonymize'), eq(schema.auditLogs.entityId, contactErase.id)));
    expect(operationAudit.length).toBeGreaterThanOrEqual(1);
    const serializedAudit = JSON.stringify(operationAudit.map((row) => ({ oldValue: row.oldValue, newValue: row.newValue, metadata: row.metadata })));
    expect(serializedAudit).not.toContain(contactErase.phone);
    expect(serializedAudit).not.toContain(contactErase.name);
    expect(serializedAudit).not.toContain(contactErase.email);

    // Idempotência: repetir o mesmo requestId devolve o resultado original sem
    // nova mutação nem duplicação de operação.
    const [noteAfterFirst] = await db.select().from(schema.internalNotes).where(eq(schema.internalNotes.id, noteEraseId));
    const repeat = await app.inject({
      method: 'POST',
      url: `/privacy/contacts/${contactErase.id}/erasure`,
      headers: auth(admin),
      payload: { reason: 'aaa17-execute', requestId },
    });
    expect(repeat.statusCode).toBe(200);
    const repeatReport = repeat.json() as { deduplicated?: boolean; operationId: string };
    expect(repeatReport.deduplicated).toBe(true);
    expect(repeatReport.operationId).toBe(report.operationId);
    const [noteAfterRepeat] = await db.select().from(schema.internalNotes).where(eq(schema.internalNotes.id, noteEraseId));
    expect(noteAfterRepeat.content).toBe(noteAfterFirst.content);
    const ops = await operationRows(requestId);
    expect(ops).toHaveLength(1);
  });

  it('falha injetada deixa checkpoint e resume conclui sem repetir passos', async () => {
    enableExecutePolicy();
    const privacy = await appService();
    const requestId = `fault-${Date.now()}`;
    let failed = false;
    try {
      await privacy.runContactErasure({
        contactId: contactFault.id,
        actor: { userId: admin.id, reason: 'aaa17-resume' },
        scope: { all: true },
        requestId,
        faultAfterStep: 'outbox',
      });
    } catch (error) {
      failed = true;
      expect(String(error)).toContain('FAILURE_INJECTED');
    }
    expect(failed).toBe(true);

    const ops = await operationRows(requestId);
    expect(ops).toHaveLength(1);
    expect(ops[0].status).toBe('failed');
    expect(String(ops[0].last_error)).toContain('FAILURE_INJECTED');
    const failedReport = JSON.parse(String(ops[0].report)) as {
      status: string;
      checkpoint: number;
      steps: Array<{ copy: string; action: string }>;
    };
    expect(failedReport.status).toBe('failed');
    expect(failedReport.checkpoint).toBe(failedReport.steps.length);
    expect(failedReport.steps.find((step) => step.copy === 'outbox')!.action).toBe('pseudonymized');
    expect(failedReport.steps.some((step) => step.copy === 'dlq')).toBe(false);

    // Falha é auditada de forma minimizada.
    const failedAudit = await db.select().from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, 'lgpd.pseudonymize.failed'), eq(schema.auditLogs.entityId, contactFault.id)));
    expect(failedAudit.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(failedAudit.map((row) => row.metadata))).not.toContain(contactFault.phone);

    const resumed = await privacy.resumeContactErasure({
      operationId: String(ops[0].id),
      actor: { userId: admin.id, reason: 'aaa17-resume' },
      scope: { all: true },
    });
    expect(resumed.ok).toBe(true);
    if (resumed.ok) {
      const report = resumed.report as {
        status: string;
        partial: boolean;
        fullErasureClaimed: boolean;
        steps: Array<{ copy: string; action: string }>;
        residuals: Array<{ copy: string }>;
      };
      expect(report.status).toBe('partial');
      expect(report.partial).toBe(true);
      expect(report.fullErasureClaimed).toBe(false);
      expect(report.steps).toHaveLength(10);
      expect(new Set(report.steps.map((step) => step.copy)).size).toBe(10);
      expect(report.steps.find((step) => step.copy === 'dlq')!.action).toBe('pseudonymized');
      expect(report.steps.find((step) => step.copy === 'audit')!.action).toBe('pseudonymized');
      expect(report.residuals.map((residual) => residual.copy)).toContain('backup');
    }

    const [dlq] = await db.select().from(schema.deadLetterEvents).where(eq(schema.deadLetterEvents.id, dlqFaultId));
    expect(JSON.stringify(dlq.payload) + (dlq.errorMessage ?? '')).not.toContain(contactFault.phone);
    expect(JSON.stringify(dlq.payload) + (dlq.errorMessage ?? '')).not.toContain(contactFault.name);
    const faultSeed = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.id, auditFaultSeedId));
    expect(serializeAudit(faultSeed as unknown as Array<Record<string, unknown>>)).not.toContain(contactFault.phone);
    const [faultNote] = await db.select().from(schema.internalNotes).where(eq(schema.internalNotes.id, noteFaultId));
    expect(faultNote.content).not.toContain(contactFault.email);
    void outboxFaultEventId;

    // Operação não foi duplicada no resume.
    const opsAfter = await operationRows(requestId);
    expect(opsAfter).toHaveLength(1);
  });

  it('bytes de mídia só são apagados com flag irreversível explícita; default nunca apaga', async () => {
    enableExecutePolicy();
    const privacy = await appService();
    const requestIdSafe = `media-safe-${Date.now()}`;
    const safe = await app.inject({
      method: 'POST',
      url: `/privacy/contacts/${contactMedia.id}/erasure`,
      headers: auth(admin),
      payload: { reason: 'aaa17-media-safe', requestId: requestIdSafe },
    });
    expect(safe.statusCode).toBe(200);
    const safeReport = safe.json() as { residuals: Array<{ copy: string; reason: string }> };
    expect(await storage.exists(mediaKey)).toBe(true);
    expect(safeReport.residuals.some((residual) => residual.copy === 'media-asset')).toBe(true);
    const [assetSafe] = await db.select().from(schema.mediaAssets).where(eq(schema.mediaAssets.id, mediaAssetId));
    expect(assetSafe.storageStatus).toBe('STORED');
    expect(assetSafe.filename ?? '').not.toContain(contactMedia.name);

    enableExecutePolicy({ deleteMedia: true });
    const requestIdDelete = `media-delete-${Date.now()}`;
    const deleted = await app.inject({
      method: 'POST',
      url: `/privacy/contacts/${contactMedia.id}/erasure`,
      headers: auth(admin),
      payload: { reason: 'aaa17-media-delete', requestId: requestIdDelete },
    });
    expect(deleted.statusCode).toBe(200);
    const deleteReport = deleted.json() as { residuals: Array<{ copy: string }> };
    expect(await storage.exists(mediaKey)).toBe(false);
    const [assetDeleted] = await db.select().from(schema.mediaAssets).where(eq(schema.mediaAssets.id, mediaAssetId));
    expect(assetDeleted.storageStatus).toBe('DELETED');
    expect(deleteReport.residuals.some((residual) => residual.copy === 'media-asset')).toBe(false);
    void privacy;
    void outboxEraseEventId;
  });

  it('auditoria no caminho de escrita (chat/notas) não copia conteúdo nem destinatário', async () => {
    const content = `segredo operacional de ${contactComms.name}`;
    const send = await app.inject({
      method: 'POST',
      url: '/messages',
      headers: auth(writerA),
      payload: { conversationId: convComms, content, recipient: contactComms.phone },
    });
    expect(send.statusCode).toBe(201);
    const messageId = (send.json() as { messageId: string }).messageId;
    messageIds.push(messageId);

    const [outboundAudit] = await db.select().from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, 'message.outbound.sent'), eq(schema.auditLogs.entityId, messageId)));
    expect(outboundAudit).toBeTruthy();
    const outboundSerialized = JSON.stringify({ oldValue: outboundAudit.oldValue, newValue: outboundAudit.newValue, metadata: outboundAudit.metadata });
    expect(outboundSerialized).not.toContain(contactComms.phone);
    expect(outboundSerialized).not.toContain(contactComms.name);
    expect(outboundSerialized).not.toContain(content);

    const noteContent = `nota com ${contactComms.name} e ${contactComms.phone}`;
    const note = await app.inject({
      method: 'POST',
      url: '/notes',
      headers: auth(writerA),
      payload: { conversationId: convComms, content: noteContent },
    });
    expect(note.statusCode).toBe(201);
    const noteId = (note.json() as { id: string }).id;
    noteIds.push(noteId);
    const [noteAudit] = await db.select().from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, 'note.created'), eq(schema.auditLogs.entityId, noteId)));
    expect(noteAudit).toBeTruthy();
    const noteSerialized = JSON.stringify({ oldValue: noteAudit.oldValue, newValue: noteAudit.newValue, metadata: noteAudit.metadata });
    expect(noteSerialized).not.toContain(contactComms.name);
    expect(noteSerialized).not.toContain(contactComms.phone);
    expect(noteSerialized).not.toContain(noteContent);
  });
});
