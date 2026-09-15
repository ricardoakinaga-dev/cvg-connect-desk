import { db, schema } from '@cvg/database';
import { and, eq, ne, sql } from 'drizzle-orm';
import { AIBudgetExhaustedError } from '../../application/ai-policy';

/**
 * PROD-10 / C04 — estado durável da invocação assíncrona da Secretary.
 *
 * A chave (`invocation_key`) é estável por mensagem (`inbound:<messageId>`):
 * replay/crash do evento durável encontram o MESMO registro, então:
 *  - `completed` ⇒ o chamador não reexecuta a IA (dedup do efeito);
 *  - `processing` visível durante a chamada externa (observabilidade);
 *  - `failed` preserva causa para retry/DLQ; `unknown` é terminal até
 *    reconciliação explícita do provider.
 *
 * PROD-13 / C08 — `denied` é o terminal do BLOQUEIO de orçamento por conversa:
 * a mensagem não chama a IA, o fato fica durável (sem PII) e NÃO conta como
 * invocação admitida. A admissão (`beginSecretaryInvocation`) é serializada por
 * `pg_advisory_xact_lock` por conversa e conta as invocações já admitidas na
 * MESMA transação — duas chamadas concorrentes não furam `maxInvocations`, com
 * contagem sobrevivendo a restart (fonte: `secretary_invocations` em PG).
 *
 * O padrão de recibo é o mesmo do PROD-09: transição atômica na MESMA
 * transação; nunca há duas invocações lógicas admitidas da mesma mensagem.
 */
export type SecretaryInvocationStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'unknown' | 'denied';

