import { ok, err, type Result, withSpan, setSpanAttribute } from '@cvg/shared';
import { AppError } from '@cvg/shared';
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
  return withSpan('handoff.trigger', async (_span) => {
    try {
      setSpanAttribute('conversation.id', input.conversationId);
      setSpanAttribute('handoff.previous_handler', input.previousHandler);
      setSpanAttribute('handoff.new_handler', input.newHandler);
      setSpanAttribute('handoff.reason', input.reason);
      if (input.triggeredBy) setSpanAttribute('handoff.triggered_by', input.triggeredBy);

      if (!input.conversationId) {
        setSpanAttribute('error', true);
        return err(new AppError('Conversation ID is required', 400, 'INVALID_INPUT'));
      }

      if (input.previousHandler === input.newHandler) {
        setSpanAttribute('error', true);
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

      setSpanAttribute('handoff.completed', true);

      return ok({
        conversationId: input.conversationId,
        previousHandler: input.previousHandler,
        newHandler: input.newHandler,
        reason: input.reason,
        triggeredBy: input.triggeredBy,
        timestamp: new Date(),
      });
    } catch (error) {
      setSpanAttribute('error', true);
      setSpanAttribute('error.message', error instanceof Error ? error.message : String(error));
      return err(error as Error);
    }
  });
}
