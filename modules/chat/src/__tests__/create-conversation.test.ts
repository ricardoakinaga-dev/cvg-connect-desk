import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../infrastructure/repositories/conversation.repository', () => ({
  conversationRepository: {
    create: vi.fn(),
    addStatusHistory: vi.fn(),
  },
}));

import { createConversation } from '../application/use-cases/create-conversation.use-case';
import { conversationRepository } from '../infrastructure/repositories/conversation.repository';

describe('createConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve criar conversa com sucesso', async () => {
    const mockConv = {
      id: 'conv-001',
      contactId: 'contact-001',
      status: 'open',
      createdAt: new Date('2026-03-31T12:00:00Z'),
    };

    vi.mocked(conversationRepository.create).mockResolvedValue(mockConv as any);
    vi.mocked(conversationRepository.addStatusHistory).mockResolvedValue({} as any);

    const result = await createConversation({
      contactId: 'contact-001',
      externalChannelId: 'whatsapp',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.id).toBe('conv-001');
      expect(result.value.contactId).toBe('contact-001');
      expect(result.value.status).toBe('open');
    }

    expect(conversationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'contact-001',
        externalChannelId: 'whatsapp',
        status: 'open',
        isActive: true,
      })
    );

    expect(conversationRepository.addStatusHistory).toHaveBeenCalledWith(
      'conv-001',
      'open',
      undefined,
      'Conversation created'
    );
  });

  it('deve criar conversa sem contactId', async () => {
    const mockConv = {
      id: 'conv-002',
      contactId: null,
      status: 'open',
      createdAt: new Date(),
    };

    vi.mocked(conversationRepository.create).mockResolvedValue(mockConv as any);
    vi.mocked(conversationRepository.addStatusHistory).mockResolvedValue({} as any);

    const result = await createConversation({
      externalConversationId: 'ext-conv-001',
    });

    expect(result.isOk()).toBe(true);
    expect(conversationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: undefined,
        externalConversationId: 'ext-conv-001',
        status: 'open',
      })
    );
  });

  it('deve criar conversa com interactionType', async () => {
    const mockConv = {
      id: 'conv-003',
      contactId: 'contact-001',
      status: 'open',
      interactionType: 'clinical',
      createdAt: new Date(),
    };

    vi.mocked(conversationRepository.create).mockResolvedValue(mockConv as any);
    vi.mocked(conversationRepository.addStatusHistory).mockResolvedValue({} as any);

    const result = await createConversation({
      contactId: 'contact-001',
      interactionType: 'clinical',
    });

    expect(result.isOk()).toBe(true);
    expect(conversationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        interactionType: 'clinical',
      })
    );
  });

  it('deve criar conversa com metadata', async () => {
    const mockConv = {
      id: 'conv-004',
      contactId: null,
      status: 'open',
      createdAt: new Date(),
    };

    vi.mocked(conversationRepository.create).mockResolvedValue(mockConv as any);
    vi.mocked(conversationRepository.addStatusHistory).mockResolvedValue({} as any);

    await createConversation({
      metadata: { source: 'web', campaign: 'summer' },
    });

    expect(conversationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: JSON.stringify({ source: 'web', campaign: 'summer' }),
      })
    );
  });
});