export interface SecretaryInvocationRecord {
  id: string;
  invocationKey: string;
  conversationId: string;
  messageId: string | null;
  eventId: string | null;
  consumerId: string | null;
  action: string;
  status: SecretaryInvocationStatus;
  attemptCount: number;
  lastError: string | null;
  errorCode: string | null;
  resultRef: string | null;
  detail: unknown;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

type SecretaryInvocationRow = typeof schema.secretaryInvocations.$inferSelect;

function toRecord(row: SecretaryInvocationRow): SecretaryInvocationRecord {
  return {
    id: row.id,
    invocationKey: row.invocationKey,
    conversationId: row.conversationId,
    messageId: row.messageId ?? null,
    eventId: row.eventId ?? null,
    consumerId: row.consumerId ?? null,
    action: row.action,
    status: row.status as SecretaryInvocationStatus,
    attemptCount: row.attemptCount,
    lastError: row.lastError ?? null,
    errorCode: row.errorCode ?? null,
    resultRef: row.resultRef ?? null,
    detail: row.detail ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt ?? null,
  };
}

export interface BeginSecretaryInvocationInput {
  invocationKey: string;
  conversationId: string;
  messageId: string;
  eventId: string;
  consumerId: string;
  action?: string;
  /**
   * PROD-13/AC1 — teto de invocações ADMITIDAS por conversa (durable budget).
   * A admissão atômica é feita aqui; `undefined` desabilita o teto apenas para
   * chamadores internos de migração/teste — o fluxo produtivo SEMPRE passa o
   * limite efetivo (`getAIBudgetLimits().maxInvocationsPerConversation`).
   */
  maxInvocations?: number;
}

export interface BeginSecretaryInvocationResult {
  record: SecretaryInvocationRecord;
  /** Resultado da admissão sem reexecutar uma invocação já em andamento/terminal. */
  outcome: 'started' | 'completed' | 'unknown' | 'in_progress';
  /** `true` quando a invocação JÁ concluiu — o chamador não deve reexecutar. */
  alreadyCompleted: boolean;
}

type BeginOutcome =
  | { kind: 'started'; record: SecretaryInvocationRecord }
  | { kind: 'completed'; record: SecretaryInvocationRecord }
  | { kind: 'unknown'; record: SecretaryInvocationRecord }
  | { kind: 'in_progress'; record: SecretaryInvocationRecord }
  | { kind: 'denied'; record: SecretaryInvocationRecord };

/**
 * Abre (ou retoma) a invocação sob ORÇAMENTO DURÁVEL por conversa:
 *  - novo `invocation_key` ⇒ conta as invocações admitidas da conversa sob
 *    `pg_advisory_xact_lock` (serializa concorrentes) e, no limite exato,
 *    grava o terminal `denied` e lança `AIBudgetExhaustedError` (403);
 *  - `invocation_key` existente ⇒ retoma (ou deduplica) SEM consumir orçamento
 *    de novo, então retry/crash/replay não gastam o teto.
 * Duas chamadas concorrentes com limite 1: exatamente uma é admitida.
 */
export async function beginSecretaryInvocation(
  input: BeginSecretaryInvocationInput,
): Promise<BeginSecretaryInvocationResult> {
  const outcome = await db.transaction(async (tx): Promise<BeginOutcome> => {
    // Lock transacional por conversa: a contagem e a admissão são serializadas
    // mesmo com workers/transações concorrentes (o lock cai no commit/rollback).
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtext('cvg:secretary-invocation-budget'),
        hashtext(${input.conversationId}::text)
      )
    `);

    const [inserted] = await tx
      .insert(schema.secretaryInvocations)
      .values({
        invocationKey: input.invocationKey,
        conversationId: input.conversationId,
        messageId: input.messageId,
        eventId: input.eventId,
        consumerId: input.consumerId,
        action: input.action ?? 'classify',
        status: 'pending',
      })
      .onConflictDoNothing({ target: schema.secretaryInvocations.invocationKey })
      .returning();

    if (inserted) {
      if (typeof input.maxInvocations === 'number' && Number.isFinite(input.maxInvocations)) {
        const [counted] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.secretaryInvocations)
          .where(
            and(
              eq(schema.secretaryInvocations.conversationId, input.conversationId),
              ne(schema.secretaryInvocations.status, 'denied'),
              ne(schema.secretaryInvocations.invocationKey, input.invocationKey),
            ),
          );
        const priorInvocations = Number(counted?.n ?? 0);
        if (priorInvocations >= input.maxInvocations) {
          const [deniedRow] = await tx
            .update(schema.secretaryInvocations)
            .set({
              status: 'denied',
              errorCode: 'AI_BUDGET_EXHAUSTED',
              lastError: `invocation budget exhausted for conversation (limit ${input.maxInvocations})`,
              detail: { reason: 'budget_exhausted', limit: input.maxInvocations },
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(schema.secretaryInvocations.invocationKey, input.invocationKey))
            .returning();
          return { kind: 'denied', record: toRecord(deniedRow ?? inserted) };
        }
      }

      const [processing] = await tx
        .update(schema.secretaryInvocations)
        .set({
          status: 'processing',
          attemptCount: 1,
          eventId: input.eventId,
          consumerId: input.consumerId,
          updatedAt: new Date(),
        })
        .where(eq(schema.secretaryInvocations.invocationKey, input.invocationKey))
        .returning();
      return { kind: 'started', record: toRecord(processing ?? inserted) };
    }

    const [current] = await tx
      .select()
      .from(schema.secretaryInvocations)
      .where(eq(schema.secretaryInvocations.invocationKey, input.invocationKey))
      .for('update');

    if (!current) {
      throw new Error(`PROD-10: secretária invocação ${input.invocationKey} não pôde ser aberta`);
    }

    if (current.status === 'denied') {
      return { kind: 'denied', record: toRecord(current) };
    }
    if (current.status === 'completed') {
      return { kind: 'completed', record: toRecord(current) };
    }
    if (current.status === 'unknown') {
      // Resultado ambíguo é terminal até reconciliação explícita do provider;
      // nunca transformar um timeout/5xx em nova chamada cega.
      return { kind: 'unknown', record: toRecord(current) };
    }
    if (current.status === 'processing') {
      // Outro executor ainda detém a invocação. Não incrementar a tentativa nem
      // iniciar uma segunda chamada externa com o mesmo efeito lógico.
      return { kind: 'in_progress', record: toRecord(current) };
    }

    const [updated] = await tx
      .update(schema.secretaryInvocations)
      .set({
        status: 'processing',
        attemptCount: current.attemptCount + 1,
        eventId: input.eventId,
        consumerId: input.consumerId,
        lastError: null,
        errorCode: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.secretaryInvocations.invocationKey, input.invocationKey))
      .returning();

    return { kind: 'started', record: toRecord(updated!) };
  });

  if (outcome.kind === 'denied') {
    throw new AIBudgetExhaustedError(
      `invocation budget exhausted for conversation (limit ${input.maxInvocations ?? 'unset'})`,
    );
  }

  return {
    record: outcome.record,
    outcome: outcome.kind,
    alreadyCompleted: outcome.kind === 'completed',
  };
}

/**
 * Contador DURÁVEL de invocações admitidas por conversa (PROD-13/AC1).
 * Exclui os terminais `denied` (bloqueios de orçamento não contam) e, quando
 * pedido, a própria invocação (`priorInvocations` do gate de policy).
 */
export async function countConversationInvocations(
  conversationId: string,
  options: { excludeInvocationKey?: string } = {},
): Promise<number> {
  const conditions = [
    eq(schema.secretaryInvocations.conversationId, conversationId),
    ne(schema.secretaryInvocations.status, 'denied'),
  ];
  if (options.excludeInvocationKey) {
    conditions.push(ne(schema.secretaryInvocations.invocationKey, options.excludeInvocationKey));
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.secretaryInvocations)
    .where(and(...conditions));
  return Number(row?.n ?? 0);
}

export async function completeSecretaryInvocation(
  invocationKey: string,
  options: { resultRef?: string; detail?: Record<string, unknown>; expectedAttemptCount?: number } = {},
): Promise<SecretaryInvocationRecord> {
  const conditions = [
    eq(schema.secretaryInvocations.invocationKey, invocationKey),
    eq(schema.secretaryInvocations.status, 'processing'),
  ];
  if (options.expectedAttemptCount !== undefined) {
    conditions.push(eq(schema.secretaryInvocations.attemptCount, options.expectedAttemptCount));
  }
  const [row] = await db
    .update(schema.secretaryInvocations)
    .set({
      status: 'completed',
      resultRef: options.resultRef ?? null,
      detail: options.detail ?? null,
      lastError: null,
      errorCode: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning();
  if (!row) throw new Error(`PROD-10: invocação ${invocationKey} não encontrada para concluir`);
  return toRecord(row);
}

/**
 * Falha AMBÍGUA/tardia da invocação (ex.: provider não confirma se processou).
 * O registro permanece terminal e observável; a reconciliação explícita é de
 * quem detém o provider — nunca há reenvio cego.
 */
export async function markSecretaryInvocationUnknown(
  invocationKey: string,
  options: { resultRef?: string; detail?: Record<string, unknown>; error?: string; errorCode?: string; expectedAttemptCount?: number } = {},
): Promise<SecretaryInvocationRecord> {
  const conditions = [
    eq(schema.secretaryInvocations.invocationKey, invocationKey),
    eq(schema.secretaryInvocations.status, 'processing'),
  ];
  if (options.expectedAttemptCount !== undefined) {
    conditions.push(eq(schema.secretaryInvocations.attemptCount, options.expectedAttemptCount));
  }
  const [row] = await db
    .update(schema.secretaryInvocations)
    .set({
      status: 'unknown',
      resultRef: options.resultRef ?? null,
      detail: options.detail ?? null,
      lastError: options.error ?? null,
      errorCode: options.errorCode ?? null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning();
  if (!row) throw new Error(`PROD-10: invocação ${invocationKey} não encontrada para marcar unknown`);
  return toRecord(row);
}

/**
 * Falha classificada (retryável ou permanente); a causa fica registrada.
 * `ambiguous: true` (timeout/5xx: o provider pode ter processado) grava o
 * estado `unknown` — reconcilição explícita em vez de reenvio cego.
 */
export async function failSecretaryInvocation(
  invocationKey: string,
  options: { error: string; errorCode?: string; detail?: Record<string, unknown>; ambiguous?: boolean; expectedAttemptCount?: number },
): Promise<SecretaryInvocationRecord> {
  const conditions = [
    eq(schema.secretaryInvocations.invocationKey, invocationKey),
    eq(schema.secretaryInvocations.status, 'processing'),
  ];
  if (options.expectedAttemptCount !== undefined) {
    conditions.push(eq(schema.secretaryInvocations.attemptCount, options.expectedAttemptCount));
  }
  const [row] = await db
    .update(schema.secretaryInvocations)
    .set({
      status: options.ambiguous ? 'unknown' : 'failed',
      lastError: options.error,
      errorCode: options.errorCode ?? null,
      detail: options.detail ?? null,
      completedAt: options.ambiguous ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning();
  if (!row) throw new Error(`PROD-10: invocação ${invocationKey} não encontrada para falhar`);
  return toRecord(row);
}

export async function findSecretaryInvocation(
  invocationKey: string,
): Promise<SecretaryInvocationRecord | null> {
  const [row] = await db
    .select()
    .from(schema.secretaryInvocations)
    .where(eq(schema.secretaryInvocations.invocationKey, invocationKey));
  return row ? toRecord(row) : null;
}
