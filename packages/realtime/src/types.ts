export type RealtimeEventType = 
  | 'connection.established'
  | 'auth.success'
  | 'auth.error'
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

/**
 * Formato unificado para websocket:
 * O frontend espera { event_type, payload, occurred_at }
 * O servidor envia neste mesmo formato para manter contrato estável.
 */
export interface RealtimeMessage {
  event_type: RealtimeEventType;
  payload: Record<string, unknown>;
  occurred_at: string;
  correlation_id?: string;
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
