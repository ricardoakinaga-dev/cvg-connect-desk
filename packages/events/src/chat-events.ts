import { createEvent, type EventEnvelope } from './envelope';

export interface MessageInboundPayload {
  messageId: string;
  conversationId: string;
  content: string;
  sender: string;
  senderType?: string;
  externalMessageId: string;
  sentAt: string;
}

export interface MessagePersistedPayload {
  messageId: string;
  conversationId: string;
  direction: 'inbound' | 'outbound';
  content: string;
  sender?: string;
  recipient?: string;
  status: string;
  createdAt: string;
}

export interface ConversationCreatedPayload {
  conversationId: string;
  contactId?: string;
  externalConversationId?: string;
  externalChannelId?: string;
  interactionType?: string;
  createdAt: string;
}

export interface ConversationStatusChangedPayload {
  conversationId: string;
  previousStatus: string;
  newStatus: string;
  changedBy?: string;
  reason?: string;
  changedAt: string;
}

export type MessageInboundEvent = EventEnvelope<MessageInboundPayload>;
export type MessagePersistedEvent = EventEnvelope<MessagePersistedPayload>;
export type ConversationCreatedEvent = EventEnvelope<ConversationCreatedPayload>;
export type ConversationStatusChangedEvent = EventEnvelope<ConversationStatusChangedPayload>;

export function createMessageInboundEvent(payload: MessageInboundPayload, correlationId?: string): MessageInboundEvent {
  return createEvent('message.inbound.received', 'Message', payload.messageId, payload, { correlationId });
}

export function createMessagePersistedEvent(payload: MessagePersistedPayload, correlationId?: string): MessagePersistedEvent {
  return createEvent('message.persisted', 'Message', payload.messageId, payload, { correlationId });
}

export function createConversationCreatedEvent(payload: ConversationCreatedPayload, correlationId?: string): ConversationCreatedEvent {
  return createEvent('conversation.created', 'Conversation', payload.conversationId, payload, { correlationId });
}

export function createConversationStatusChangedEvent(payload: ConversationStatusChangedPayload, correlationId?: string): ConversationStatusChangedEvent {
  return createEvent('conversation.status.changed', 'Conversation', payload.conversationId, payload, { correlationId });
}
