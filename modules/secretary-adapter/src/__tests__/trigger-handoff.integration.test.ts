import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../application/use-cases/secretary-publisher', () => ({
  publishHandoffRequested: vi.fn().mockResolvedValue(undefined),
  publishHandoffCompleted: vi.fn().mockResolvedValue(undefined),
}));

import { publishHandoffCompleted, publishHandoffRequested } from '../application/use-cases/secretary-publisher';
import { triggerHandoff } from '../application/use-cases/trigger-handoff.use-case';

describe('triggerHandoff integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('publishes handoff.requested and handoff.completed in sequence', async () => {
    const result = await triggerHandoff({
      conversationId: 'conversation-123',
      previousHandler: 'bot',
      newHandler: 'human',
      reason: 'Secretary pediu atendimento humano',
      triggeredBy: 'secretary',
      metadata: {
        classification: {
          category: 'urgent',
          confidence: 0.93,
        },
        messageId: 'message-123',
      },
    });

    expect(result.isOk()).toBe(true);
    expect(result.value).toMatchObject({
      conversationId: 'conversation-123',
      previousHandler: 'bot',
      newHandler: 'human',
      reason: 'Secretary pediu atendimento humano',
      triggeredBy: 'secretary',
    });

    expect(publishHandoffRequested).toHaveBeenCalledTimes(1);
    expect(publishHandoffCompleted).toHaveBeenCalledTimes(1);
    expect(vi.mocked(publishHandoffRequested)).toHaveBeenCalledWith({
      conversationId: 'conversation-123',
      previousHandler: 'bot',
      newHandler: 'human',
      reason: 'Secretary pediu atendimento humano',
      triggeredBy: 'secretary',
      metadata: {
        classification: {
          category: 'urgent',
          confidence: 0.93,
        },
        messageId: 'message-123',
      },
    });
    expect(vi.mocked(publishHandoffCompleted)).toHaveBeenCalledWith({
      conversationId: 'conversation-123',
      previousHandler: 'bot',
      newHandler: 'human',
      reason: 'Secretary pediu atendimento humano',
      triggeredBy: 'secretary',
    });
  });

  it('rejects invalid handoff transitions before publishing events', async () => {
    const result = await triggerHandoff({
      conversationId: 'conversation-456',
      previousHandler: 'human',
      newHandler: 'human',
      reason: 'Transição inválida',
    });

    expect(result.isErr()).toBe(true);
    expect(result.error.message).toBe('Previous and new handler must be different');
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(publishHandoffRequested).not.toHaveBeenCalled();
    expect(publishHandoffCompleted).not.toHaveBeenCalled();
  });
});
