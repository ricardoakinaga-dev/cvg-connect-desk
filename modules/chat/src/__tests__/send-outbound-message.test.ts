import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import type { Conversation, Message } from '../infrastructure/repositories';

const mocks = vi.hoisted(() => {
  return {
    conversationRepository: {
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateStatusV2: vi.fn(),
      updateSector: vi.fn(),
      assignUser: vi.fn(),
      close: vi.fn(),
      addStatusHistory: vi.fn(),
      countByStatusV2: vi.fn(),
      countBySector: vi.fn(),
      findByExternalId: vi.fn(),
      findAll: vi.fn(),
    },
    messageRepository: {
      create: vi.fn(),
      findById: vi.fn(),
      findByConversationId: vi.fn(),
      updateStatus: vi.fn(),
    },
    publishMessagePersisted: vi.fn().mockResolvedValue(undefined),
    createAuditLog: vi.fn().mockResolvedValue(undefined),
    outboundDeliveryService: {
      send: vi.fn().mockResolvedValue({ success: true }),
    },
  };
});

vi.mock('../infrastructure/repositories/conversation.repository', () => ({
  conversationRepository: mocks.conversationRepository,
}));
vi.mock('../infrastructure/repositories/message.repository', () => ({
  messageRepository: mocks.messageRepository,
}));
vi.mock('../application/events/chat-publisher', () => ({
  publishMessagePersisted: mocks.publishMessagePersisted,
}));
vi.mock('@cvg/audit', () => ({
  createAuditLog: mocks.createAuditLog,
}));

import { setOutboundDeliveryService } from '../application/outbound-delivery';
import { sendOutboundMessage, type SendOutboundMessageInput } from '../application/use-cases/send-outbound-message.use-case';

