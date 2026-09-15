import { db, schema } from '@cvg/database';
import { and, eq, inArray, isNull, lt, not, sql } from 'drizzle-orm';
import { ok, err, type Result } from '@cvg/shared';
import { createAlert } from '../use-cases/create-alert.use-case';

/**
 * SA-017/AC1 — alertas automáticos por regra/limiar CONGELADOS.
 *
 * As regras são determinísticas e testáveis com relógio injetado:
 *  - conversa ativa SEM RESPONSÁVEL há mais de 10 min ⇒ alerta `assignment`;
 *  - última mensagem da conversa é INBOUND há mais de 15 min (sem resposta)
 *    ⇒ alerta `message`;
 *  - tarefa com `dueAt` vencido e não concluída/cancelada ⇒ alerta `deadline`.
 *
 * Idempotência em duas camadas:
 *  1. GUARDA ATIVA: enquanto existir alerta ATIVO para a mesma (regra, entidade),
 *     nenhum novo alerta é criado, independentemente da janela — repetir o
 *     agendador não polui a fila;
 *  2. RECIBO DURÁVEL por (regra, entidade, janela): replay do mesmo scan não
 *     reaplica efeito nem duplica evento/auditoria.
 * Após a RESOLUÇÃO, uma condição persistente gera um novo alerta na janela
 * seguinte — comportamento explícito e coberto por ensaio.
 */
export const SLA_WINDOW_MS = 15 * 60 * 1000;

export const SLA_RULES = Object.freeze({
  UNASSIGNED_CONVERSATION_MS: 10 * 60 * 1000,
  UNANSWERED_CONVERSATION_MS: 15 * 60 * 1000,
  /** Tarefa vencida: qualquer atraso positivo. */
  OVERDUE_TASK_MS: 0,
});

export const SLA_SCAN_CONSUMER_ID = 'sla-scanner';

export interface SlaScanOptions {
  now?: Date;
  limit?: number;
}

export interface SlaScanResult {
  scannedAt: string;
  window: number;
  candidates: { unassigned: number; unanswered: number; overdue: number };
  created: Array<{ rule: string; entityId: string; alertId: string; deduplicated: boolean }>;
  failed: Array<{ rule: string; entityId: string; message: string }>;
}

interface CandidateConversation {
  id: string;
}

interface CandidateTask {
  id: string;
  title: string;
  dueAt: Date | null;
}

async function unassignedCandidates(threshold: Date, limit: number): Promise<CandidateConversation[]> {
  return db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(and(
      eq(schema.conversations.isActive, true),
      isNull(schema.conversations.assignedUserId),
      lt(schema.conversations.createdAt, threshold),
    ))
    .limit(limit);
}

