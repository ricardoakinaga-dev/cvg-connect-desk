import { db, schema } from '@cvg/database';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { EventEnvelope } from './envelope';

/**
 * C03 — lease e ACK cercado por proprietário (FROZEN v1.0.1, D-C03-4..8).
 *
 * Garantias implementadas:
 * - claim atômico por (eventId, consumerId) com `FOR UPDATE SKIP LOCKED`;
 *   nunca entrega o mesmo par a dois owners simultâneos;
 * - renewal/ack/nack condicionados a owner+generation (fencing); lease de
 *   geração anterior falha (`stale`) sem efeito colateral;
 * - expiração recuperável: outro owner reclama com `generation + 1`;
 * - retry limitado por consumidor; esgotado ⇒ falha permanente e DLQ em
 *   `dead_letter_events` (idempotente por event+consumer);
 * - fence durável de DLQ (PROD-12): um evento já dead-letter para o consumidor
 *   NÃO é reclamado por nenhum processo, mesmo que outro processo rode com
 *   orçamento de retry maior (config divergente em rolling deploy). O replay
 *   administrativo cria um NOVO event_id e segue normalmente;
 * - `since` é aplicado no predicado do claim (MEDIUM-03): evento descartado
 *   nunca é reservado.
 */

export interface LeaseToken {
  eventId: string;
  consumerId: string;
  owner: string;
  generation: number;
  leaseUntil: Date;
}

export interface ClaimInput {
  consumerId: string;
  owner: string;
  leaseSeconds: number;
  limit: number;
  since?: Date;
  /**
   * Catálogo explícito de tipos de evento do consumidor (PROD-09/BK06). Quando
   * presente, só candidatos desses tipos são reservados — eventos de tipos
   * desconhecidos NÃO são claimados nem ACKados (não somem nem viram DLQ em
   * massa). O worker usa esta lista como contrato de tipos que consome.
   */
  eventTypes?: readonly string[];
}

export interface AckInput {
  eventId: string;
  consumerId: string;
  owner: string;
  generation: number;
}

export interface NackInput extends AckInput {
  error: string;
  /**
   * Causa durável registrada em `dead_letter_events.error_code`
   * (default `NACK_MAX_RETRIES`).
   */
  errorCode?: string;
  /**
   * Falha permanente (poison/malformed/unsupported version/4xx): grava DLQ e
   * encerra o retry do consumidor na MESMA chamada, sem esperar o orçamento.
   */
  permanent?: boolean;
}

export type AckResult = 'acked' | 'stale' | 'not_found';
export type NackResult = 'retry' | 'dead-letter' | 'stale' | 'not_found';

export interface OutboxLeasePort {
  claim(input: ClaimInput): Promise<Array<{ event: EventEnvelope; lease: LeaseToken }>>;
  renew(lease: LeaseToken, leaseSeconds: number): Promise<LeaseToken | null>;
  ack(input: AckInput): Promise<AckResult>;
  nack(input: NackInput): Promise<NackResult>;
}

interface ClaimRow {
  event_id: string;
  consumer_id: string;
  lease_owner: string;
  lease_until: Date | string;
  generation: number;
}

interface NackRow {
  event_id: string;
  retry_count: number;
  event_type: string;
  event_version: number;
  aggregate_type: string;
  aggregate_id: string;
  occurred_at: Date | string;
  payload: unknown;
  metadata: unknown;
  correlation_id: string | null;
  causation_id: string | null;
  version: number;
}

function rowsOf<T>(result: unknown): T[] {
  const rows = (result as { rows?: unknown[] }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

function assertPositiveInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`[outbox-lease] ${name} deve ser inteiro positivo (recebido ${value})`);
  }
}

