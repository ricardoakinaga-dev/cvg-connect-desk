import { z } from 'zod';

/**
 * CanonicalEventEnvelopeV1 — envelope de eventos inter-processo (outbox).
 * Campos de rastreabilidade propagados por worker/realtime/polling.
 */
export const CanonicalEventEnvelopeV1Schema = z.object({
  specVersion: z.literal('1.0.0'),
  eventId: z.string().min(1).max(256),
  eventType: z.string().min(1).max(128),
  eventVersion: z.number().int().positive().default(1),
  occurredAt: z.coerce.date(),
  source: z.string().min(1).max(64),
  provider: z.string().max(64).optional(),
  instanceId: z.string().max(128).optional(),
  aggregateType: z.string().min(1).max(64),
  aggregateId: z.string().min(1).max(256),
  correlationId: z.string().max(256).optional(),
  causationId: z.string().max(256).optional(),
  traceId: z.string().max(256).optional(),
  payload: z.unknown(),
});

export type CanonicalEventEnvelopeV1 = z.infer<typeof CanonicalEventEnvelopeV1Schema>;
