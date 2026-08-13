import { beforeEach, describe, expect, it, vi } from 'vitest';

const findByExternalId = vi.fn();

vi.mock('../infrastructure/repositories/message.repository', () => ({
  messageRepository: { findByExternalId },
}));

vi.mock('../infrastructure/repositories/conversation.repository', () => ({
  conversationRepository: {},
}));

vi.mock('../application/events/chat-publisher', () => ({
  publishMessagePersisted: vi.fn(),
  publishConversationCreated: vi.fn(),
}));

vi.mock('@cvg/audit', () => ({
  createAuditLog: vi.fn(),
}));

vi.mock('../application/use-cases/process-message-with-secretary.use-case', () => ({
  processMessageWithSecretary: vi.fn(),
}));

const { receiveInboundMessage } = await import('../application/use-cases/receive-inbound-message.use-case');

describe('receiveInboundMessage error boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps infrastructure failures to a generic external error', async () => {
    findByExternalId.mockRejectedValue(new Error('SELECT * FROM users WHERE password = secret'));

    const result = await receiveInboundMessage({
      externalMessageId: 'external-1',
      content: 'hello',
      sender: '5511999999999',
    });

    expect(result.isErr()).toBe(true);
    expect(result.error.message).toBe('Failed to receive inbound message');
    expect(result.error.message).not.toContain('SELECT');
  });

  it('keeps safe domain validation messages for invalid input', async () => {
    const result = await receiveInboundMessage({
      externalMessageId: 'external-2',
      content: '',
      sender: '5511999999999',
    });

    expect(result.isErr()).toBe(true);
    expect(result.error.message).toBe('Content and sender are required');
  });
});