function safeJsonParse(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function toEnvelope(row: typeof schema.outboxEvents.$inferSelect): EventEnvelope {
  return {
    event_id: row.eventId,
    event_type: row.eventType,
    event_version: row.eventVersion,
    aggregate_type: row.aggregateType,
    aggregate_id: row.aggregateId,
    occurred_at: row.occurredAt.toISOString(),
    payload: safeJsonParse(row.payload),
    metadata: row.metadata ? (safeJsonParse(row.metadata) as Record<string, unknown>) : undefined,
    correlation_id: row.correlationId ?? undefined,
    causation_id: row.causationId ?? undefined,
    version: row.version,
  };
}

export interface PostgresOutboxLeaseOptions {
  maxRetries?: number;
}

export class PostgresOutboxLease implements OutboxLeasePort {
  private readonly maxRetries: number;

  constructor(options: PostgresOutboxLeaseOptions = {}) {
    this.maxRetries = options.maxRetries ?? 3;
  }

  /**
   * Claim atômico em UMA instrução `INSERT ... ON CONFLICT DO UPDATE`:
   * a linha de lease/ack só é criada (ou atualizada) para eventos que a
   * própria chamada reivindica e devolve. Candidatos com lease vigente são
   * filtrados na seleção; conflitos concorrentes são reavaliados pelo
   * `ON CONFLICT` (READ COMMITTED), então um único vencedor recebe cada
   * `(event_id, consumer_id)` — equivalente ao `FOR UPDATE SKIP LOCKED` para
   * a garantia de exclusão mútua. `generation` é 1 na criação e n+1 no
   * reclaim/retry; `since` entra no predicado antes da reserva (MEDIUM-03).
   * Evento com entrada em `dead_letter_events` para o consumidor é excluído
   * permanentemente (fence durável cross-process, independente do orçamento
   * local de retry).
   */
  async claim(input: ClaimInput): Promise<Array<{ event: EventEnvelope; lease: LeaseToken }>> {
    const { consumerId, owner } = input;
    assertPositiveInt(input.limit, 'limit');
    assertPositiveInt(input.leaseSeconds, 'leaseSeconds');
    if (!consumerId || !owner) {
      throw new Error('[outbox-lease] consumerId e owner são obrigatórios');
    }
    if (input.since !== undefined && Number.isNaN(input.since.getTime())) {
      throw new Error('[outbox-lease] since inválido; valide antes de reservar');
    }
    const since = input.since;
    const maxRetries = this.maxRetries;
    const limit = input.limit;
    const eventTypes = input.eventTypes && input.eventTypes.length > 0 ? [...input.eventTypes] : undefined;

    return db.transaction(async (tx) => {
      const claimed = await tx.execute(sql`
        WITH candidate AS (
          SELECT e.event_id
          FROM outbox_events e
          LEFT JOIN outbox_consumer_acks a
            ON a.event_id = e.event_id AND a.consumer_id = ${consumerId}
          WHERE (
            a.event_id IS NULL
            OR (
              a.processed_at IS NULL
              AND a.retry_count < ${maxRetries}
              AND (a.lease_until IS NULL OR a.lease_until <= now())
            )
          )
          ${eventTypes ? sql`AND e.event_type IN (${sql.join(eventTypes.map((eventType) => sql`${eventType}`), sql`, `)})` : sql``}
          ${since ? sql`AND e.occurred_at > ${since.toISOString()}` : sql``}
          AND NOT EXISTS (
            SELECT 1
            FROM dead_letter_events dl
            WHERE dl.original_event_id = e.event_id
              AND dl.consumer_id = ${consumerId}
          )
          ORDER BY e.created_at ASC
          LIMIT ${limit}
        )
        INSERT INTO outbox_consumer_acks (
          event_id, consumer_id, processed_at, retry_count, generation, lease_owner, lease_until, created_at
        )
        SELECT c.event_id, ${consumerId}, NULL, 0, 1, ${owner}, now() + (${input.leaseSeconds} * interval '1 second'), now()
        FROM candidate c
        ON CONFLICT (event_id, consumer_id) DO UPDATE
        SET lease_owner = EXCLUDED.lease_owner,
            lease_until = EXCLUDED.lease_until,
            generation = outbox_consumer_acks.generation + 1
        WHERE outbox_consumer_acks.processed_at IS NULL
          AND outbox_consumer_acks.retry_count < ${maxRetries}
          AND (outbox_consumer_acks.lease_until IS NULL OR outbox_consumer_acks.lease_until <= now())
        RETURNING event_id, consumer_id, lease_owner, lease_until, generation
      `);

      const leases = rowsOf<ClaimRow>(claimed);
      if (leases.length === 0) return [];

      const ids = leases.map((row) => row.event_id);
      const eventRows = await tx
        .select()
        .from(schema.outboxEvents)
        .where(inArray(schema.outboxEvents.eventId, ids))
        .orderBy(asc(schema.outboxEvents.createdAt));

      const byId = new Map(leases.map((row) => [row.event_id, row]));
      return eventRows.map((row) => {
        const rowLease = byId.get(row.eventId)!;
        return {
          event: toEnvelope(row),
          lease: {
            eventId: row.eventId,
            consumerId,
            owner: rowLease.lease_owner,
            generation: rowLease.generation,
            leaseUntil: new Date(rowLease.lease_until),
          },
        };
      });
    });
  }

  /**
   * Renewal condicionado a owner+generation. Retorna null se o lease foi
   * reclamado (generation mudou), pertence a outro owner ou já foi concluído.
   * Também retorna null para token desconhecido (nunca lança).
   */
  async renew(lease: LeaseToken, leaseSeconds: number): Promise<LeaseToken | null> {
    assertPositiveInt(leaseSeconds, 'leaseSeconds');
    const result = await db.execute(sql`
      UPDATE outbox_consumer_acks
      SET lease_until = now() + (${leaseSeconds} * interval '1 second')
      WHERE event_id = ${lease.eventId}
        AND consumer_id = ${lease.consumerId}
        AND lease_owner = ${lease.owner}
        AND generation = ${lease.generation}
        AND processed_at IS NULL
      RETURNING event_id, consumer_id, lease_owner, lease_until, generation
    `);
    const [row] = rowsOf<ClaimRow>(result);
    if (!row) return null;
    return {
      eventId: row.event_id,
      consumerId: row.consumer_id,
      owner: row.lease_owner,
      generation: row.generation,
      leaseUntil: new Date(row.lease_until),
    };
  }

  /**
   * ACK cercado: só conclui quando owner e generation coincidem com o token
   * registrado. Um ACK atrasado da MESMA geração (lease expirado sem reclaim)
   * ainda conclui — o fencing só muda em reclaim; geração anterior/owner
   * diferente ⇒ `stale` sem marcar processado e sem tocar retry; par nunca
   * reclamado ⇒ `not_found`. ACK repetido do mesmo token é idempotente.
   */
  async ack(input: AckInput): Promise<AckResult> {
    const result = await db.execute(sql`
      UPDATE outbox_consumer_acks
      SET processed_at = now(),
          retry_count = 0,
          last_error = NULL,
          lease_until = now()
      WHERE event_id = ${input.eventId}
        AND consumer_id = ${input.consumerId}
        AND lease_owner = ${input.owner}
        AND generation = ${input.generation}
        AND processed_at IS NULL
      RETURNING event_id
    `);
    if (rowsOf<{ event_id: string }>(result).length > 0) return 'acked';

    const [row] = await db
      .select({
        processedAt: schema.outboxConsumerAcks.processedAt,
        leaseOwner: schema.outboxConsumerAcks.leaseOwner,
        generation: schema.outboxConsumerAcks.generation,
      })
      .from(schema.outboxConsumerAcks)
      .where(
        and(
          eq(schema.outboxConsumerAcks.eventId, input.eventId),
          eq(schema.outboxConsumerAcks.consumerId, input.consumerId),
        ),
      )
      .limit(1);

    if (!row) return 'not_found';
    if (row.processedAt && row.leaseOwner === input.owner && row.generation === input.generation) {
      return 'acked';
    }
    return 'stale';
  }

  /**
   * NACK cercado: incrementa retry apenas com owner+generation vigentes,
   * libera o lease (retry imediato) e, ao atingir maxRetries, grava DLQ
   * durável em `dead_letter_events` na mesma transação e retorna
   * `dead-letter`. Lease de geração anterior ⇒ `stale` sem incrementar retry.
   *
   * `permanent: true` (PROD-09/C04) encerra o orçamento na MESMA chamada
   * (`retry_count = maxRetries`) e grava a DLQ imediatamente — poison,
   * malformed e versão não suportada não consomem retries.
   *
   * A DLQ guarda o ENVELOPE íntegro (`event_id`, `event_type`,
   * `aggregate_*`, `occurred_at`, `payload`, correlação/causa, `version`) para
   * replay administrativo; antes gravava só o payload cru. `error_code`
   * distingue a causa (`UNSUPPORTED_EVENT_VERSION`, `MALFORMED_PAYLOAD`, …).
   */
  async nack(input: NackInput): Promise<NackResult> {
    const maxRetries = this.maxRetries;
    const error = input.error || 'unknown error';
    const permanent = input.permanent === true;
    const errorCode = input.errorCode || 'NACK_MAX_RETRIES';

    return db.transaction(async (tx) => {
      const updated = await tx.execute(sql`
        UPDATE outbox_consumer_acks a
        SET retry_count = CASE WHEN ${permanent} THEN ${maxRetries} ELSE a.retry_count + 1 END,
            last_error = ${error},
            lease_owner = NULL,
            lease_until = NULL
        FROM outbox_events e
        WHERE a.event_id = ${input.eventId}
          AND a.consumer_id = ${input.consumerId}
          AND a.event_id = e.event_id
          AND a.lease_owner = ${input.owner}
          AND a.generation = ${input.generation}
          AND a.processed_at IS NULL
        RETURNING a.event_id, a.retry_count,
                  e.event_type, e.event_version, e.aggregate_type, e.aggregate_id,
                  e.occurred_at, e.payload, e.metadata, e.correlation_id,
                  e.causation_id, e.version
      `);

      const [row] = rowsOf<NackRow>(updated);
      if (!row) {
        const [existing] = await tx
          .select({ eventId: schema.outboxConsumerAcks.eventId })
          .from(schema.outboxConsumerAcks)
          .where(
            and(
              eq(schema.outboxConsumerAcks.eventId, input.eventId),
              eq(schema.outboxConsumerAcks.consumerId, input.consumerId),
            ),
          )
          .limit(1);
        return existing ? 'stale' : 'not_found';
      }

      if (row.retry_count >= maxRetries) {
        const envelope = {
          event_id: row.event_id,
          event_type: row.event_type,
          event_version: row.event_version,
          aggregate_type: row.aggregate_type,
          aggregate_id: row.aggregate_id,
          occurred_at: new Date(row.occurred_at).toISOString(),
          payload: safeJsonParse(row.payload),
          metadata: row.metadata ? safeJsonParse(row.metadata) : undefined,
          correlation_id: row.correlation_id ?? undefined,
          causation_id: row.causation_id ?? undefined,
          version: row.version,
        };

        await tx
          .insert(schema.deadLetterEvents)
          .values({
            originalEventId: input.eventId,
            consumerId: input.consumerId,
            eventType: row.event_type,
            payload: envelope,
            errorCode,
            errorMessage: error,
            attemptCount: row.retry_count,
          })
          .onConflictDoUpdate({
            target: [schema.deadLetterEvents.originalEventId, schema.deadLetterEvents.consumerId],
            set: {
              attemptCount: row.retry_count,
              errorMessage: error,
              lastFailedAt: new Date(),
              updatedAt: new Date(),
            },
            setWhere: eq(schema.deadLetterEvents.status, 'PENDING'),
          });
        return 'dead-letter';
      }

      return 'retry';
    });
  }
}

/** Instância compartilhada (maxRetries default 3, alinhado ao worker). */
export const postgresOutboxLease = new PostgresOutboxLease();
