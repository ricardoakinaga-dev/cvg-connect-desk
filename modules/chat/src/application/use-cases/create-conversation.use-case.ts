import { conversationRepository, type NewConversation } from '../../infrastructure/repositories/conversation.repository';
import { ok, err, type Result } from '@cvg/shared';

export interface CreateConversationInput {
  contactId?: string;
  externalConversationId?: string;
  externalChannelId?: string;
  interactionType?: 'clinical' | 'commercial' | 'urgent';
  queueId?: string;
  teamId?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateConversationOutput {
  id: string;
  contactId: string | null;
  status: string;
  createdAt: Date;
}

export async function createConversation(
  input: CreateConversationInput
): Promise<Result<CreateConversationOutput>> {
  try {
    const conversationData: NewConversation = {
      contactId: input.contactId,
      externalConversationId: input.externalConversationId,
      externalChannelId: input.externalChannelId,
      interactionType: input.interactionType,
      queueId: input.queueId,
      teamId: input.teamId,
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
      status: 'open',
      isActive: true,
    };

    const conversation = await conversationRepository.create(conversationData);

    await conversationRepository.addStatusHistory(
      conversation.id,
      'open',
      undefined,
      'Conversation created'
    );

    return ok({
      id: conversation.id,
      contactId: conversation.contactId,
      status: conversation.status,
      createdAt: conversation.createdAt,
    });
  } catch (error) {
    return err(error as Error);
  }
}
