import { createHash } from 'crypto';
import { db, schema } from '@cvg/database';
import { and, eq, gt, inArray, lte } from 'drizzle-orm';
import type { AIActionClass } from './ai-policy';
import { sanitizeAIArgs } from './ai-policy';

/**
 * Tool registry + enforcement com aprovação humana (Final-10 · PROD-13/C08).
 * Classificação real por ferramenta (não apenas documental):
 * - READ_ONLY: contact.lookup, conversation.read
 * - SAFE_WRITE: note.create
 * - SENSITIVE_WRITE: contact.update, conversation.transfer
 * - HUMAN_APPROVAL: contact.delete, message.delete, sector.membership.change
 * - FORBIDDEN: permission.*, role.*, secret.*, audit.*, session.*, config.*
 *
 * D05 permanece OPEN: o workflow está DESABILITADO por padrão
 * (`SECRETARY_AI_TOOLS_ENABLED=false`) e nenhum efeito é habilitado sem
 * ratificação — deny-default em `invokeAITool` e `decideApproval`. Quando (e
 * somente quando) ratificado, ligar a flag habilita o fluxo já endurecido:
 *  - aprovação vinculada ao hash CANÔNICO do payload ORIGINAL + escopo
 *    (inclusive ação/recurso), nunca a uma versão sanitizada/truncada;
 *  - validade explícita (`expires_at`) e expiração negada no uso;
 *  - decisão por revisor autorizado com CAS e uso único (`CONSUMED`);
 *  - registro sanitizado RECURSIVAMENTE (sem PII) para auditoria.
 */

export type ToolVerdict =
  | { decision: 'allow'; classification: AIActionClass }
  | {
      decision: 'deny';
      classification: AIActionClass;
      reason: string;
      reasonCode: AIToolDenyReasonCode;
      statusCode: 403;
      code: 'AI_POLICY_DENIED';
    }
  | { decision: 'require_approval'; classification: AIActionClass; approvalId: string };

export type AIToolDenyReasonCode =
  | 'AI_TOOLS_DISABLED'
  | 'AI_TOOL_FORBIDDEN'
  | 'AI_APPROVAL_STORE_UNAVAILABLE'
  | 'AI_APPROVAL_EXPIRED'
  | 'AI_APPROVAL_REJECTED'
  | 'AI_APPROVAL_CONSUMED'
  | 'AI_APPROVAL_REVIEWER_UNAUTHORIZED';

/** Erro tipado do workflow de ferramentas: 403 `AI_POLICY_DENIED`. */
export class AIToolDeniedError extends Error {
  readonly statusCode = 403;
  readonly code = 'AI_POLICY_DENIED';
  readonly reasonCode: AIToolDenyReasonCode;

  constructor(reasonCode: AIToolDenyReasonCode, message: string) {
    super(message);
    this.name = 'AIToolDeniedError';
    this.reasonCode = reasonCode;
    Object.setPrototypeOf(this, AIToolDeniedError.prototype);
  }
}

/** D05 OPEN ⇒ sem ratificação o workflow fica desabilitado (deny-default). */
export const AI_TOOLS_ENABLED_ENV = 'SECRETARY_AI_TOOLS_ENABLED';

export function areAIToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[AI_TOOLS_ENABLED_ENV] === 'true';
}

const READ_ONLY_TOOLS = new Set(['contact.lookup', 'conversation.read']);
const SAFE_WRITE_TOOLS = new Set(['note.create']);
const SENSITIVE_WRITE_TOOLS = new Set(['contact.update', 'conversation.transfer']);
const HUMAN_APPROVAL_TOOLS = new Set(['contact.delete', 'message.delete', 'sector.membership.change']);
const FORBIDDEN_PREFIXES = ['permission.', 'role.', 'secret.', 'audit.', 'session.', 'config.'];

export function classifyAITool(tool: string): AIActionClass {
  if (READ_ONLY_TOOLS.has(tool)) return 'READ_ONLY';
  if (SAFE_WRITE_TOOLS.has(tool)) return 'SAFE_WRITE';
  if (SENSITIVE_WRITE_TOOLS.has(tool)) return 'SENSITIVE_WRITE';
  if (HUMAN_APPROVAL_TOOLS.has(tool)) return 'HUMAN_APPROVAL';
  if (FORBIDDEN_PREFIXES.some((prefix) => tool.startsWith(prefix))) return 'FORBIDDEN';
  return 'FORBIDDEN';
}

