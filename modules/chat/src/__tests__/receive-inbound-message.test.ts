import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../infrastructure/repositories/conversation.repository', () => ({
  conversationRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    findByExternalId: vi.fn(),
    addStatusHistory: vi.fn(),
    updateCurrentHandler: vi.fn(),
  },
}));

vi.mock('../infrastructure/repositories/message.repository', () => ({
  messageRepository: {
    create: vi.fn(),
    findByExternalId: vi.fn(),
  },
}));

vi.mock('../application/events/chat-publisher', () => ({
  publishMessagePersisted: vi.fn().mockResolvedValue(undefined),
  publishConversationCreated: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../application/use-cases/process-message-with-secretary.use-case', () => ({
  processMessageWithSecretary: vi.fn().mockResolvedValue({
    isOk: () => true,
    value: { handoffTriggered: false },
  }),
}));

vi.mock('@cvg/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@cvg/secretary-adapter', () => ({
  triggerHandoff: vi.fn().mockResolvedValue(undefined),
}));

import { receiveInboundMessage } from '../application/use-cases/receive-inbound-message.use-case';
import { conversationRepository } from '../infrastructure/repositories/conversation.repository';
import { messageRepository } from '../infrastructure/repositories/message.repository';

describe('receiveInboundMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve retornar erro quando content está vazio', async () => {
    const result = await receiveInboundMessage({
      externalMessageId: 'ext-001',
      content: '',
      sender: '+5511999999999',
    });

    expect(result.isErr()).toBe(true);
  });

  it('deve retornar erro quando sender está vazio', async () => {
    const result = await receiveInboundMessage({
      externalMessageId: 'ext-001',
      content: 'Olá',
      sender: '',
    });

    expect(result.isErr()).toBe(true);
  });

  it('deve retornar mensagem existente quando externalMessageId já existe (idempotência)', async () => {
    vi.mocked(messageRepository.findByExternalId).mockResolvedValue({
      id: 'msg-existente',
      conversationId: 'conv-001',
      direction: 'inbound',
      content: 'Olá',
      status: 'pending',
    } as any);

    const result = await receiveInboundMessage({
      externalMessageId: 'ext-duplicado',
      content: 'Olá',
      sender: '+5511999999999',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.messageId).toBe('msg-existente');
      expect(result.value.isNewConversation).toBe(false);
    }

    // Não deve criar nova mensagem
    expect(messageRepository.create).not.toHaveBeenCalled();
  });

  it('deve criar nova conversa quando externalConversationId não existe', async () => {
    vi.mocked(messageRepository.findByExternalId).mockResolvedValue(null);
    vi.mocked(conversationRepository.findByExternalId).mockResolvedValue(null);
    vi.mocked(conversationRepository.create).mockResolvedValue({
      id: 'conv-nova',
      status: 'open',
      isActive: true,
      contactId: null,
    } as any);
    vi.mocked(messageRepository.create).mockResolvedValue({
      id: 'msg-nova',
      conversationId: 'conv-nova',
      direction: 'inbound',
      content: 'Primeira mensagem',
      status: 'pending',
    } as any);

    const result = await receiveInboundMessage({
      externalMessageId: 'ext-novo',
      externalConversationId: 'ext-conv-novo',
      content: 'Primeira mensagem',
      sender: '+5511999999999',
      contactPhone: '+5511999999999',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.conversationId).toBe('conv-nova');
      expect(result.value.isNewConversation).toBe(true);
    }

    expect(conversationRepository.create).toHaveBeenCalled();
    expect(conversationRepository.addStatusHistory).toHaveBeenCalled();
  });

  it('deve usar conversa existente quando externalConversationId já existe', async () => {
    vi.mocked(messageRepository.findByExternalId).mockResolvedValue(null);
    vi.mocked(conversationRepository.findByExternalId).mockResolvedValue({
      id: 'conv-existente',
      status: 'open',
      isActive: true,
      contactId: 'contact-001',
    } as any);
    vi.mocked(messageRepository.create).mockResolvedValue({
      id: 'msg-002',
      conversationId: 'conv-existente',
      direction: 'inbound',
      content: 'Segunda mensagem',
      status: 'pending',
    } as any);

    const result = await receiveInboundMessage({
      externalMessageId: 'ext-002',
      externalConversationId: 'ext-conv-existente',
      content: 'Segunda mensagem',
      sender: '+5511999999999',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.conversationId).toBe('conv-existente');
      expect(result.value.isNewConversation).toBe(false);
    }

    // Não deve criar nova conversa
    expect(conversationRepository.create).not.toHaveBeenCalled();
  });

  it('deve persistir mensagem inbound corretamente', async () => {
    vi.mocked(messageRepository.findByExternalId).mockResolvedValue(null);
    vi.mocked(conversationRepository.findByExternalId).mockResolvedValue({
      id: 'conv-001',
      status: 'open',
      isActive: true,
    } as any);
    vi.mocked(messageRepository.create).mockResolvedValue({
      id: 'msg-003',
      conversationId: 'conv-001',
    } as any);

    await receiveInboundMessage({
      externalMessageId: 'ext-003',
      externalConversationId: 'ext-conv-001',
      content: 'Mensagem com mídia',
      sender: '+5511999999999',
      mediaUrl: 'https://example.com/image.jpg',
      mediaType: 'image',
      sentAt: new Date('2026-03-31T15:00:00Z'),
    });

    expect(messageRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-001',
        direction: 'inbound',
        content: 'Mensagem com mídia',
        sender: '+5511999999999',
        mediaUrl: 'https://example.com/image.jpg',
        mediaType: 'image',
        status: 'pending',
      })
    );
  });
});
