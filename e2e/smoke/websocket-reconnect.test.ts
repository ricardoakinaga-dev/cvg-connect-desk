import { test, expect, type Page } from '@playwright/test';
import WebSocket from 'ws';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
const { db, schema } = await import('../../packages/database/src/index.ts');
import { loginAsAdmin, ADMIN_EMAIL } from './support.ts';


type RealtimeFrame = {
  event: string;
  data: {
    type?: string;
    payload?: {
      conversationId?: string;
      channel?: string;
      error?: string;
    };
  };
};

type ConversationFixture = {
  conversationId: string;
  contactId: string;
  contactPhone: string;
};

const realtimeUrl = process.env.VITE_REALTIME_URL || 'ws://localhost:4930';

function parseWsData(raw: MessageEvent['data']): string {
  if (typeof raw === 'string') {
    return raw;
  }

  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString('utf8');
  }

  if (ArrayBuffer.isView(raw)) {
    return Buffer.from(raw.buffer).toString('utf8');
  }

  return String(raw);
}

function waitForSocketOpen(socket: WebSocket, timeoutMs = 5000): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('WebSocket open timeout'));
    }, timeoutMs);

    const onOpen = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error('WebSocket open failed'));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('error', onError);
    };

    socket.addEventListener('open', onOpen);
    socket.addEventListener('error', onError);
  });
}

function waitForEvent(
  socket: WebSocket,
  predicate: (frame: RealtimeFrame) => boolean,
  timeoutMs = 12000,
): Promise<RealtimeFrame> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('WebSocket event timeout'));
    }, timeoutMs);

    const onMessage = (event: MessageEvent) => {
      const parsed = JSON.parse(parseWsData(event.data)) as RealtimeFrame;
      if (predicate(parsed)) {
        cleanup();
        resolve(parsed);
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener('message', onMessage);
    };

    socket.addEventListener('message', onMessage);
  });
}

function waitForClose(socket: WebSocket, timeoutMs = 5000): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('WebSocket close timeout'));
    }, timeoutMs);

    const onClose = () => {
      cleanup();
      resolve();
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener('close', onClose);
    };

    socket.addEventListener('close', onClose);
  });
}

async function readSessionCookie(page: Page): Promise<string> {
  return loginAsAdmin(page);
}

async function readCsrfCookie(page: Page): Promise<string> {
  const csrfCookie = (await page.context().cookies()).find(cookie => cookie.name === 'cvg_csrf');
  if (!csrfCookie) {
    throw new Error('Login did not set the cvg_csrf cookie');
  }
  return csrfCookie.value;
}

async function openAuthenticatedRealtimeSocket(sessionCookie: string): Promise<WebSocket> {
  const socket = new WebSocket(realtimeUrl, {
    headers: {
      Cookie: `cvg_session=${encodeURIComponent(sessionCookie)}`,
    },
  });
  const authSuccessPromise = waitForEvent(socket, (frame) => frame.event === 'auth.success');
  await waitForSocketOpen(socket);
  const authSuccess = await authSuccessPromise;
  expect(authSuccess.event).toBe('auth.success');

  socket.send(JSON.stringify({ type: 'subscribe', channel: 'global' }));
  const subscribeAck = await waitForEvent(socket, (frame) => frame.event === 'subscribed');
  expect(subscribeAck.data.payload?.channel).toBe('global');

  return socket;
}

async function sendOutboundMessage(
  request: Page['request'],
  conversationId: string,
  recipient: string,
  content: string,
  csrfToken: string,
) {
  const response = await request.post('/api/messages', {
    headers: {
      'x-csrf-token': csrfToken,
    },
    data: {
      conversationId,
      recipient,
      content,
    },
  });

  expect(response.status()).toBe(201);
  const body = await response.json() as { messageId: string; conversationId: string };
  expect(body.messageId).toBeTruthy();
  expect(body.conversationId).toBe(conversationId);
  return body;
}

async function createConversationFixture(): Promise<ConversationFixture> {
  const [admin] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, ADMIN_EMAIL))
    .limit(1);

  const [sector] = await db
    .select()
    .from(schema.sectors)
    .where(eq(schema.sectors.isActive, true))
    .limit(1);

  const phone = `+5511${randomUUID().replace(/-/g, '').slice(0, 11)}`;

  const [contact] = await db
    .insert(schema.contacts)
    .values({
      phone,
      name: `E2E Edge Fixture ${randomUUID()}`,
      email: `${phone.replace('+', '')}@e2e.fixture`,
    })
    .returning();

  const [conversation] = await db
    .insert(schema.conversations)
    .values({
      contactId: contact.id,
      status: 'open',
      statusV2: 'novo',
      interactionType: 'clinical',
      sectorId: sector?.id,
      assignedUserId: admin?.id,
      isActive: true,
      externalChannelId: 'whatsapp',
      metadata: null,
    })
    .returning();

  await db.insert(schema.messages).values({
    conversationId: conversation.id,
    direction: 'inbound',
    content: 'Mensagem inicial para cenário de integração',
    sender: phone,
    senderType: 'contact',
    recipient: null,
    status: 'delivered',
    externalMessageId: `e2e-edge-${randomUUID()}`,
    sentAt: new Date(),
    createdAt: new Date(),
  });

  return {
    conversationId: conversation.id,
    contactId: contact.id,
    contactPhone: phone,
  };
}