/**
 * Serialização canônica do payload ORIGINAL: chaves ordenadas em qualquer
 * profundidade, tipos preservados. É a base do hash de aprovação — NUNCA a
 * versão sanitizada (dois telefones distintos colidiriam em `[PHONE]`).
 */
export function canonicalizeAIArgs(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalizeAIArgs(item)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeAIArgs(record[key])}`).join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 'null' : serialized;
}

export function hashToolArgs(
  tool: string,
  args: Record<string, unknown>,
  scope: Record<string, unknown> = {},
): string {
  return createHash('sha256')
    .update(canonicalizeAIArgs({ tool, scope, args }))
    .digest('hex');
}

export type AIApproval = typeof schema.aiActionApprovals.$inferSelect;

export interface RequestHumanApprovalInput {
  invocationId: string;
  tool: string;
  args: Record<string, unknown>;
  /** Ator/recurso/escopo vinculados ao hash e sanitizados para auditoria. */
  scope?: Record<string, unknown>;
  requestedBy?: string;
  ttlMs?: number;
}

/**
 * Autorização de revisor (D01 OPEN: sem catálogo ratificado de papéis).
 * Sem autorizador configurado, decidir é NEGADO por padrão (fail-closed).
 */
export type AIApprovalReviewerAuthorizer = (input: {
  reviewerId: string;
  approval: AIApproval;
}) => Promise<boolean> | boolean;

let reviewerAuthorizer: AIApprovalReviewerAuthorizer | null = null;

export function setAIApprovalReviewerAuthorizer(authorizer: AIApprovalReviewerAuthorizer | null): void {
  reviewerAuthorizer = authorizer;
}

export function getAIApprovalReviewerAuthorizer(): AIApprovalReviewerAuthorizer | null {
  return reviewerAuthorizer;
}

export const AI_APPROVAL_TTL_MS_ENV = 'SECRETARY_APPROVAL_TTL_MS';

function approvalTtlMs(override?: number): number {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) return override;
  return Number(process.env[AI_APPROVAL_TTL_MS_ENV]) || 24 * 60 * 60 * 1000;
}

function denyVerdict(
  classification: AIActionClass,
  reasonCode: AIToolDenyReasonCode,
  reason: string,
): ToolVerdict {
  return { decision: 'deny', classification, reason, reasonCode, statusCode: 403, code: 'AI_POLICY_DENIED' };
}

function assertToolsEnabled(operation: string): void {
  if (!areAIToolsEnabled()) {
    throw new AIToolDeniedError(
      'AI_TOOLS_DISABLED',
      `${operation} denied: ${AI_TOOLS_ENABLED_ENV} is not enabled (D05 OPEN)`,
    );
  }
}

async function findApprovalRow(
  invocationId: string,
  tool: string,
  argsHash: string,
): Promise<AIApproval | null> {
  const [row] = await db
    .select()
    .from(schema.aiActionApprovals)
    .where(
      and(
        eq(schema.aiActionApprovals.invocationId, invocationId),
        eq(schema.aiActionApprovals.tool, tool),
        eq(schema.aiActionApprovals.argsHash, argsHash),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function findApprovalById(approvalId: string): Promise<AIApproval | null> {
  const [row] = await db
    .select()
    .from(schema.aiActionApprovals)
    .where(eq(schema.aiActionApprovals.id, approvalId))
    .limit(1);
  return row ?? null;
}

/** CAS: reabre uma aprovação terminal (REJECTED/EXPIRED/CONSUMED) como PENDING. */
async function reopenApproval(approvalId: string, ttlMs: number): Promise<AIApproval | null> {
  const [row] = await db
    .update(schema.aiActionApprovals)
    .set({
      status: 'PENDING',
      reviewerId: null,
      decidedAt: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() + ttlMs),
    })
    .where(
      and(
        eq(schema.aiActionApprovals.id, approvalId),
        inArray(schema.aiActionApprovals.status, ['REJECTED', 'EXPIRED', 'CONSUMED']),
      ),
    )
    .returning();
  return row ?? null;
}

/** CAS: renova uma PENDING já expirada (mantém PENDING, nova validade). */
async function refreshExpiredPendingApproval(approvalId: string, ttlMs: number): Promise<AIApproval | null> {
  const [row] = await db
    .update(schema.aiActionApprovals)
    .set({ expiresAt: new Date(Date.now() + ttlMs) })
    .where(
      and(
        eq(schema.aiActionApprovals.id, approvalId),
        eq(schema.aiActionApprovals.status, 'PENDING'),
        lte(schema.aiActionApprovals.expiresAt, new Date()),
      ),
    )
    .returning();
  return row ?? null;
}

/** CAS: marca PENDING/APPROVED expirada como EXPIRED. */
async function markApprovalExpired(approvalId: string): Promise<AIApproval | null> {
  const [row] = await db
    .update(schema.aiActionApprovals)
    .set({ status: 'EXPIRED' })
    .where(
      and(
        eq(schema.aiActionApprovals.id, approvalId),
        inArray(schema.aiActionApprovals.status, ['PENDING', 'APPROVED']),
        lte(schema.aiActionApprovals.expiresAt, new Date()),
      ),
    )
    .returning();
  return row ?? null;
}

/** CAS: consumo de uso único (APPROVED válido → CONSUMED). */
async function consumeApproval(approvalId: string): Promise<AIApproval | null> {
  const [row] = await db
    .update(schema.aiActionApprovals)
    .set({ status: 'CONSUMED', consumedAt: new Date() })
    .where(
      and(
        eq(schema.aiActionApprovals.id, approvalId),
        eq(schema.aiActionApprovals.status, 'APPROVED'),
        gt(schema.aiActionApprovals.expiresAt, new Date()),
      ),
    )
    .returning();
  return row ?? null;
}

function approvalExpired(approval: AIApproval): boolean {
  return new Date(approval.expiresAt).getTime() <= Date.now();
}

/**
 * Solicita (ou reutiliza/reabre) aprovação humana para um payload EXATO.
 * Idempotente por (invocation, tool, hash do payload original + escopo).
 */
export async function requestHumanApproval(input: RequestHumanApprovalInput): Promise<AIApproval> {
  assertToolsEnabled('requestHumanApproval');
  const scope = input.scope ?? {};
  const argsHash = hashToolArgs(input.tool, input.args, scope);
  const ttlMs = approvalTtlMs(input.ttlMs);

  const existing = await findApprovalRow(input.invocationId, input.tool, argsHash);
  if (existing) {
    if (existing.status === 'PENDING') {
      if (!approvalExpired(existing)) return existing;
      const refreshed = await refreshExpiredPendingApproval(existing.id, ttlMs);
      return refreshed ?? (await findApprovalById(existing.id)) ?? existing;
    }
    if (existing.status === 'APPROVED') return existing;
    const reopened = await reopenApproval(existing.id, ttlMs);
    return reopened ?? (await findApprovalById(existing.id)) ?? existing;
  }

  const [created] = await db
    .insert(schema.aiActionApprovals)
    .values({
      invocationId: input.invocationId,
      tool: input.tool,
      argsHash,
      argsSanitized: sanitizeAIArgs(input.args),
      scopeSanitized: sanitizeAIArgs(scope),
      requestedBy: input.requestedBy ?? 'secretary-agent',
      expiresAt: new Date(Date.now() + ttlMs),
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const raced = await findApprovalRow(input.invocationId, input.tool, argsHash);
  if (!raced) throw new Error('PROD-13: aprovação não pôde ser criada nem relida');
  return raced;
}

/**
 * Decide uma aprovação com CAS (`PENDING` → APPROVED/REJECTED/EXPIRED).
 * Duplo decide não vence (a segunda chamada devolve `null`); expirada nega.
 */
export async function decideApproval(input: {
  approvalId: string;
  reviewerId: string;
  approve: boolean;
}): Promise<AIApproval | null> {
  assertToolsEnabled('decideApproval');

  const current = await findApprovalById(input.approvalId);
  if (!current || current.status !== 'PENDING') return null;

  if (!reviewerAuthorizer) {
    throw new AIToolDeniedError(
      'AI_APPROVAL_REVIEWER_UNAUTHORIZED',
      'decideApproval denied: no reviewer authorizer configured',
    );
  }
  const authorized = await reviewerAuthorizer({ reviewerId: input.reviewerId, approval: current });
  if (!authorized) {
    throw new AIToolDeniedError(
      'AI_APPROVAL_REVIEWER_UNAUTHORIZED',
      'decideApproval denied: reviewer not authorized',
    );
  }

  if (approvalExpired(current)) {
    return (await markApprovalExpired(current.id)) ?? null;
  }

  const status = input.approve ? 'APPROVED' : 'REJECTED';
  const [updated] = await db
    .update(schema.aiActionApprovals)
    .set({ status, reviewerId: input.reviewerId, decidedAt: new Date() })
    .where(
      and(
        eq(schema.aiActionApprovals.id, input.approvalId),
        eq(schema.aiActionApprovals.status, 'PENDING'),
        gt(schema.aiActionApprovals.expiresAt, new Date()),
      ),
    )
    .returning();
  return updated ?? null;
}

export interface AIToolInvocationInput {
  invocationId: string;
  tool: string;
  args: Record<string, unknown>;
  scope?: Record<string, unknown>;
}

/**
 * Enforcement real: ponto único pelo qual chamadas de ferramenta da IA
 * devem passar. Com o workflow desabilitado (D05 OPEN), TODA ferramenta é
 * negada com 403 `AI_POLICY_DENIED`. Habilitado: READ_ONLY/SAFE_WRITE/
 * SENSITIVE_WRITE seguem a classificação; HUMAN_APPROVAL exige aprovação
 * válida do payload EXATO (hash canônico) e a consome (uso único).
 */
export async function invokeAITool(input: AIToolInvocationInput): Promise<ToolVerdict> {
  const classification = classifyAITool(input.tool);

  if (!areAIToolsEnabled()) {
    return denyVerdict(
      classification,
      'AI_TOOLS_DISABLED',
      `AI tools disabled by ${AI_TOOLS_ENABLED_ENV} (D05 OPEN)`,
    );
  }
  if (classification === 'FORBIDDEN') {
    return denyVerdict(classification, 'AI_TOOL_FORBIDDEN', `tool forbidden: ${input.tool}`);
  }
  if (classification !== 'HUMAN_APPROVAL') {
    return { decision: 'allow', classification };
  }

  const scope = input.scope ?? {};
  const argsHash = hashToolArgs(input.tool, input.args, scope);

  let existing: AIApproval | null;
  try {
    existing = await findApprovalRow(input.invocationId, input.tool, argsHash);
  } catch {
    return denyVerdict(classification, 'AI_APPROVAL_STORE_UNAVAILABLE', 'approval store unavailable');
  }

  if (existing) {
    const expired = approvalExpired(existing);
    switch (existing.status) {
      case 'APPROVED': {
        if (expired) {
          await markApprovalExpired(existing.id);
          return denyVerdict(classification, 'AI_APPROVAL_EXPIRED', 'approval expired');
        }
        const consumed = await consumeApproval(existing.id);
        if (consumed) return { decision: 'allow', classification };
        return denyVerdict(classification, 'AI_APPROVAL_CONSUMED', 'approval already consumed');
      }
      case 'PENDING': {
        if (expired) {
          await markApprovalExpired(existing.id);
          return denyVerdict(classification, 'AI_APPROVAL_EXPIRED', 'approval expired');
        }
        return { decision: 'require_approval', classification, approvalId: existing.id };
      }
      case 'REJECTED':
        return denyVerdict(classification, 'AI_APPROVAL_REJECTED', 'approval rejected');
      case 'EXPIRED':
        return denyVerdict(classification, 'AI_APPROVAL_EXPIRED', 'approval expired');
      case 'CONSUMED':
        return denyVerdict(classification, 'AI_APPROVAL_CONSUMED', 'approval already consumed');
    }
  }

  let approval: AIApproval;
  try {
    approval = await requestHumanApproval({
      invocationId: input.invocationId,
      tool: input.tool,
      args: input.args,
      scope,
    });
  } catch {
    return denyVerdict(classification, 'AI_APPROVAL_STORE_UNAVAILABLE', 'approval store unavailable');
  }
  return { decision: 'require_approval', classification, approvalId: approval.id };
}
