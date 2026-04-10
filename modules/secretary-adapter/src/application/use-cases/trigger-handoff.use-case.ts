import { ok, err, type Result } from '@cvg/shared';
import { AppError, NotFoundError } from '@cvg/shared';
import { publishHandoffRequested, publishHandoffCompleted } from './secretary-publisher';

export interface TriggerHandoffInput {
  conversationId: string;
  previousHandler: 'bot' | 'human';
  newHandler: 'bot' | 'human';
  reason: string;
  triggeredBy?: string;
  metadata?: Record<string, unknown>;
}

export interface TriggerHandoffOutput {
  conversationId: string;
  previousHandler: 'bot' | 'human';
  newHandler: 'bot' | 'human';
  reason: string;
  triggeredBy?: string;
  timestamp: Date;
}

export async function triggerHandoff(input: TriggerHandoffInput): Promise<Result<TriggerHandoffOutput, Error>> {
  try {
    if (!input.conversationId) {
      return err(new AppError('Conversation ID is required', 400, 'INVALID_INPUT'));
    }

    if (input.previousHandler === input.newHandler) {
      return err(new AppError('Previous and new handler must be different', 400, 'INVALID_INPUT'));
    }

    await publishHandoffRequested({
      conversationId: input.conversationId,
      previousHandler: input.previousHandler,
      newHandler: input.newHandler,
      reason: input.reason,
      triggeredBy: input.triggeredBy,
      metadata: input.metadata,
    });

    await publishHandoffCompleted({
      conversationId: input.conversationId,
      previousHandler: input.previousHandler,
      newHandler: input.newHandler,
      reason: input.reason,
      triggeredBy: input.triggeredBy,
    });

    return ok({
      conversationId: input.conversationId,
      previousHandler: input.previousHandler,
      newHandler: input.newHandler,
      reason: input.reason,
      triggeredBy: input.triggeredBy,
      timestamp: new Date(),
    });
  } catch (error) {
    return err(error as Error);
  }
}
