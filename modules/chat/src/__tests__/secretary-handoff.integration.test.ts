import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { err, ok } from '@cvg/shared';

vi.mock('@cvg/integrations', () => ({
  getSecretaryClient: vi.fn(),
  initializeSecretaryClient: vi.fn(),
}));

import { getSecretaryClient } from '@cvg/integrations';
import { conversationRepository } from '../infrastructure/repositories/conversation.repository';
import { messageRepository } from '../infrastructure/repositories/message.repository';
import { processMessageWithSecretary } from '../application/use-cases/process-message-with-secretary.use-case';
import { receiveInboundMessage } from '../application/use-cases/receive-inbound-message.use-case';

const connectionString = process.env.DATABASE_URL || 'postgresql://connect_desk:root@localhost:5432/connect_desk_db';

let realDbAvailable = false;
let dbInitError = '';

async function probeRealDatabase(): Promise<boolean> {
  try {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString });
    const client = await pool.connect();
    await client.query('SELECT 1 FROM conversations LIMIT 1');
    client.release();
    await pool.end();
    return true;
  } catch (error) {
    dbInitError = error instanceof Error ? error.message : String(error);
    return false;
  }
}

async function cleanupConversationArtifacts(conversationId: string): Promise<void> {
  const events = await db
    .select({ eventId: schema.outboxEvents.eventId })
    .from(schema.outboxEvents)
    .where(eq(schema.outboxEvents.aggregateId, conversationId));

  for (const event of events) {
    await db.delete(schema.outboxConsumerAcks).where(eq(schema.outboxConsumerAcks.eventId, event.eventId));
  }

  await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.aggregateId, conversationId));
  await db.delete(schema.messages).where(eq(schema.messages.conversationId, conversationId));
  await db.delete(schema.conversationStatusHistory).where(eq(schema.conversationStatusHistory.conversationId, conversationId));
  await db.delete(schema.auditLogs).where(eq(schema.auditLogs.entityId, conversationId));
  await db.delete(schema.conversations).where(eq(schema.conversations.id, conversationId));
}

async function cleanupUserArtifacts(userId: string): Promise<void> {
  await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, userId));
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
  await db.delete(schema.users).where(eq(schema.users.id, userId));
}

function collectEventCounts(events: Array<{ eventType: string }>) {
  return events.reduce<Record<string, number>>((acc, event) => {
    acc[event.eventType] = (acc[event.eventType] || 0) + 1;
    return acc;
  }, {});
}

function parsePayload<T extends { status?: string; completedAt?: string; reason?: string }>(payload: unknown): T {
  return typeof payload === 'string' ? JSON.parse(payload) as T : payload as T;
}

function setSecretarySuccessResponse(response: unknown) {
  const client = {
    invoke: vi.fn().mockResolvedValue(ok(response)),
    checkHealth: vi.fn().mockResolvedValue(ok(true)),
  };
  vi.mocked(getSecretaryClient).mockReturnValue(client as any);
  return client;
}

function setSecretaryFailureResponse(message: string) {
  const client = {
    invoke: vi.fn().mockResolvedValue(err(new Error(message))),
    checkHealth: vi.fn().mockResolvedValue(ok(false)),
  };
  vi.mocked(getSecretaryClient).mockReturnValue(client as any);
  return client;
}

