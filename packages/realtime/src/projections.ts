import type { EventEnvelope } from '@cvg/events';
import type { RealtimeProjection, RealtimeEventType } from './types';

export interface ConversationPayload {
  id: string;
  status: string;
  assignedTo?: string;
  contactId?: string;
  externalChannelId?: string;
}

export interface MessagePayload {
  id: string;
  conversationId: string;
  direction: 'inbound' | 'outbound';
  content: string;
  sender?: string;
  status: string;
  createdAt: string;
}

export interface TaskPayload {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignedTo?: string;
  conversationId?: string;
}

export interface AlertPayload {
  id: string;
  type: string;
  title: string;
  status: string;
  severity: string;
  conversationId?: string;
  taskId?: string;
}

export interface HandoffPayload {
  conversationId: string;
  previousHandler: 'bot' | 'human';
  newHandler: 'bot' | 'human';
  reason: string;
  triggeredBy?: string;
}

export function projectEvent(event: EventEnvelope): RealtimeProjection | null {
  const { event_type, aggregate_type, aggregate_id, occurred_at, payload, correlation_id } = event;

  switch (event_type) {
    case 'conversation.created':
      return projectConversationCreated(event as EventEnvelope<{ id: string; status: string; contactId?: string }>);
    case 'conversation.status.changed':
      return projectConversationStatusChanged(event as EventEnvelope<{ conversationId: string; previousStatus: string; newStatus: string }>);
    case 'message.persisted':
      return projectMessagePersisted(event as EventEnvelope<MessagePayload>);
    case 'task.created':
    case 'task.updated':
    case 'task.status.changed':
      return projectTaskEvent(event_type as RealtimeEventType, event);
    case 'alert.created':
    case 'alert.updated':
    case 'alert.acknowledged':
    case 'alert.resolved':
      return projectAlertEvent(event_type as RealtimeEventType, event);
    case 'handoff.completed':
      return projectHandoffCompleted(event as EventEnvelope<HandoffPayload>);
    case 'conversation.assigned':
      return projectConversationAssigned(event as EventEnvelope<{ conversationId: string; previousAssignee?: string; newAssignee: string }>);
    default:
      return null;
  }
}

function projectConversationCreated(event: EventEnvelope<{ id: string; status: string; contactId?: string }>): RealtimeProjection {
  return {
    type: 'conversation.created',
    aggregateType: 'Conversation',
    aggregateId: event.payload.id,
    occurredAt: event.occurred_at,
    payload: {
      id: event.payload.id,
      status: event.payload.status,
      contactId: event.payload.contactId,
    },
    correlationId: event.correlation_id,
  };
}

function projectConversationStatusChanged(event: EventEnvelope<{ conversationId: string; previousStatus: string; newStatus: string }>): RealtimeProjection {
  return {
    type: 'conversation.status.changed',
    aggregateType: 'Conversation',
    aggregateId: event.payload.conversationId,
    occurredAt: event.occurred_at,
    payload: {
      id: event.payload.conversationId,
      status: event.payload.newStatus,
    },
    correlationId: event.correlation_id,
  };
}

function projectMessagePersisted(event: EventEnvelope<MessagePayload>): RealtimeProjection {
  return {
    type: 'message.persisted',
    aggregateType: 'Message',
    aggregateId: event.payload.id,
    occurredAt: event.occurred_at,
    payload: event.payload,
    correlationId: event.correlation_id,
  };
}

function projectTaskEvent(eventType: RealtimeEventType, event: EventEnvelope): RealtimeProjection {
  return {
    type: eventType,
    aggregateType: 'Task',
    aggregateId: event.aggregate_id,
    occurredAt: event.occurred_at,
    payload: event.payload,
    correlationId: event.correlation_id,
  };
}

function projectAlertEvent(eventType: RealtimeEventType, event: EventEnvelope): RealtimeProjection {
  return {
    type: eventType,
    aggregateType: 'Alert',
    aggregateId: event.aggregate_id,
    occurredAt: event.occurred_at,
    payload: event.payload,
    correlationId: event.correlation_id,
  };
}

function projectHandoffCompleted(event: EventEnvelope<HandoffPayload>): RealtimeProjection {
  return {
    type: 'handoff.completed',
    aggregateType: 'Conversation',
    aggregateId: event.payload.conversationId,
    occurredAt: event.occurred_at,
    payload: event.payload,
    correlationId: event.correlation_id,
  };
}

function projectConversationAssigned(event: EventEnvelope<{ conversationId: string; previousAssignee?: string; newAssignee: string }>): RealtimeProjection {
  return {
    type: 'conversation.assigned',
    aggregateType: 'Conversation',
    aggregateId: event.payload.conversationId,
    occurredAt: event.occurred_at,
    payload: {
      conversationId: event.payload.conversationId,
      previousAssignee: event.payload.previousAssignee,
      newAssignee: event.payload.newAssignee,
    },
    correlationId: event.correlation_id,
  };
}

export function shouldProject(event: EventEnvelope): boolean {
  const projectableTypes = [
    'conversation.created',
    'conversation.status.changed',
    'conversation.assigned',
    'message.persisted',
    'task.created',
    'task.updated',
    'task.status.changed',
    'alert.created',
    'alert.updated',
    'alert.acknowledged',
    'alert.resolved',
    'handoff.completed',
  ];
  
  return projectableTypes.includes(event.event_type);
}
