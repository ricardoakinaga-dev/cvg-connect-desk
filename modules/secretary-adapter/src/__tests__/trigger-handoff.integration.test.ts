import type { Err, Ok, Result } from '@cvg/shared';
import { AppError } from '@cvg/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../application/use-cases/secretary-publisher', () => ({
  publishHandoffRequested: vi.fn().mockResolvedValue(undefined),
  publishHandoffCompleted: vi.fn().mockResolvedValue(undefined),
}));

import { publishHandoffCompleted, publishHandoffRequested } from '../application/use-cases/secretary-publisher';
import { triggerHandoff } from '../application/use-cases/trigger-handoff.use-case';

function assertOk<T, E>(result: Result<T, E>): asserts result is Ok<T, E> {
  expect(result.isOk()).toBe(true);
}

function assertErr<T>(result: Result<T, AppError>): asserts result is Err<T, AppError> {
  expect(result.isErr()).toBe(true);
}

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

    assertOk(result);
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

    assertErr(result);
    expect(result.error.message).toBe('Previous and new handler must be different');
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(publishHandoffRequested).not.toHaveBeenCalled();
    expect(publishHandoffCompleted).not.toHaveBeenCalled();
  });

  it('embrulha erro desconhecido no catch como HANDOFF_ERROR 500', async () => {
    vi.mocked(publishHandoffRequested).mockImplementationOnce(() => {
      throw new Error('broker down');
    });

    const result = await triggerHandoff({
      conversationId: 'conversation-unknown-error',
      previousHandler: 'bot',
      newHandler: 'human',
      reason: 'Falha inesperada ao publicar',
    });

    assertErr(result);
    expect(result.error).toBeInstanceOf(AppError);
    expect(result.error.statusCode).toBe(500);
    expect(result.error.code).toBe('HANDOFF_ERROR');
    expect(result.error.message).toBe('broker down');
    expect(publishHandoffCompleted).not.toHaveBeenCalled();
  });

  it('preserva AppError lançado dentro do try (passthrough do catch)', async () => {
    const brokerError = new AppError('broker down', 503, 'BROKER_DOWN');
    vi.mocked(publishHandoffRequested).mockImplementationOnce(() => {
      throw brokerError;
    });

    const result = await triggerHandoff({
      conversationId: 'conversation-app-error',
      previousHandler: 'bot',
      newHandler: 'human',
      reason: 'Falha tipada ao publicar',
    });

    assertErr(result);
    expect(result.error).toBe(brokerError);
    expect(result.error.statusCode).toBe(503);
  });

  it('rejeita conversationId ausente com INVALID_INPUT antes de publicar', async () => {
    const result = await triggerHandoff({
      conversationId: '',
      previousHandler: 'bot',
      newHandler: 'human',
      reason: 'Sem conversa',
    });

    assertErr(result);
    expect(result.error.statusCode).toBe(400);
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.error.message).toBe('Conversation ID is required');
    expect(publishHandoffRequested).not.toHaveBeenCalled();
  });
});
