import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const addStatusHistory = vi.fn();

vi.mock('../infrastructure/repositories/conversation.repository', () => ({
  conversationRepository: {
    create,
    addStatusHistory,
  },
}));

const { createConversation } = await import('../application/use-cases/create-conversation.use-case');

describe('createConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an open active conversation and records status history', async () => {
    const createdAt = new Date('2026-04-28T00:00:00.000Z');
    create.mockResolvedValue({
      id: 'conversation-1',
      contactId: 'contact-1',
      status: 'open',
      createdAt,
    });

    const result = await createConversation({
      contactId: 'contact-1',
      externalConversationId: 'external-1',
      externalChannelId: 'whatsapp',
      interactionType: 'clinical',
      queueId: 'queue-1',
      teamId: 'team-1',
      metadata: { source: 'webhook' },
    });

    expect(result.isErr()).toBe(false);
    expect(create).toHaveBeenCalledWith({
      contactId: 'contact-1',
      externalConversationId: 'external-1',
      externalChannelId: 'whatsapp',
      interactionType: 'clinical',
      queueId: 'queue-1',
      teamId: 'team-1',
      metadata: JSON.stringify({ source: 'webhook' }),
      status: 'open',
      isActive: true,
    });
    expect(addStatusHistory).toHaveBeenCalledWith(
      'conversation-1',
      'open',
      undefined,
      'Conversation created'
    );
    expect(result.value).toEqual({
      id: 'conversation-1',
      contactId: 'contact-1',
      status: 'open',
      createdAt,
    });
  });

  it('returns an error result when persistence fails', async () => {
    const error = new Error('database unavailable');
    create.mockRejectedValue(error);

    const result = await createConversation({});

    expect(result.isErr()).toBe(true);
    expect(result.error).toBe(error);
    expect(addStatusHistory).not.toHaveBeenCalled();
  });
});
