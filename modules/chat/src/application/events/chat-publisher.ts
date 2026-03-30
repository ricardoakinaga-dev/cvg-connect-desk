import { eventPublisher, createMessagePersistedEvent, createConversationCreatedEvent, createConversationStatusChangedEvent } from '@cvg/events';

export async function publishMessagePersisted(message: {
  id: string;
  conversationId: string;
  direction: 'inbound' | 'outbound';
  content: string;
  sender?: string;
  recipient?: string;
  status: string;
  createdAt: Date;
}) {
  const event = createMessagePersistedEvent({
    messageId: message.id,
    conversationId: message.conversationId,
    direction: message.direction,
    content: message.content,
    sender: message.sender,
    recipient: message.recipient,
    status: message.status,
    createdAt: message.createdAt.toISOString(),
  });
  await eventPublisher.publish(event);
}

export async function publishConversationCreated(conversation: {
  id: string;
  contactId: string | null;
  externalConversationId: string | null;
  externalChannelId: string | null;
  interactionType: string | null;
  createdAt: Date;
}) {
  const event = createConversationCreatedEvent({
    conversationId: conversation.id,
    contactId: conversation.contactId ?? undefined,
    externalConversationId: conversation.externalConversationId ?? undefined,
    externalChannelId: conversation.externalChannelId ?? undefined,
    interactionType: conversation.interactionType ?? undefined,
    createdAt: conversation.createdAt.toISOString(),
  });
  await eventPublisher.publish(event);
}

export async function publishConversationStatusChanged(conversationId: string, previousStatus: string, newStatus: string, changedBy?: string, reason?: string) {
  const event = createConversationStatusChangedEvent({
    conversationId,
    previousStatus,
    newStatus,
    changedBy,
    reason,
    changedAt: new Date().toISOString(),
  });
  await eventPublisher.publish(event);
}