async function cleanupConversation(fixture: ConversationFixture) {
  await db.delete(schema.messages).where(eq(schema.messages.conversationId, fixture.conversationId));
  await db.delete(schema.conversationStatusHistory).where(
    eq(schema.conversationStatusHistory.conversationId, fixture.conversationId)
  );
  await db.delete(schema.conversationAssignments).where(
    eq(schema.conversationAssignments.conversationId, fixture.conversationId)
  );
  await db.delete(schema.conversations).where(eq(schema.conversations.id, fixture.conversationId));
  await db.delete(schema.contacts).where(eq(schema.contacts.id, fixture.contactId));
}

async function createHandoffAgent(email: string) {
  const [existing] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(schema.users)
    .values({
      name: `Handoff Agent ${email.split('@')[0]}`,
      email,
      passwordHash: '$2a$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      isActive: true,
    })
    .returning();

  return created;
}

test.describe('WebSocket Reconnect Scenarios', () => {
  let conversationFixture: ConversationFixture | null = null;

  test.afterEach(async () => {
    if (conversationFixture) {
      await cleanupConversation(conversationFixture);
      conversationFixture = null;
    }
  });

  test('client reconnects after disconnect and receives future persisted events', async ({ page }) => {
    const sessionCookie = await readSessionCookie(page);
    const csrfToken = await readCsrfCookie(page);
    conversationFixture = await createConversationFixture();

    const firstSocket = await openAuthenticatedRealtimeSocket(sessionCookie);
    const firstPersisted = waitForEvent(
      firstSocket,
      (frame) => frame.event === 'message.persisted' && frame.data.payload?.conversationId === conversationFixture!.conversationId,
    );

    await sendOutboundMessage(
      page.request,
      conversationFixture.conversationId,
      conversationFixture.contactPhone,
      `E2E reconnect baseline ${Date.now()}`,
      csrfToken,
    );

    const firstEvent = await firstPersisted;
    expect(firstEvent.event).toBe('message.persisted');
    expect(firstEvent.data.payload?.conversationId).toBe(conversationFixture.conversationId);

    const closePromise = waitForClose(firstSocket);
    firstSocket.close(1000, 'manual');
    await closePromise;

    const secondSocket = await openAuthenticatedRealtimeSocket(sessionCookie);
    const secondPersisted = waitForEvent(
      secondSocket,
      (frame) => frame.event === 'message.persisted' && frame.data.payload?.conversationId === conversationFixture!.conversationId,
    );

    await sendOutboundMessage(
      page.request,
      conversationFixture.conversationId,
      conversationFixture.contactPhone,
      `E2E reconnect follow-up ${Date.now()}`,
      csrfToken,
    );

    const secondEvent = await secondPersisted;
    expect(secondEvent.event).toBe('message.persisted');
    expect(secondEvent.data.payload?.conversationId).toBe(conversationFixture.conversationId);

    secondSocket.close(1000, 'manual');
    await waitForClose(secondSocket);
  });
});

test.describe('E2E Edge Cases', () => {
  let conversationFixture: ConversationFixture | null = null;

  test.afterEach(async () => {
    if (conversationFixture) {
      await cleanupConversation(conversationFixture);
      conversationFixture = null;
    }
  });

  test('conversation can receive multiple handoffs without resetting context', async ({ page }) => {
    await readSessionCookie(page);
    const csrfToken = await readCsrfCookie(page);
    conversationFixture = await createConversationFixture();

    const agentOne = await createHandoffAgent(`handoff-${Date.now()}-one@e2e.fixture`);
    const agentTwo = await createHandoffAgent(`handoff-${Date.now()}-two@e2e.fixture`);

    const moveToFirst = await page.request.patch(`/api/kanban/card/${conversationFixture.conversationId}/move`, {
      headers: {
        'x-csrf-token': csrfToken,
      },
      data: {
        status: 'em_atendimento',
        assignedUserId: agentOne.id,
      },
    });

    expect(moveToFirst.status()).toBe(200);

    const afterFirst = await db
      .select()
      .from(schema.conversations)
      .where(and(eq(schema.conversations.id, conversationFixture.conversationId), eq(schema.conversations.assignedUserId, agentOne.id)));
    expect(afterFirst).toHaveLength(1);

    const moveToSecond = await page.request.patch(`/api/kanban/card/${conversationFixture.conversationId}/move`, {
      headers: {
        'x-csrf-token': csrfToken,
      },
      data: {
        status: 'pendente',
        assignedUserId: agentTwo.id,
      },
    });

    expect(moveToSecond.status()).toBe(200);

    const afterSecond = await db
      .select()
      .from(schema.conversations)
      .where(and(eq(schema.conversations.id, conversationFixture.conversationId), eq(schema.conversations.assignedUserId, agentTwo.id)));

    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0].statusV2).toBe('pendente');
  });

  test('conversation without immediate response preserves inbound-only state', async ({ page }) => {
    await readSessionCookie(page);
    conversationFixture = await createConversationFixture();

    const before = await page.request.get(`/api/conversations/${conversationFixture.conversationId}/messages?limit=20`, {
    });

    expect(before.status()).toBe(200);
    const beforePayload = await before.json() as { messages: Array<{ direction: 'inbound' | 'outbound'; content: string }> };
    expect(beforePayload.messages.every((message) => message.direction === 'inbound')).toBeTruthy();

    await page.waitForTimeout(2000);

    const after = await page.request.get(`/api/conversations/${conversationFixture.conversationId}/messages?limit=20`, {
    });

    expect(after.status()).toBe(200);
    const afterPayload = await after.json() as { messages: Array<{ direction: 'inbound' | 'outbound'; content: string }> };
    expect(afterPayload.messages.every((message) => message.direction === 'inbound')).toBeTruthy();
  });
});
