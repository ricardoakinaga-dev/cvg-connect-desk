/**
 * AAA-02 — comportamento das portas C02 v1.0.1 em PostgreSQL isolado.
 *
 * Sem fallback de banco: exige DATABASE_URL do ambiente isolado do run
 * (aaa-20260912-a2 / 56442). Sem DATABASE_URL a suíte é marcada como skip
 * (não usa banco de desenvolvimento).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { createChatPorts } from '../application/ports/chat-ports';
import { resetGatewayOutboundPort, setGatewayOutboundPort } from '../application/ports/gateway-outbound-registry';
import { sendOutboundMessage } from '../application/use-cases/send-outbound-message.use-case';
import { conversationRepository } from '../infrastructure/repositories/conversation.repository';
import { messageRepository } from '../infrastructure/repositories/message.repository';
import type { GatewayOutboundPort } from '@cvg/messaging-contracts';

vi.mock('../events/chat-publisher', () => ({
  publishMessagePersisted: vi.fn().mockResolvedValue(undefined),
  publishConversationCreated: vi.fn().mockResolvedValue(undefined),
  publishConversationStatusChanged: vi.fn().mockResolvedValue(undefined),
}));

const hasIsolatedDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasIsolatedDb)('chat ports (C02) — comportamento em PostgreSQL isolado', () => {
  const prefix = `aaa02-ports-${Date.now()}`;
  const phone = '+5511900000042';
  const ports = createChatPorts();
  let conversationId = '';

  beforeAll(async () => {
    const conversation = await conversationRepository.create({
      externalConversationId: `${prefix}-conv`,
      externalChannelId: 'whatsapp',
      status: 'open',
      isActive: true,
    });
    conversationId = conversation.id;
  });

  afterAll(async () => {
    if (conversationId) {
      const events = await db
        .select({ eventId: schema.outboxEvents.eventId })
        .from(schema.outboxEvents)
        .where(eq(schema.outboxEvents.aggregateId, conversationId));
      for (const event of events) {
        await db.delete(schema.outboxConsumerAcks).where(eq(schema.outboxConsumerAcks.eventId, event.eventId));
      }
      await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.aggregateId, conversationId));
      // AAA-12: todo outbound agora tem mapping em outbound_deliveries.
      const outboundIds = await db
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, conversationId));
      if (outboundIds.length > 0) {
        await db
          .delete(schema.outboundDeliveries)
          .where(inArray(schema.outboundDeliveries.internalMessageId, outboundIds.map((m) => m.id)));
      }
      await db.delete(schema.messages).where(eq(schema.messages.conversationId, conversationId));
      // AAA-12: tombstones criados pelo trigger sobrevivem à exclusão — limpos aqui.
      await db
        .delete(schema.outboundIdempotencyTombstones)
        .where(eq(schema.outboundIdempotencyTombstones.scopeConversationId, conversationId));
      await db.delete(schema.conversationStatusHistory).where(eq(schema.conversationStatusHistory.conversationId, conversationId));
      await db.delete(schema.conversations).where(eq(schema.conversations.id, conversationId));
    }
    await db.delete(schema.contacts).where(eq(schema.contacts.externalId, `whatsapp:${phone.replace(/\D/g, '')}`));
    resetGatewayOutboundPort();
  });

  it('inbound.submit persiste via receiveInboundMessage e é idempotente', async () => {
    const input = {
      externalMessageId: `${prefix}-in-1`,
      externalConversationId: `${prefix}-conv`,
      content: 'ola porta inbound',
      sender: phone,
      senderType: 'contact' as const,
      contactPhone: phone,
      sentAt: new Date(),
    };

    const first = await ports.inbound.submit(input);
    const second = await ports.inbound.submit(input);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.messageId).toBe(first.value.messageId);
      expect(second.value.isNewConversation).toBe(false);
    }
    const stored = await messageRepository.findByExternalId(`${prefix}-in-1`);
    expect(stored?.conversationId).toBe(conversationId);
  });

  it('messageStatus.applyReceipt atualiza por externalMessageId com status mapeado', async () => {
    const result = await ports.messageStatus.applyReceipt({
      externalMessageId: `${prefix}-in-1`,
      status: 'read',
      statusAt: new Date(),
    });

    expect(result.updated).toBe(true);
    const stored = await messageRepository.findByExternalId(`${prefix}-in-1`);
    expect(stored?.status).toBe('delivered');
  });

  it('confirmation.markOutboundSent grava sent + externalMessageId por id interno', async () => {
    const outbound = await messageRepository.create({
      conversationId,
      direction: 'outbound',
      senderType: 'human',
      content: 'pendente de confirmação',
      recipient: phone,
      status: 'pending',
    });

    const result = await ports.confirmation.markOutboundSent({
      internalMessageId: outbound.id,
      externalMessageId: `${prefix}-ext-1`,
    });

    expect(result.updated).toBe(true);
    const stored = await messageRepository.findById(outbound.id);
    expect(stored?.status).toBe('sent');
    expect(stored?.externalMessageId).toBe(`${prefix}-ext-1`);
  });

  it('messageRead.listPendingOutbound devolve pendentes via porta', async () => {
    const pending = await messageRepository.create({
      conversationId,
      direction: 'outbound',
      senderType: 'human',
      content: 'ainda pendente',
      recipient: phone,
      status: 'pending',
    });

    const list = await ports.messageRead.listPendingOutbound(50);
    expect(list.some((message) => message.id === pending.id)).toBe(true);
  });

  it('sendOutboundMessage usa a GatewayOutboundPort injetada e reconcilia status', async () => {
    const calls: Array<{ messageId: string; externalPhone: string }> = [];
    const stub: GatewayOutboundPort = {
      async sendOutbound(request) {
        calls.push({ messageId: request.messageId, externalPhone: request.externalPhone });
        return { success: true, messageId: `${prefix}-provider-1` };
      },
    };

    setGatewayOutboundPort(stub);
    const result = await sendOutboundMessage({
      conversationId,
      content: 'ola gateway via porta',
      recipient: phone,
      senderType: 'human',
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value.status).toBe('sent');
    expect(calls).toHaveLength(1);
    expect(calls[0].messageId).toBe(result.value.messageId);

    const stored = await messageRepository.findById(result.value.messageId);
    expect(stored?.status).toBe('sent');
    expect(stored?.externalMessageId).toBe(`${prefix}-provider-1`);
  });

  it('sem GatewayOutboundPort injetada, o envio falha alto (err explícito)', async () => {
    resetGatewayOutboundPort();

    const result = await sendOutboundMessage({
      conversationId,
      content: 'sem porta injetada',
      recipient: phone,
      senderType: 'human',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(String(result.error.message)).toContain('GatewayOutboundPort nao injetada');
    }
  });
});
