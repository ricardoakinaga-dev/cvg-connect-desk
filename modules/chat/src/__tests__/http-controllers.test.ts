import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@cvg/shared';

const sendOutboundMessage = vi.fn();
const receiveInboundMessage = vi.fn();
const findAllConversations = vi.fn();
const findRecentByConversationId = vi.fn();
const dbSelect = vi.fn();
const inArray = vi.fn((left: unknown, values: unknown[]) => ({ left, values }));

vi.mock('drizzle-orm', () => ({
  inArray,
}));

vi.mock('@cvg/auth', () => ({
  authenticate: async (request: { user?: { id: string; roles: string[] } }) => {
    request.user = { id: 'user-1', roles: ['Agent'] };
  },
  requirePermission: () => async () => {},
}));

vi.mock('@cvg/database', () => ({
  db: {
    select: dbSelect,
  },
  contacts: {
    id: 'contacts.id',
    name: 'contacts.name',
    phone: 'contacts.phone',
  },
}));

vi.mock('../application/use-cases/send-outbound-message.use-case', () => ({
  sendOutboundMessage,
}));

vi.mock('../application/use-cases/receive-inbound-message.use-case', () => ({
  receiveInboundMessage,
}));

vi.mock('../infrastructure/repositories/conversation.repository', () => ({
  conversationRepository: {
    findAll: findAllConversations,
  },
}));

vi.mock('../infrastructure/repositories/message.repository', () => ({
  messageRepository: {
    findRecentByConversationId,
  },
}));

const { registerOutboundController } = await import('../presentation/http/outbound.controller');
const { registerInboundWebhook } = await import('../presentation/http/webhook-inbound.controller');

function ok<T>(value: T) {
  return { isErr: () => false, value };
}

function fail(error: Error) {
  return { isErr: () => true, error };
}

async function buildApp(register: (app: ReturnType<typeof Fastify>) => Promise<void>) {
  const app = Fastify({ logger: false });
  await register(app);
  await app.ready();
  return app;
}

describe('chat HTTP controllers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ id: 'contact-1', name: 'Tutor', phone: '5511999999999' }]),
      })),
    });
  });

  it('sends outbound messages and maps successful use-case output', async () => {
    const app = await buildApp(registerOutboundController);
    sendOutboundMessage.mockResolvedValue(ok({
      messageId: 'message-1',
      conversationId: 'conversation-1',
      status: 'pending',
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/messages',
      payload: {
        conversationId: '00000000-0000-4000-8000-000000000001',
        content: 'Oi',
        recipient: '5511999999999',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      messageId: 'message-1',
      conversationId: 'conversation-1',
      status: 'pending',
    });
    expect(sendOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Oi',
      recipient: '5511999999999',
      userId: 'user-1',
    }));
    await app.close();
  });

  it('maps outbound domain and unexpected errors', async () => {
    const app = await buildApp(registerOutboundController);
    sendOutboundMessage.mockResolvedValueOnce(fail(new AppError('No conversation', 404, 'NOT_FOUND')));

    let response = await app.inject({
      method: 'POST',
      url: '/messages',
      payload: {
        conversationId: '00000000-0000-4000-8000-000000000001',
        recipient: '5511999999999',
      },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'NOT_FOUND' });

    sendOutboundMessage.mockRejectedValueOnce(new Error('db down'));
    response = await app.inject({
      method: 'POST',
      url: '/messages',
      payload: {
        conversationId: '00000000-0000-4000-8000-000000000001',
        recipient: '5511999999999',
      },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: 'INTERNAL_ERROR' });

    sendOutboundMessage.mockResolvedValueOnce(fail(new Error('unexpected domain error')));
    response = await app.inject({
      method: 'POST',
      url: '/messages',
      payload: {
        conversationId: '00000000-0000-4000-8000-000000000001',
        recipient: '5511999999999',
      },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: 'INTERNAL_ERROR' });
    await app.close();
  });

  it('lists messages and conversations with contact and last-message details', async () => {
    const app = await buildApp(registerOutboundController);
    findRecentByConversationId
      .mockResolvedValueOnce([{ id: 'message-1', content: 'last' }])
      .mockResolvedValueOnce([{ id: 'message-2', content: 'conversation last' }]);
    findAllConversations.mockResolvedValue([{
      id: 'conversation-1',
      contactId: 'contact-1',
      status: 'open',
    }]);

    let response = await app.inject({
      method: 'GET',
      url: '/conversations/00000000-0000-4000-8000-000000000001/messages?limit=1',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ messages: [{ id: 'message-1', content: 'last' }] });

    response = await app.inject({
      method: 'GET',
      url: '/conversations?status=open&sectorId=00000000-0000-4000-8000-000000000002',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().conversations[0]).toMatchObject({
      id: 'conversation-1',
      contactName: 'Tutor',
      contactPhone: '5511999999999',
      lastMessage: { id: 'message-2', content: 'conversation last' },
    });
    await app.close();
  });

  it('processes inbound webhooks and maps domain errors', async () => {
    const app = await buildApp(registerInboundWebhook);
    receiveInboundMessage.mockResolvedValueOnce(ok({
      messageId: 'message-1',
      conversationId: 'conversation-1',
      isNewConversation: true,
    }));

    let response = await app.inject({
      method: 'POST',
      url: '/webhook/inbound',
      payload: {
        messageId: 'external-1',
        conversationId: 'external-conv-1',
        from: '5511999999999',
        content: 'Oi',
        timestamp: '2026-04-28T00:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      messageId: 'message-1',
      conversationId: 'conversation-1',
    });
    expect(receiveInboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      externalMessageId: 'external-1',
      content: 'Oi',
      sender: '5511999999999',
      senderType: 'contact',
    }));

    receiveInboundMessage.mockResolvedValueOnce(fail(new AppError('Invalid', 400, 'BAD_REQUEST')));
    response = await app.inject({
      method: 'POST',
      url: '/webhook/inbound',
      payload: { from: '5511999999999', text: 'Oi' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'BAD_REQUEST' });
    await app.close();
  });
});
