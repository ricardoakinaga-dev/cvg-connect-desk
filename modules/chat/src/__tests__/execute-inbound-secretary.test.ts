import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, err, ok } from '@cvg/shared';
import { executeInboundSecretaryInvocation } from '../application/use-cases/execute-inbound-secretary.use-case';

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  markUnknown: vi.fn(),
  getBudgetLimits: vi.fn(),
  dbExecute: vi.fn(),
  conversationFind: vi.fn(),
  conversationUpdate: vi.fn(),
  messageFind: vi.fn(),
  processSecretary: vi.fn(),
  sendOutbound: vi.fn(),
}));

vi.mock('@cvg/database', () => ({
  db: { execute: mocks.dbExecute },
}));

vi.mock('@cvg/secretary-adapter', () => ({
  beginSecretaryInvocation: mocks.begin,
  completeSecretaryInvocation: mocks.complete,
  failSecretaryInvocation: mocks.fail,
  markSecretaryInvocationUnknown: mocks.markUnknown,
  getAIBudgetLimits: mocks.getBudgetLimits,
  AIBudgetExhaustedError: class AIBudgetExhaustedError extends Error {
    errorCode = 'AI_BUDGET_EXHAUSTED';
  },
}));

vi.mock('../infrastructure/repositories/conversation.repository', () => ({
  conversationRepository: {
    findById: mocks.conversationFind,
    updateCurrentHandler: mocks.conversationUpdate,
  },
}));

vi.mock('../infrastructure/repositories/message.repository', () => ({
  messageRepository: { findById: mocks.messageFind },
}));

vi.mock('../application/use-cases/process-message-with-secretary.use-case', () => ({
  processMessageWithSecretary: mocks.processSecretary,
}));

vi.mock('../application/use-cases/send-outbound-message.use-case', () => ({
  sendOutboundMessage: mocks.sendOutbound,
}));

const message = {
  id: 'message-1',
  conversationId: 'conversation-1',
  externalMessageId: 'external-message-1',
  content: 'Mensagem inbound',
  direction: 'inbound',
  sender: '+5511999999999',
  metadata: null,
};

const conversation = {
  id: 'conversation-1',
  isActive: true,
  currentHandler: 'bot',
};

const processingRecord = {
  id: 'invocation-row',
  invocationKey: 'inbound:message-1',
  conversationId: 'conversation-1',
  messageId: 'message-1',
  eventId: 'event-1',
  consumerId: 'worker',
  action: 'classify',
  status: 'processing',
  attemptCount: 1,
  lastError: null,
  errorCode: null,
  resultRef: null,
  detail: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null,
};

const input = {
  eventId: 'event-1',
  conversationId: 'conversation-1',
  messageId: 'message-1',
  consumerId: 'worker',
};

describe('executeInboundSecretaryInvocation state boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbExecute.mockResolvedValue({ rows: [] });
    mocks.getBudgetLimits.mockReturnValue({ maxInvocationsPerConversation: 20 });
    mocks.messageFind.mockResolvedValue(message);
    mocks.conversationFind.mockResolvedValue(conversation);
    mocks.begin.mockResolvedValue({
      record: processingRecord,
      outcome: 'started',
      alreadyCompleted: false,
    });
    mocks.complete.mockResolvedValue({ ...processingRecord, status: 'completed' });
    mocks.fail.mockResolvedValue({ ...processingRecord, status: 'unknown' });
    mocks.markUnknown.mockResolvedValue({ ...processingRecord, status: 'unknown' });
    mocks.processSecretary.mockResolvedValue(ok({
      classified: true,
      handoffTriggered: false,
      secretaryResponse: 'Resposta da Secretary',
      classification: { category: 'general', priority: 'low', confidence: 0.9 },
    }));
    mocks.sendOutbound.mockResolvedValue(ok({
      outcome: 'sent',
      messageId: 'outbound-1',
      deduplicated: false,
    }));
  });

  it('ACKs a redelivery already marked unknown without invoking the Secretary', async () => {
    mocks.begin.mockResolvedValue({
      record: { ...processingRecord, status: 'unknown', attemptCount: 2 },
      outcome: 'unknown',
      alreadyCompleted: false,
    });

    const result = await executeInboundSecretaryInvocation(input);

    expect(result).toMatchObject({ status: 'unknown', deduplicated: true });
    expect(mocks.processSecretary).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('does not invoke the Secretary while another executor is processing', async () => {
    mocks.begin.mockResolvedValue({
      record: processingRecord,
      outcome: 'in_progress',
      alreadyCompleted: false,
    });

    const result = await executeInboundSecretaryInvocation(input);

    expect(result).toMatchObject({ status: 'processing', deduplicated: true });
    expect(mocks.processSecretary).not.toHaveBeenCalled();
  });

  it('records an ambiguous Secretary error as unknown and does not throw for redelivery', async () => {
    mocks.processSecretary.mockResolvedValue(err(new AppError('Secretary request timed out', 504, 'SECRETARY_TIMEOUT')));

    const result = await executeInboundSecretaryInvocation(input);

    expect(result).toMatchObject({ status: 'unknown', deduplicated: false });
    expect(mocks.fail).toHaveBeenCalledWith(
      'inbound:message-1',
      expect.objectContaining({
        ambiguous: true,
        expectedAttemptCount: 1,
        errorCode: 'SECRETARY_TIMEOUT',
      }),
    );
  });

  it('records an ambiguous outbound error as unknown without retrying the event', async () => {
    mocks.sendOutbound.mockResolvedValue(err(new AppError('delivery unknown', 502, 'OUTBOUND_UNKNOWN')));

    const result = await executeInboundSecretaryInvocation(input);

    expect(result).toMatchObject({ status: 'unknown', deduplicated: false });
    expect(mocks.fail).toHaveBeenCalledWith(
      'inbound:message-1',
      expect.objectContaining({ ambiguous: true, errorCode: 'OUTBOUND_UNKNOWN' }),
    );
  });

  it('fences the successful completion with the admitted attempt', async () => {
    const result = await executeInboundSecretaryInvocation(input);

    expect(result).toMatchObject({
      status: 'completed',
      outboundMessageId: 'outbound-1',
      deduplicated: false,
    });
    expect(mocks.complete).toHaveBeenCalledWith(
      'inbound:message-1',
      expect.objectContaining({ resultRef: 'outbound-1', expectedAttemptCount: 1 }),
    );
  });
});
