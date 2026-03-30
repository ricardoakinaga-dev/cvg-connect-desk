import { ok, err, type Result } from '@cvg/shared';
import { AppError } from '@cvg/shared';
import { invokeSecretary, triggerHandoff } from '@cvg/secretary-adapter';
import { conversationRepository } from '../../infrastructure/repositories/conversation.repository';
import { messageRepository, type Message } from '../../infrastructure/repositories/message.repository';

export interface ProcessMessageWithSecretaryInput {
  conversationId: string;
  messageId: string;
  content: string;
  sender: string;
  evaluateOnly?: boolean;
}

export interface ProcessMessageWithSecretaryOutput {
  classified: boolean;
  classification?: {
    category: 'clinical' | 'commercial' | 'urgent' | 'general';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    confidence: number;
  };
  handoffTriggered: boolean;
  secretaryResponse?: string;
}

export async function processMessageWithSecretary(
  input: ProcessMessageWithSecretaryInput
): Promise<Result<ProcessMessageWithSecretaryOutput, Error>> {
  try {
    const conversation = await conversationRepository.findById(input.conversationId);
    if (!conversation) {
      return err(new AppError('NOT_FOUND', 'Conversation not found', 404));
    }

    const recentMessages = await messageRepository.findRecentByConversationId(input.conversationId, 10);
    const conversationHistory = recentMessages
      .reverse()
      .map((msg: Message) => ({
        role: msg.direction === 'inbound' ? 'user' as const : 'assistant' as const,
        content: msg.content,
      }));

    const currentHandler = conversation.currentHandler; // 'bot' | 'human'

    const secretaryResult = await invokeSecretary({
      conversationId: input.conversationId,
      messageId: input.messageId,
      action: input.evaluateOnly ? 'evaluate' : 'classify',
      content: input.content,
      sender: input.sender,
      conversationHistory,
    });

    if (secretaryResult.isErr()) {
      return ok({
        classified: false,
        handoffTriggered: false,
      });
    }

    const secretaryOutput = secretaryResult.value;

    if (secretaryOutput.shouldHandoff && currentHandler === 'bot') {
      await triggerHandoff({
        conversationId: input.conversationId,
        previousHandler: 'bot',
        newHandler: 'human',
        reason: secretaryOutput.handoffReason || 'Secretary requested handoff',
        metadata: {
          classification: secretaryOutput.classification,
        },
      });
    }

    return ok({
      classified: true,
      classification: secretaryOutput.classification,
      handoffTriggered: secretaryOutput.shouldHandoff && currentHandler === 'bot',
      secretaryResponse: secretaryOutput.response,
    });
  } catch (error) {
    return err(error as Error);
  }
}
