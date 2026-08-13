import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  publish: vi.fn().mockResolvedValue(undefined),
  createMessagePersistedEvent: vi.fn((input: unknown) => ({ type: 'message.persisted', input })),
  createConversationCreatedEvent: vi.fn((input: unknown) => ({ type: 'conversation.created', input })),
  createConversationStatusChangedEvent: vi.fn((input: unknown) => ({ type: 'conversation.status.changed', input })),
}));

vi.mock('@cvg/events', () => ({
  databaseEventPublisher: { publish: mocks.publish },
  createMessagePersistedEvent: mocks.createMessagePersistedEvent,
  createConversationCreatedEvent: mocks.createConversationCreatedEvent,
  createConversationStatusChangedEvent: mocks.createConversationStatusChangedEvent,
}));

const {
  publishMessagePersisted,
  publishConversationCreated,
  publishConversationStatusChanged,
} = await import('../application/events/chat-publisher');

describe('chat event publisher', () => {
  beforeEach(() => vi.clearAllMocks());

  it('publishes message events with optional sender and recipient variants', async () => {
    const createdAt = new Date('2026-08-12T12:00:00.000Z');

    await publishMessagePersisted({
      id: 'message-1',
      conversationId: 'conversation-1',
      direction: 'outbound',
      content: 'Oi',
      sender: null,
      recipient: null,
      status: 'pending',
      createdAt,
    });
    await publishMessagePersisted({
      id: 'message-2',
      conversationId: 'conversation-1',
      direction: 'inbound',
      content: 'Olá',
      sender: 'contact',
      recipient: 'desk',
      status: 'delivered',
      createdAt,
    });

    expect(mocks.createMessagePersistedEvent).toHaveBeenCalledTimes(2);
    expect(mocks.createMessagePersistedEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sender: undefined,
      recipient: undefined,
      createdAt: createdAt.toISOString(),
    }));
    expect(mocks.createMessagePersistedEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      sender: 'contact',
      recipient: 'desk',
    }));
    expect(mocks.publish).toHaveBeenCalledTimes(2);
  });

  it('publishes conversation creation with nullable fields and status changes', async () => {
    const createdAt = new Date('2026-08-12T12:00:00.000Z');

    await publishConversationCreated({
      id: 'conversation-1',
      contactId: null,
      externalConversationId: null,
      externalChannelId: null,
      interactionType: null,
      createdAt,
    });
    await publishConversationCreated({
      id: 'conversation-2',
      contactId: 'contact-1',
      externalConversationId: 'external-1',
      externalChannelId: 'whatsapp',
      interactionType: 'clinical',
      createdAt,
    });
    await publishConversationStatusChanged('conversation-1', 'novo', 'em_atendimento');
    await publishConversationStatusChanged('conversation-1', 'em_atendimento', 'pendente', 'agent-1', 'aguardando tutor');

    expect(mocks.createConversationCreatedEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      contactId: undefined,
      externalConversationId: undefined,
      externalChannelId: undefined,
      interactionType: undefined,
    }));
    expect(mocks.createConversationCreatedEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      contactId: 'contact-1',
      externalConversationId: 'external-1',
      externalChannelId: 'whatsapp',
      interactionType: 'clinical',
    }));
    expect(mocks.createConversationStatusChangedEvent).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-1',
      previousStatus: 'em_atendimento',
      newStatus: 'pendente',
      changedBy: 'agent-1',
      reason: 'aguardando tutor',
    }));
    expect(mocks.publish).toHaveBeenCalledTimes(4);
  });
});
