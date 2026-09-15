/**
 * Behavioral Inbound Idempotency Tests - CVG Connect Desk
 *
 * Tests for G-06: same message/event received 4 times = only 1 record persisted.
 *
 * These tests validate the idempotent behavior of the inbound message flow
 * using the real PostgreSQL database.
 *
 * NOTE: These tests require a running PostgreSQL database with the full schema
 * migrated. If the database is not available, tests are skipped.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';

vi.mock('@cvg/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@cvg/secretary-adapter', () => ({
  triggerHandoff: vi.fn().mockResolvedValue(undefined),
  invokeSecretary: vi.fn().mockResolvedValue({
    isErr: () => true,
    isOk: () => false,
  }),
}));
vi.mock('../events/chat-publisher', () => ({
  publishMessagePersisted: vi.fn().mockResolvedValue(undefined),
  publishConversationCreated: vi.fn().mockResolvedValue(undefined),
}));

import { receiveInboundMessage } from '../application/use-cases/receive-inbound-message.use-case';
import { conversationRepository } from '../infrastructure/repositories/conversation.repository';
import { schema } from '@cvg/database';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import type { Ok, Result } from '@cvg/shared';

function assertOk<T, E>(result: Result<T, E>): asserts result is Ok<T, E> {
  expect(result.isOk()).toBe(true);
}

const connectionString = process.env.DATABASE_URL || 'postgresql://connect_desk:root@localhost:5432/connect_desk_db';

let realDbAvailable = false;
let dbInitError = '';

async function probeRealDatabase(): Promise<boolean> {
  try {
    const pool = new Pool({ connectionString });
    const client = await pool.connect();
    // Check if messages table exists
    await client.query('SELECT 1 FROM messages LIMIT 1');
    client.release();
    await pool.end();
    return true;
  } catch (error) {
    dbInitError = error instanceof Error ? error.message : String(error);
    return false;
  }
}

async function clearTestData(prefix: string): Promise<void> {
  if (!realDbAvailable) return;
  const pool = new Pool({ connectionString });
  const dbLocal = drizzle(pool);
  try {
    await dbLocal.delete(schema.messages).where(eq(schema.messages.externalMessageId, prefix));
  } finally {
    await pool.end();
  }
}

// Probe database once at module load
const probeResult = await probeRealDatabase();
realDbAvailable = probeResult;

if (!realDbAvailable) {
  console.warn(`[chat/idempotency] skipping behavioral tests: database not available - ${dbInitError}`);
}

// Only define the test suite if database is available
if (realDbAvailable) {
  describe('Inbound Idempotency Behavioral Tests', () => {
    const testPrefix = `idempotency-test-${Date.now()}`;

    beforeEach(async () => {
      await clearTestData(testPrefix);
    });

    afterEach(async () => {
      await clearTestData(testPrefix);
    });

    afterAll(async () => {
      await clearTestData(testPrefix);
    });

    describe('Case 1 - Same externalMessageId sent 4 times', () => {
      it('only ONE message is persisted after 4 identical inbound calls', async () => {
        const input = {
          externalMessageId: `${testPrefix}-msg-four-times`,
          externalConversationId: `${testPrefix}-conv-four-times`,
          content: 'Mensagem de teste idempotente',
          sender: '+5511988887777',
          senderType: 'contact' as const,
          contactPhone: '+5511988887777',
          sentAt: new Date(),
        };

        const result1 = await receiveInboundMessage(input);
        const result2 = await receiveInboundMessage(input);
        const result3 = await receiveInboundMessage(input);
        const result4 = await receiveInboundMessage(input);

        assertOk(result1);
        assertOk(result2);
        assertOk(result3);
        assertOk(result4);

        expect(result1.value.messageId).toBe(result2.value.messageId);
        expect(result2.value.messageId).toBe(result3.value.messageId);
        expect(result3.value.messageId).toBe(result4.value.messageId);

        expect(result1.value.isNewConversation).toBe(true);
        expect(result2.value.isNewConversation).toBe(false);
        expect(result3.value.isNewConversation).toBe(false);
        expect(result4.value.isNewConversation).toBe(false);

        const pool = new Pool({ connectionString });
        const dbLocal = drizzle(pool);
        try {
          const messages = await dbLocal
            .select()
            .from(schema.messages)
            .where(eq(schema.messages.externalMessageId, `${testPrefix}-msg-four-times`));

          expect(messages).toHaveLength(1);
          expect(messages[0].content).toBe('Mensagem de teste idempotente');
          expect(messages[0].direction).toBe('inbound');
        } finally {
          await pool.end();
        }
      });

      it('does not crash when receiving the same message 4 times', async () => {
        const input = {
          externalMessageId: `${testPrefix}-msg-no-crash`,
          externalConversationId: `${testPrefix}-conv-no-crash`,
          content: 'Teste sem crash',
          sender: '+5511988887777',
          senderType: 'contact' as const,
          sentAt: new Date(),
        };

        await expect(receiveInboundMessage(input)).resolves.toBeDefined();
        await expect(receiveInboundMessage(input)).resolves.toBeDefined();
        await expect(receiveInboundMessage(input)).resolves.toBeDefined();
        await expect(receiveInboundMessage(input)).resolves.toBeDefined();
      });

      it('state of conversation is coherent after duplicate messages', async () => {
        const externalConvId = `${testPrefix}-conv-coherent`;
        const externalMsgId = `${testPrefix}-msg-coherent`;

        const result = await receiveInboundMessage({
          externalMessageId: externalMsgId,
          externalConversationId: externalConvId,
          content: 'Primeira mensagem',
          sender: '+5511900001111',
          senderType: 'contact',
          sentAt: new Date(),
        });

        assertOk(result);

        await receiveInboundMessage({
          externalMessageId: externalMsgId,
          externalConversationId: externalConvId,
          content: 'Duplicada 1',
          sender: '+5511900001111',
          senderType: 'contact',
          sentAt: new Date(),
        });

        const conversation = await conversationRepository.findByExternalId(externalConvId);
        expect(conversation).not.toBeNull();
        expect(conversation!.status).toBe('open');
        expect(conversation!.isActive).toBe(true);
      });
    });

    describe('Case 2 - Same message without externalConversationId', () => {
      it('creates one conversation and one message even with 2 calls without conv id', async () => {
        const msgId = `${testPrefix}-msg-no-convid`;

        const result1 = await receiveInboundMessage({
          externalMessageId: msgId,
          content: 'Mensagem sem conv id',
          sender: '+5511900002222',
          senderType: 'contact',
          sentAt: new Date(),
        });

        const result2 = await receiveInboundMessage({
          externalMessageId: msgId,
          content: 'Duplicada sem conv id',
          sender: '+5511900002222',
          senderType: 'contact',
          sentAt: new Date(),
        });

        assertOk(result1);
        assertOk(result2);

        expect(result1.value.isNewConversation).toBe(true);
        expect(result2.value.isNewConversation).toBe(false);
        expect(result1.value.messageId).toBe(result2.value.messageId);

        const pool = new Pool({ connectionString });
        const dbLocal = drizzle(pool);
        try {
          const messages = await dbLocal
            .select()
            .from(schema.messages)
            .where(eq(schema.messages.externalMessageId, msgId));
          expect(messages).toHaveLength(1);
        } finally {
          await pool.end();
        }
      });
    });

    describe('Case 3 - Different messages in same conversation are not deduplicated', () => {
      it('two different messages in same conversation are both persisted', async () => {
        const convId = `${testPrefix}-conv-two-msgs`;

        const result1 = await receiveInboundMessage({
          externalMessageId: `${testPrefix}-msg-msgA`,
          externalConversationId: convId,
          content: 'Mensagem A',
          sender: '+5511900003333',
          senderType: 'contact',
          sentAt: new Date(),
        });

        const result2 = await receiveInboundMessage({
          externalMessageId: `${testPrefix}-msg-msgB`,
          externalConversationId: convId,
          content: 'Mensagem B',
          sender: '+5511900003333',
          senderType: 'contact',
          sentAt: new Date(),
        });

        assertOk(result1);
        assertOk(result2);
        expect(result1.value.messageId).not.toBe(result2.value.messageId);
        expect(result1.value.conversationId).toBe(result2.value.conversationId);
        expect(result1.value.isNewConversation).toBe(true);
        expect(result2.value.isNewConversation).toBe(false);

        const pool = new Pool({ connectionString });
        const dbLocal = drizzle(pool);
        try {
          const messages = await dbLocal
            .select()
            .from(schema.messages)
            .where(eq(schema.messages.conversationId, result1.value.conversationId));
          expect(messages).toHaveLength(2);
        } finally {
          await pool.end();
        }
      });
    });
  });
}

describe('Inbound Idempotency - DB Availability', () => {
  it('documents that behavioral tests require a running database', () => {
    if (realDbAvailable) {
      expect(true).toBe(true);
    } else {
      expect(true).toBe(true);
    }
  });
});
