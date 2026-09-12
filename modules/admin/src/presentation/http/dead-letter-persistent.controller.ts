import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requirePermission } from '@cvg/auth';
import { createAuditLog } from '@cvg/audit';
import {
  persistentDeadLetterStore,
  publishToOutbox,
  type EventEnvelope,
} from '@cvg/events';

/**
 * Persistent Dead Letter API (Final-1).
 * Backed por PostgreSQL — sobrevive a restart.
 * Replay/resolve/discard exigem admin:write e geram audit log.
 */

function serialize(entry: unknown) {
  return entry;
}

function isEventEnvelope(payload: unknown): payload is EventEnvelope {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return (
    typeof p.event_id === 'string' &&
    typeof p.event_type === 'string' &&
    typeof p.aggregate_type === 'string' &&
    typeof p.aggregate_id === 'string' &&
    typeof p.occurred_at === 'string' &&
    typeof p.version === 'number'
  );
}

export async function registerPersistentDeadLetterRoutes(app: FastifyInstance) {
  app.get(
    '/dead-letter',
    {
      preHandler: [authenticate, requirePermission('admin:read')],
      schema: {
        description: 'Lista eventos na DLQ persistente (PostgreSQL)',
        tags: ['DeadLetter'],
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['PENDING', 'REPLAYING', 'RESOLVED', 'DISCARDED'] },
            consumerId: { type: 'string' },
            eventType: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
    },
    async (request) => {
      const query = request.query as {
        status?: 'PENDING' | 'REPLAYING' | 'RESOLVED' | 'DISCARDED';
        consumerId?: string;
        eventType?: string;
        limit?: number;
        offset?: number;
      };
      const [entries, byStatus, oldest] = await Promise.all([
        persistentDeadLetterStore.list({
          status: query.status,
          consumerId: query.consumerId,
          eventType: query.eventType,
          limit: query.limit,
          offset: query.offset,
        }),
        persistentDeadLetterStore.countByStatus(),
        persistentDeadLetterStore.oldestPendingAge(),
      ]);
      return { data: entries.map(serialize), stats: { byStatus, pending: oldest } };
    },
  );

  app.get(
    '/dead-letter/:id',
    {
      preHandler: [authenticate, requirePermission('admin:read')],
      schema: {
        description: 'Inspeciona uma entrada da DLQ persistente',
        tags: ['DeadLetter'],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const entry = await persistentDeadLetterStore.getById(request.params.id);
      if (!entry) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Dead-letter entry not found' });
      }
      return serialize(entry);
    },
  );

  app.post(
    '/dead-letter/:id/replay',
    {
      preHandler: [authenticate, requirePermission('admin:write')],
      schema: {
        description: 'Replay idempotente de uma entrada (claim atômico; 409 em duplicata)',
        tags: ['DeadLetter'],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const claimed = await persistentDeadLetterStore.claimForReplay(request.params.id);
      if (!claimed) {
        const existing = await persistentDeadLetterStore.getById(request.params.id);
        if (!existing) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'Dead-letter entry not found' });
        }
        return reply.status(409).send({
          error: 'CONFLICT',
          reason: 'not_replayable',
          message: `Entry is ${existing.status}, only PENDING can be replayed`,
        });
      }

      if (!isEventEnvelope(claimed.payload)) {
        await persistentDeadLetterStore.markReplayFailed(claimed.id, 'stored payload is not a replayable event envelope');
        return reply.status(422).send({
          error: 'UNPROCESSABLE',
          reason: 'corrupted_payload',
          message: 'Stored payload cannot be republished as an event',
        });
      }

      const replayed: EventEnvelope = {
        ...claimed.payload,
        event_id: `${claimed.originalEventId}-replay-${claimed.replayCount + 1}`,
        occurred_at: new Date().toISOString(),
        causation_id: claimed.originalEventId,
        metadata: {
          ...(claimed.payload.metadata || {}),
          replayedFromDeadLetter: claimed.id,
          replayCount: claimed.replayCount + 1,
        },
      };

      try {
        await publishToOutbox(replayed);
      } catch (error) {
        await persistentDeadLetterStore.markReplayFailed(
          claimed.id,
          error instanceof Error ? error.message : String(error),
        );
        request.log.error({ err: error, id: claimed.id }, 'Failed to republish dead-letter event');
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to republish event' });
      }

      const done = await persistentDeadLetterStore.markReplayed(claimed.id);
      await createAuditLog({
        userId: request.user?.id,
        action: 'dlq.replay',
        entityType: 'dead-letter',
        metadata: { entryId: claimed.id, originalEventId: claimed.originalEventId, replayEventId: replayed.event_id },
      });
      return reply.status(200).send({ success: true, replayed: true, entry: serialize(done) });
    },
  );

  app.post(
    '/dead-letter/replay-batch',
    {
      preHandler: [authenticate, requirePermission('admin:write')],
      schema: {
        description: 'Replay em lote de entradas PENDING (com filtros)',
        tags: ['DeadLetter'],
        body: {
          type: 'object',
          properties: {
            consumerId: { type: 'string' },
            eventType: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: { consumerId?: string; eventType?: string; limit?: number } }>, reply: FastifyReply) => {
      const { consumerId, eventType, limit } = request.body || {};
      const claimed = await persistentDeadLetterStore.claimBatch({ consumerId, eventType, limit });
      const results: Array<{ id: string; ok: boolean; reason?: string }> = [];

      for (const entry of claimed) {
        if (!isEventEnvelope(entry.payload)) {
          await persistentDeadLetterStore.markReplayFailed(entry.id, 'stored payload is not a replayable event envelope');
          results.push({ id: entry.id, ok: false, reason: 'corrupted_payload' });
          continue;
        }
        const replayed: EventEnvelope = {
          ...entry.payload,
          event_id: `${entry.originalEventId}-replay-${entry.replayCount + 1}`,
          occurred_at: new Date().toISOString(),
          causation_id: entry.originalEventId,
          metadata: { ...(entry.payload.metadata || {}), replayedFromDeadLetter: entry.id },
        };
        try {
          await publishToOutbox(replayed);
          await persistentDeadLetterStore.markReplayed(entry.id);
          results.push({ id: entry.id, ok: true });
        } catch (error) {
          await persistentDeadLetterStore.markReplayFailed(entry.id, error instanceof Error ? error.message : String(error));
          results.push({ id: entry.id, ok: false, reason: 'republish_failed' });
        }
      }

      await createAuditLog({
        userId: request.user?.id,
        action: 'dlq.replay',
        entityType: 'dead-letter',
        metadata: {
          mode: 'batch',
          consumerId,
          eventType,
          replayed: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
        },
      });
      return reply.status(200).send({ success: true, results });
    },
  );

  app.post(
    '/dead-letter/:id/resolve',
    {
      preHandler: [authenticate, requirePermission('admin:write')],
      schema: {
        description: 'Marca entrada como resolvida manualmente',
        tags: ['DeadLetter'],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: { reason: { type: 'string', maxLength: 500 } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string }; Body: { reason?: string } }>, reply: FastifyReply) => {
      const entry = await persistentDeadLetterStore.resolve(request.params.id, request.user?.id, request.body?.reason);
      if (!entry) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Dead-letter entry not found' });
      }
      await createAuditLog({
        userId: request.user?.id,
        action: 'dlq.resolve',
        entityType: 'dead-letter',
        metadata: { entryId: entry.id, reason: request.body?.reason },
      });
      return reply.status(200).send({ success: true, entry: serialize(entry) });
    },
  );

  app.post(
    '/dead-letter/:id/discard',
    {
      preHandler: [authenticate, requirePermission('admin:write')],
      schema: {
        description: 'Descarta entrada conscientemente (auditado)',
        tags: ['DeadLetter'],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: { reason: { type: 'string', maxLength: 500 } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string }; Body: { reason?: string } }>, reply: FastifyReply) => {
      const entry = await persistentDeadLetterStore.discard(request.params.id, request.user?.id, request.body?.reason);
      if (!entry) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Dead-letter entry not found' });
      }
      await createAuditLog({
        userId: request.user?.id,
        action: 'dlq.resolve',
        entityType: 'dead-letter',
        metadata: { entryId: entry.id, discarded: true, reason: request.body?.reason },
      });
      return reply.status(200).send({ success: true, entry: serialize(entry) });
    },
  );
}