if (await probeRealDatabase()) {
  describe('Secretary + handoff integration', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('processMessageWithSecretary classifica sem handoff e preserva o fluxo', async () => {
      const conversationId = randomUUID();
      const messageId = randomUUID();

      setSecretarySuccessResponse({
        success: true,
        response: 'Pode seguir com orientações',
        action: 'respond',
        classification: {
          category: 'commercial',
          priority: 'medium',
          confidence: 0.91,
        },
        metadata: {
          model: 'secretary-v1',
        },
      });

      try {
        await conversationRepository.create({
          id: conversationId,
          currentHandler: 'bot',
          status: 'open',
          statusV2: 'novo',
          isActive: true,
          externalChannelId: 'whatsapp',
        });

        await messageRepository.create({
          conversationId,
          direction: 'inbound',
          content: 'Oi, tudo bem?',
          sender: '+5511988000001',
          externalMessageId: `${conversationId}-msg-1`,
          sentAt: new Date(),
          status: 'sent',
        });

        await messageRepository.create({
          conversationId,
          direction: 'outbound',
          content: 'Tudo bem, como posso ajudar?',
          sender: 'bot',
          externalMessageId: `${conversationId}-msg-2`,
          sentAt: new Date(),
          status: 'sent',
        });

        const result = await processMessageWithSecretary({
          conversationId,
          messageId,
          content: 'Cliente quer confirmar o horário da consulta',
          sender: '+5511988000001',
        });

        expect(result.isOk()).toBe(true);
        expect(result.value).toMatchObject({
          classified: true,
          handoffTriggered: false,
          classification: {
            category: 'commercial',
            priority: 'medium',
            confidence: 0.91,
          },
          secretaryResponse: 'Pode seguir com orientações',
        });

        const events = await db
          .select()
          .from(schema.outboxEvents)
          .where(eq(schema.outboxEvents.aggregateId, conversationId))
          .orderBy(asc(schema.outboxEvents.createdAt));

        const counts = collectEventCounts(events.map((event) => ({ eventType: event.eventType })));
        expect(counts['secretary.invocation']).toBe(2);
        expect(counts['handoff.requested'] || 0).toBe(0);
        expect(counts['handoff.completed'] || 0).toBe(0);

        const secretaryStatuses = events
          .filter((event) => event.eventType === 'secretary.invocation')
          .map((event) => parsePayload<{ status: string }>(event.payload).status);

        expect(secretaryStatuses).toEqual(['requested', 'success']);

        const conversation = await conversationRepository.findById(conversationId);
        expect(conversation?.currentHandler).toBe('bot');
      } finally {
        await cleanupConversationArtifacts(conversationId);
      }
    });

    it('processMessageWithSecretary dispara handoff e publica eventos quando a Secretary pede humano', async () => {
      const conversationId = randomUUID();
      const messageId = randomUUID();

      setSecretarySuccessResponse({
        success: true,
        response: 'Transferindo para humano',
        action: 'handoff',
        classification: {
          category: 'urgent',
          priority: 'urgent',
          confidence: 0.98,
        },
        handoffReason: 'Caso urgente precisa de triagem humana',
        metadata: {
          source: 'integration-test',
        },
      });

      try {
        await conversationRepository.create({
          id: conversationId,
          currentHandler: 'bot',
          status: 'open',
          statusV2: 'novo',
          isActive: true,
          externalChannelId: 'whatsapp',
        });

        await messageRepository.create({
          conversationId,
          direction: 'inbound',
          content: 'Sintoma urgente',
          sender: '+5511988000002',
          externalMessageId: `${conversationId}-msg-urgent`,
          sentAt: new Date(),
          status: 'sent',
        });

        const result = await processMessageWithSecretary({
          conversationId,
          messageId,
          content: 'Sintoma urgente',
          sender: '+5511988000002',
        });

        expect(result.isOk()).toBe(true);
        expect(result.value).toMatchObject({
          classified: true,
          handoffTriggered: true,
          classification: {
            category: 'urgent',
            priority: 'urgent',
            confidence: 0.98,
          },
          secretaryResponse: 'Transferindo para humano',
        });

        const events = await db
          .select()
          .from(schema.outboxEvents)
          .where(eq(schema.outboxEvents.aggregateId, conversationId))
          .orderBy(asc(schema.outboxEvents.createdAt));

        const counts = collectEventCounts(events.map((event) => ({ eventType: event.eventType })));
        expect(counts['secretary.invocation']).toBe(2);
        expect(counts['handoff.requested']).toBe(1);
        expect(counts['handoff.completed']).toBe(1);

        const handoffRequested = events.find((event) => event.eventType === 'handoff.requested');
        const handoffCompleted = events.find((event) => event.eventType === 'handoff.completed');

        expect(handoffRequested).toBeDefined();
        expect(parsePayload(handoffRequested?.payload).reason).toBe('Caso urgente precisa de triagem humana');
        expect(handoffCompleted).toBeDefined();
        expect(parsePayload(handoffCompleted?.payload).completedAt).toEqual(expect.any(String));

        const conversation = await conversationRepository.findById(conversationId);
        expect(conversation?.currentHandler).toBe('bot');
      } finally {
        await cleanupConversationArtifacts(conversationId);
      }
    });

    it('processMessageWithSecretary não dispara handoff redundante quando a conversa já está com humano', async () => {
      const conversationId = randomUUID();
      const messageId = randomUUID();

      setSecretarySuccessResponse({
        success: true,
        response: 'Handoff sugerido',
        action: 'handoff',
        classification: {
          category: 'urgent',
          priority: 'urgent',
          confidence: 0.97,
        },
        handoffReason: 'Precisa humano, mas a conversa já está em humano',
      });

      try {
        await conversationRepository.create({
          id: conversationId,
          currentHandler: 'human',
          status: 'open',
          statusV2: 'novo',
          isActive: true,
          externalChannelId: 'whatsapp',
        });

        await messageRepository.create({
          conversationId,
          direction: 'inbound',
          content: 'Mensagem em conversa humana',
          sender: '+5511988000003',
          externalMessageId: `${conversationId}-msg-human`,
          sentAt: new Date(),
          status: 'sent',
        });

        const result = await processMessageWithSecretary({
          conversationId,
          messageId,
          content: 'Mensagem em conversa humana',
          sender: '+5511988000003',
        });

        expect(result.isOk()).toBe(true);
        expect(result.value.handoffTriggered).toBe(false);

        const events = await db
          .select()
          .from(schema.outboxEvents)
          .where(eq(schema.outboxEvents.aggregateId, conversationId));

        const counts = collectEventCounts(events.map((event) => ({ eventType: event.eventType })));
        expect(counts['secretary.invocation']).toBe(2);
        expect(counts['handoff.requested'] || 0).toBe(0);
        expect(counts['handoff.completed'] || 0).toBe(0);
      } finally {
        await cleanupConversationArtifacts(conversationId);
      }
    });

    it('receiveInboundMessage persiste, audita e dispara handoff uma única vez', async () => {
      const conversationId = randomUUID();
      const externalConversationId = `${conversationId}.external`;
      const externalMessageId = `${conversationId}.message`;
      const userId = randomUUID();

      setSecretarySuccessResponse({
        success: true,
        response: 'Transferindo para humano',
        action: 'handoff',
        classification: {
          category: 'urgent',
          priority: 'urgent',
          confidence: 0.99,
        },
        handoffReason: 'Handoff bot -> humano confirmado',
      });

      try {
        await db.insert(schema.users).values({
          id: userId,
          name: 'Secretary Handoff User',
          email: `secretary.handoff.${Date.now()}@example.com`,
          passwordHash: '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6',
          isActive: true,
        });

        const result = await receiveInboundMessage({
          externalMessageId,
          externalConversationId,
          content: 'Tenho uma urgência com meu pet',
          sender: '+5511988000004',
          senderType: 'contact',
          contactPhone: '+5511988000004',
          contactName: 'Tutor Teste',
          sentAt: new Date(),
          userId,
        });

        expect(result.isOk()).toBe(true);
        expect(result.value).toMatchObject({
          conversationId: expect.any(String),
          messageId: expect.any(String),
          isNewConversation: true,
        });

        const conversation = await conversationRepository.findByExternalId(externalConversationId);
        expect(conversation).not.toBeNull();
        expect(conversation?.currentHandler).toBe('human');

        const storedMessage = await messageRepository.findByExternalId(externalMessageId);
        expect(storedMessage).not.toBeNull();
        expect(storedMessage?.content).toBe('Tenho uma urgência com meu pet');

        const auditLogs = await db
          .select()
          .from(schema.auditLogs)
          .where(and(eq(schema.auditLogs.entityType, 'conversation'), eq(schema.auditLogs.entityId, conversation?.id ?? '')));

        const handoffAudit = auditLogs.find((entry) => entry.action === 'conversation.handoff');
        expect(handoffAudit).toBeDefined();
        expect(handoffAudit?.userId).toBe(userId);
        expect(handoffAudit?.metadata).toContain('Secretary requested handoff');

        const events = await db
          .select()
          .from(schema.outboxEvents)
          .where(eq(schema.outboxEvents.aggregateId, conversation!.id))
          .orderBy(asc(schema.outboxEvents.createdAt));

        const counts = collectEventCounts(events.map((event) => ({ eventType: event.eventType })));
        expect(counts['conversation.created']).toBe(1);
        expect(counts['secretary.invocation']).toBe(2);
        expect(counts['handoff.requested']).toBe(1);
        expect(counts['handoff.completed']).toBe(1);

        const messageEvents = await db
          .select()
          .from(schema.outboxEvents)
          .where(eq(schema.outboxEvents.eventType, 'message.persisted'));

        const messagePersistedForConversation = messageEvents.filter((event) => parsePayload<{ conversationId: string }>(event.payload).conversationId === conversation!.id);
        expect(messagePersistedForConversation).toHaveLength(1);
      } finally {
        await cleanupConversationArtifacts(conversationId);
        await cleanupUserArtifacts(userId);
      }
    });

    it('receiveInboundMessage continua operando quando a Secretary falha', async () => {
      const conversationId = randomUUID();
      const externalConversationId = `${conversationId}.failure.external`;
      const externalMessageId = `${conversationId}.failure.message`;

      setSecretaryFailureResponse('Secretary unavailable');

      try {
        const result = await receiveInboundMessage({
          externalMessageId,
          externalConversationId,
          content: 'Mensagem que vai cair no fallback',
          sender: '+5511988000005',
          senderType: 'contact',
          sentAt: new Date(),
        });

        expect(result.isOk()).toBe(true);

        const conversation = await conversationRepository.findByExternalId(externalConversationId);
        expect(conversation).not.toBeNull();
        expect(conversation?.currentHandler).toBe('bot');

        const events = await db
          .select()
          .from(schema.outboxEvents)
          .where(eq(schema.outboxEvents.aggregateId, conversation!.id));

        const counts = collectEventCounts(events.map((event) => ({ eventType: event.eventType })));
        expect(counts['secretary.invocation']).toBe(2);
        expect(counts['handoff.requested'] || 0).toBe(0);
        expect(counts['handoff.completed'] || 0).toBe(0);
      } finally {
        await cleanupConversationArtifacts(conversationId);
      }
    });
  });
} else {
  describe('Secretary + handoff integration', () => {
    it('skips the behavioral suite when PostgreSQL is unavailable', () => {
      expect(dbInitError).toBeDefined();
    });
  });
}

afterAll(() => {
  vi.clearAllMocks();
});
