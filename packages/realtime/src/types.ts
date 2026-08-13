export type RealtimeEventType = 
  | 'connection.established'
  | 'auth.required'
  | 'auth.success'
  | 'auth.error'
  | 'auth.revalidate.error'
  | 'subscribe.error'
  | 'subscription.success'
  | 'conversation.created'
  | 'conversation.updated'
  | 'conversation.status.changed'
  | 'conversation.assigned'
  | 'message.persisted'
  | 'task.created'
  | 'task.updated'
  | 'task.status.changed'
  | 'alert.created'
  | 'alert.updated'
  | 'alert.acknowledged'
  | 'alert.resolved'
  | 'handoff.completed';

export interface RealtimeProjection<T = unknown> {
  type: RealtimeEventType;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  payload: T;
  correlationId?: string;
}

export interface RealtimeMessage {
  event: string;
  data: RealtimeProjection;
}

export interface RealtimeSubscription {
  userId: string;
  channels: string[];
}

export interface RealtimeClient {
  id: string;
  userId?: string;
  subscriptions: Set<string>;
  send(message: RealtimeMessage): void;
  isAlive(): boolean;
}

export interface ChannelAuthResult {
  authorized: boolean;
  userId?: string;
  error?: string;
}
