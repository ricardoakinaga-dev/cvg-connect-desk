import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../infrastructure/repositories/conversation.repository', () => ({
  conversationRepository: {
    findById: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../infrastructure/repositories/message.repository', () => ({
  messageRepository: {
    create: vi.fn(),
  },
}));

vi.mock('../application/events/chat-publisher', () => ({
  publishMessagePersisted: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@cvg/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@cvg/gateway-adapter', () => ({
  mediaService: {
    sendText: vi.fn().mockResolvedValue({ success: true, messageId: 'ext-123' }),
    sendImage: vi.fn().mockResolvedValue({ success: true, messageId: 'ext-123' }),
    sendAudio: vi.fn().mockResolvedValue({ success: true, messageId: 'ext-123' }),
    sendDocument: vi.fn().mockResolvedValue({ success: true, messageId: 'ext-123' }),
  },
}));

import { sendOutboundMessage } from '../application/use-cases/send-outbound-message.use-case';
import { conversationRepository } from '../infrastructure/repositories/conversation.repository';
import { messageRepository } from '../infrastructure/repositories/message.repository';
import { publishMessagePersisted } from '../application/events/chat-publisher';

describe('sendOutboundMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve retornar erro quando recipient não é fornecido', async () => {
    const result = await sendOutboundMessage({
      conversationId: 'conv-001',
      content: 'Hello',
      recipient: '',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Recipient is required');
    }
  });

  it('deve retornar erro quando content e mediaUrl estão vazios', async () => {
    const result = await sendOutboundMessage({
      conversationId: 'conv-001',
      content: '',
      recipient: '+5511999999999',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Content or media is required');
    }
  });

  it('deve retornar erro quando conversa não existe', async () => {
    vi.mocked(conversationRepository.findById).mockResolvedValue(null);

    const result = await sendOutboundMessage({
      conversationId: 'conv-inexistente',
      content: 'Hello',
      recipient: '+5511999999999',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Conversation not found');
    }
  });

  it('deve retornar erro quando conversa está fechada', async () => {
    vi.mocked(conversationRepository.findById).mockResolvedValue({
      id: 'conv-001',
      isActive: false,
      status: 'closed',
      contactId: 'contact-001',
    } as any);

    const result = await sendOutboundMessage({
      conversationId: 'conv-001',
      content: 'Hello',
      recipient: '+5511999999999',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Cannot send message to closed conversation');
    }
  });

  it('deve enviar mensagem com sucesso', async () => {
    vi.mocked(conversationRepository.findById).mockResolvedValue({
      id: 'conv-001',
      isActive: true,
      status: 'open',
      contactId: 'contact-001',
    } as any);

    vi.mocked(messageRepository.create).mockResolvedValue({
      id: 'msg-001',
      conversationId: 'conv-001',
      direction: 'outbound',
      content: 'Olá!',
      status: 'pending',
    } as any);

    const result = await sendOutboundMessage({
      conversationId: 'conv-001',
      content: 'Olá!',
      recipient: '+5511999999999',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.messageId).toBe('msg-001');
      expect(result.value.conversationId).toBe('conv-001');
    }

    expect(messageRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-001',
        direction: 'outbound',
        content: 'Olá!',
        recipient: '+5511999999999',
        status: 'pending',
      })
    );

    expect(publishMessagePersisted).toHaveBeenCalled();
  });

  it('deve enviar mensagem com mídia', async () => {
    vi.mocked(conversationRepository.findById).mockResolvedValue({
      id: 'conv-001',
      isActive: true,
      status: 'open',
      contactId: 'contact-001',
    } as any);

    vi.mocked(messageRepository.create).mockResolvedValue({
      id: 'msg-002',
      conversationId: 'conv-001',
      direction: 'outbound',
      content: '',
      status: 'pending',
    } as any);

    const result = await sendOutboundMessage({
      conversationId: 'conv-001',
      content: '',
      recipient: '+5511999999999',
      mediaUrl: 'data:image/png;base64,...',
      mediaType: 'image',
      mediaMimetype: 'image/png',
      mediaFilename: 'foto.png',
    });

    expect(result.isOk()).toBe(true);
    expect(messageRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaUrl: 'data:image/png;base64,...',
        mediaType: 'image',
        mediaMimetype: 'image/png',
        mediaFilename: 'foto.png',
      })
    );
  });
});