describe('sendOutboundMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setOutboundDeliveryService(mocks.outboundDeliveryService);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    setOutboundDeliveryService(null);
    vi.restoreAllMocks();
  });

  const mockConversation: Conversation = {
    id: 'conv-123',
    externalId: 'ext-123',
    status: 'open',
    isActive: true,
    sectorId: null,
    assignedUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastMessageAt: new Date(),
    lastMessagePreview: null,
    unreadCount: 0,
    metadata: null,
  };

  const mockMessage: Message = {
    id: 'msg-456',
    conversationId: 'conv-123',
    direction: 'outbound',
    content: 'Hello',
    recipient: '5511999999999',
    sender: null,
    status: 'pending',
    occurredAt: new Date(),
    mediaUrl: null,
    mediaType: null,
    mediaMimetype: null,
    mediaFilename: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  describe('input validation', () => {
    it('returns error when recipient is missing', async () => {
      const input: SendOutboundMessageInput = {
        conversationId: 'conv-123',
        content: 'Hello',
        recipient: '',
      };

      const result = await sendOutboundMessage(input);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Recipient is required');
      }
    });

    it('returns error when content and mediaUrl are both missing', async () => {
      const input: SendOutboundMessageInput = {
        conversationId: 'conv-123',
        content: '',
        recipient: '5511999999999',
      };

      const result = await sendOutboundMessage(input);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Content or media is required');
      }
    });

    it('returns error when conversation does not exist', async () => {
      mocks.conversationRepository.findById.mockResolvedValue(null);

      const input: SendOutboundMessageInput = {
        conversationId: 'conv-123',
        content: 'Hello',
        recipient: '5511999999999',
      };

      const result = await sendOutboundMessage(input);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Conversation not found');
      }
    });

    it('returns error when conversation is not active', async () => {
      mocks.conversationRepository.findById.mockResolvedValue({
        ...mockConversation,
        isActive: false,
      });

      const input: SendOutboundMessageInput = {
        conversationId: 'conv-123',
        content: 'Hello',
        recipient: '5511999999999',
      };

      const result = await sendOutboundMessage(input);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Cannot send message to closed conversation');
      }
    });
  });

  describe('successful message sending', () => {
    beforeEach(() => {
      mocks.conversationRepository.findById.mockResolvedValue(mockConversation);
      mocks.messageRepository.create.mockResolvedValue(mockMessage);
    });

    it('creates outbound message with correct fields', async () => {
      const input: SendOutboundMessageInput = {
        conversationId: 'conv-123',
        content: 'Hello',
        recipient: '5511999999999',
        sender: 'agent-1',
      };

      await sendOutboundMessage(input);

      expect(mocks.messageRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-123',
          direction: 'outbound',
          content: 'Hello',
          recipient: '5511999999999',
          sender: 'agent-1',
          status: 'pending',
        })
      );
    });

    // Note: result validation tests are deferred due to async mock complexity
    // The core functionality (input validation, message creation, API calls) is tested above

    it('sends text message via evolution API', async () => {
      const input: SendOutboundMessageInput = {
        conversationId: 'conv-123',
        content: 'Hello',
        recipient: '5511999999999',
      };

      await sendOutboundMessage(input);

      await vi.waitFor(() => expect(mocks.outboundDeliveryService.send).toHaveBeenCalledWith(
        expect.objectContaining({ recipient: '5511999999999', content: 'Hello' })
      ));
    });

    it('sends location message via evolution API with formatted coordinates', async () => {
      const input: SendOutboundMessageInput = {
        conversationId: 'conv-123',
        content: 'Atendimento no local',
        recipient: '5511999999999',
        mediaType: 'location',
        latitude: -23.55052,
        longitude: -46.633308,
      };

      await sendOutboundMessage(input);

      await vi.waitFor(() => expect(mocks.outboundDeliveryService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient: '5511999999999',
          content: '[Localização] Atendimento no local (-23.550520,-46.633308)',
        })
      ));
    });

    it('sends image message via evolution API', async () => {
      const input: SendOutboundMessageInput = {
        conversationId: 'conv-123',
        content: 'Check this out',
        recipient: '5511999999999',
        mediaUrl: 'https://example.com/image.jpg',
        mediaType: 'image',
        mediaMimetype: 'image/jpeg',
        mediaFilename: 'image.jpg',
      };

      await sendOutboundMessage(input);

      await vi.waitFor(() => expect(mocks.outboundDeliveryService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient: '5511999999999',
          mediaUrl: 'https://example.com/image.jpg',
          mediaType: 'image',
          content: 'Check this out',
        })
      ));
    });

    it('sends audio message via evolution API', async () => {
      const input: SendOutboundMessageInput = {
        conversationId: 'conv-123',
        content: '',
        recipient: '5511999999999',
        mediaUrl: 'https://example.com/audio.mp3',
        mediaType: 'audio',
      };

      await sendOutboundMessage(input);

      await vi.waitFor(() => expect(mocks.outboundDeliveryService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient: '5511999999999',
          mediaUrl: 'https://example.com/audio.mp3',
          mediaType: 'audio',
        })
      ));
    });

    it('sends document message via evolution API', async () => {
      const input: SendOutboundMessageInput = {
        conversationId: 'conv-123',
        content: 'Here is the document',
        recipient: '5511999999999',
        mediaUrl: 'https://example.com/doc.pdf',
        mediaType: 'document',
        mediaFilename: 'document.pdf',
      };

      await sendOutboundMessage(input);

      await vi.waitFor(() => expect(mocks.outboundDeliveryService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient: '5511999999999',
          mediaUrl: 'https://example.com/doc.pdf',
          mediaType: 'document',
          mediaFilename: 'document.pdf',
        })
      ));
    });

    it('strips non-digit characters from recipient phone', async () => {
      mocks.outboundDeliveryService.send.mockClear();

      const input: SendOutboundMessageInput = {
        conversationId: 'conv-123',
        content: 'Hello',
        recipient: '55+11 (9999) 9999',
      };

      await sendOutboundMessage(input);

      await vi.waitFor(() => expect(mocks.outboundDeliveryService.send).toHaveBeenCalledWith(
        expect.objectContaining({ recipient: '551199999999', content: 'Hello' })
      ));
    });

    it('handles media metadata correctly', async () => {
      const input: SendOutboundMessageInput = {
        conversationId: 'conv-123',
        content: 'Test',
        recipient: '5511999999999',
        metadata: { key: 'value' },
      };

      await sendOutboundMessage(input);

      expect(mocks.messageRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: JSON.stringify({ key: 'value' }),
        })
      );
    });

    it('writes an audit entry for an authenticated media message', async () => {
      const input: SendOutboundMessageInput = {
        conversationId: 'conv-123',
        content: 'Confira o arquivo',
        recipient: '5511999999999',
        mediaUrl: 'https://example.com/file.pdf',
        mediaType: 'document',
        userId: 'user-1',
      };

      const result = await sendOutboundMessage(input);

      expect(result.isErr()).toBe(false);
      expect(mocks.messageRepository.create).toHaveBeenCalled();
      expect(mocks.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1',
        action: 'message.outbound.document',
        entityId: mockMessage.id,
      }));
    });

    it('records a delivery failure without failing the persisted message', async () => {
      mocks.outboundDeliveryService.send.mockResolvedValueOnce({
        success: false,
        error: 'gateway unavailable',
      });

      await sendOutboundMessage({
        conversationId: 'conv-123',
        content: 'Hello',
        recipient: '5511999999999',
      });

      await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith(
        '[sendViaEvolution] Falha: gateway unavailable'
      ));
    });

    it('warns when outbound delivery is not configured', async () => {
      setOutboundDeliveryService(null);

      await sendOutboundMessage({
        conversationId: 'conv-123',
        content: 'Hello',
        recipient: '5511999999999',
      });

      await vi.waitFor(() => expect(console.warn).toHaveBeenCalledWith(
        '[sendViaEvolution] Outbound delivery service not configured'
      ));
    });

    it('contains delivery service exceptions in the asynchronous path', async () => {
      mocks.outboundDeliveryService.send.mockRejectedValueOnce(new Error('transport down'));

      await sendOutboundMessage({
        conversationId: 'conv-123',
        content: 'Hello',
        recipient: '5511999999999',
      });

      await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith(
        '[sendViaEvolution] Erro:',
        expect.objectContaining({ message: 'transport down' })
      ));
    });

    it('formats a location without an optional caption', async () => {
      await sendOutboundMessage({
        conversationId: 'conv-123',
        content: '',
        recipient: '5511999999999',
        mediaType: 'location',
        latitude: -23.55052,
        longitude: -46.633308,
      });

      await vi.waitFor(() => expect(mocks.outboundDeliveryService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '[Localização] -23.550520,-46.633308',
        })
      ));
    });

    it('maps repository failures to a controlled result', async () => {
      mocks.messageRepository.create.mockRejectedValueOnce(new Error('database unavailable'));

      const result = await sendOutboundMessage({
        conversationId: 'conv-123',
        content: 'Hello',
        recipient: '5511999999999',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('database unavailable');
      }
    });

    it('requires location payload with coordinates', async () => {
      const input: SendOutboundMessageInput = {
        conversationId: 'conv-123',
        content: 'Localização sem coordenadas',
        recipient: '5511999999999',
        mediaType: 'location',
      };

      const result = await sendOutboundMessage(input);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Latitude and longitude are required for location media type');
      }
    });
  });
});