async function unansweredCandidates(threshold: Date, limit: number): Promise<CandidateConversation[]> {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT c.id
    FROM conversations c
    JOIN LATERAL (
      SELECT m.direction, m.created_at
      FROM messages m
      WHERE m.conversation_id = c.id
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ) last_message ON true
    WHERE c.is_active = true
      AND last_message.direction = 'inbound'
      -- messages.created_at é timestamp SEM fuso guardando UTC; a comparação
      -- converte o parâmetro para o mesmo relógio (UTC) para não depender do
      -- TimeZone da sessão.
      AND last_message.created_at < (${threshold.toISOString()}::timestamptz AT TIME ZONE 'UTC')
    LIMIT ${limit}
  `);
  const result = rows as unknown as { rows?: Array<{ id: string }> } | Array<{ id: string }>;
  return Array.isArray(result) ? result : (result.rows ?? []);
}

async function overdueTaskCandidates(now: Date, limit: number): Promise<CandidateTask[]> {
  return db
    .select({ id: schema.tasks.id, title: schema.tasks.title, dueAt: schema.tasks.dueAt })
    .from(schema.tasks)
    .where(and(
      lt(schema.tasks.dueAt, now),
      not(inArray(schema.tasks.status, ['completed', 'cancelled'])),
    ))
    .limit(limit);
}

function windowOf(now: Date): number {
  return Math.floor(now.getTime() / SLA_WINDOW_MS);
}

export async function scanSlaAlerts(options: SlaScanOptions = {}): Promise<Result<SlaScanResult, Error>> {
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);
  const window = windowOf(now);
  const result: SlaScanResult = {
    scannedAt: now.toISOString(),
    window,
    candidates: { unassigned: 0, unanswered: 0, overdue: 0 },
    created: [],
    failed: [],
  };

  async function hasActiveAlert(params: { rule: string; conversationId?: string; taskId?: string }): Promise<string | null> {
    if (params.conversationId) {
      const [row] = await db.select({ id: schema.alerts.id }).from(schema.alerts)
        .where(and(
          eq(schema.alerts.status, 'active'),
          eq(schema.alerts.conversationId, params.conversationId),
          sql`${schema.alerts.metadata} LIKE ${`%\"slaRule\":\"${params.rule}\"%`}`,
        ))
        .limit(1);
      if (row) return row.id;
    }
    if (params.taskId) {
      const [row] = await db.select({ id: schema.alerts.id }).from(schema.alerts)
        .where(and(
          eq(schema.alerts.status, 'active'),
          eq(schema.alerts.taskId, params.taskId),
          sql`${schema.alerts.metadata} LIKE ${`%\"slaRule\":\"${params.rule}\"%`}`,
        ))
        .limit(1);
      if (row) return row.id;
    }
    return null;
  }

  async function raise(params: {
    rule: string;
    entityId: string;
    type: 'assignment' | 'message' | 'deadline';
    title: string;
    message: string;
    severity: 'warning' | 'error';
    conversationId?: string;
    taskId?: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    // Camada 1: alerta ATIVO da mesma regra/entidade já cobre a condição.
    const activeId = await hasActiveAlert({ rule: params.rule, conversationId: params.conversationId, taskId: params.taskId });
    if (activeId) {
      result.created.push({ rule: params.rule, entityId: params.entityId, alertId: activeId, deduplicated: true });
      return;
    }

    const response = await createAlert(
      {
        conversationId: params.conversationId,
        taskId: params.taskId,
        type: params.type,
        title: params.title,
        message: params.message,
        severity: params.severity,
        // Alerta de sistema: `triggered_by` é FK de usuário e fica nulo; a
        // origem fica no metadata auditável.
        metadata: { ...params.metadata, slaRule: params.rule, slaWindow: window, source: SLA_SCAN_CONSUMER_ID },
      },
      {
        idempotency: {
          eventId: `sla:${params.rule}:${params.entityId}:${window}`,
          consumerId: SLA_SCAN_CONSUMER_ID,
          effectType: params.rule,
        },
      },
    );
    if (response.isErr()) {
      result.failed.push({ rule: params.rule, entityId: params.entityId, message: response.error.message });
      return;
    }
    result.created.push({
      rule: params.rule,
      entityId: params.entityId,
      alertId: response.value.id,
      deduplicated: response.value.deduplicated === true,
    });
  }

  try {
    const unassigned = await unassignedCandidates(new Date(now.getTime() - SLA_RULES.UNASSIGNED_CONVERSATION_MS), limit);
    result.candidates.unassigned = unassigned.length;
    for (const conversation of unassigned) {
      await raise({
        rule: 'conversation.unassigned',
        entityId: conversation.id,
        type: 'assignment',
        title: 'Conversa sem responsável',
        message: `A conversa está aguardando responsável há mais de ${SLA_RULES.UNASSIGNED_CONVERSATION_MS / 60000} minutos.`,
        severity: 'warning',
        conversationId: conversation.id,
        metadata: { ruleMs: SLA_RULES.UNASSIGNED_CONVERSATION_MS },
      });
    }

    const unanswered = await unansweredCandidates(new Date(now.getTime() - SLA_RULES.UNANSWERED_CONVERSATION_MS), limit);
    result.candidates.unanswered = unanswered.length;
    for (const conversation of unanswered) {
      await raise({
        rule: 'conversation.unanswered',
        entityId: conversation.id,
        type: 'message',
        title: 'Conversa sem resposta',
        message: `A última mensagem é do contato e não há resposta há mais de ${SLA_RULES.UNANSWERED_CONVERSATION_MS / 60000} minutos.`,
        severity: 'error',
        conversationId: conversation.id,
        metadata: { ruleMs: SLA_RULES.UNANSWERED_CONVERSATION_MS },
      });
    }

    const overdue = await overdueTaskCandidates(now, limit);
    result.candidates.overdue = overdue.length;
    for (const task of overdue) {
      await raise({
        rule: 'task.overdue',
        entityId: task.id,
        type: 'deadline',
        title: 'Tarefa vencida',
        message: `A tarefa "${task.title}" está vencida desde ${task.dueAt?.toISOString() ?? 'data desconhecida'}.`,
        severity: 'warning',
        taskId: task.id,
        metadata: { dueAt: task.dueAt?.toISOString() ?? null },
      });
    }

    return ok(result);
  } catch (error) {
    return err(error as Error);
  }
}
