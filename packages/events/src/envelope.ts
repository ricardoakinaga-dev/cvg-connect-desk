export interface EventEnvelope<T = unknown> {
  event_id: string;
  event_type: string;
  event_version?: number;
  aggregate_type: string;
  aggregate_id: string;
  occurred_at: string;
  payload: T;
  metadata?: Record<string, unknown>;
  correlation_id?: string;
  causation_id?: string;
  version: number;
}

export function createEvent<T>(
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  payload: T,
  options?: {
    correlationId?: string;
    causationId?: string;
    metadata?: Record<string, unknown>;
    eventVersion?: number;
    version?: number;
  }
): EventEnvelope<T> {
  return {
    event_id: crypto.randomUUID(),
    event_type: eventType,
    event_version: options?.eventVersion ?? 1,
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    occurred_at: new Date().toISOString(),
    payload,
    metadata: options?.metadata,
    correlation_id: options?.correlationId,
    causation_id: options?.causationId,
    version: options?.version ?? 1,
  };
}
