import { createHash } from 'crypto';
import { db, schema } from '@cvg/database';
import { and, eq } from 'drizzle-orm';
import type { AIActionClass } from './ai-policy';
import { sanitizeAIArgs } from './ai-policy';

/**
 * Tool registry + enforcement com aprovação humana (Final-10).
 * Classificação real por ferramenta (não apenas documental):
 * - READ_ONLY: contact.lookup, conversation.read
 * - SAFE_WRITE: note.create
 * - SENSITIVE_WRITE: contact.update, conversation.transfer
 * - HUMAN_APPROVAL: contact.delete, message.delete, sector.membership.change
 * - FORBIDDEN: permission.*, role.*, secret.*, audit.*, session.*, config.*
 *
 * Fluxo HUMAN_APPROVAL: request → PENDING → approve/reject (humano) →
 * ferramenta executa somente com APPROVED válido e não expirado.
 */

export type ToolVerdict =
  | { decision: 'allow'; classification: AIActionClass }
  | { decision: 'deny'; classification: AIActionClass; reason: string }
  | { decision: 'require_approval'; classification: AIActionClass; approvalId: string };

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

export function hashToolArgs(args: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(sanitizeAIArgs(args))).digest('hex');
}

export type AIApproval = typeof schema.aiActionApprovals.$inferSelect;

export async function requestHumanApproval(input: {
  invocationId: string;
  tool: string;
  args: Record<string, unknown>;
}): Promise<AIApproval> {
  const argsHash = hashToolArgs(input.args);
  const [existing] = await db
    .select()
    .from(schema.aiActionApprovals)
    .where(
      and(
        eq(schema.aiActionApprovals.invocationId, input.invocationId),
        eq(schema.aiActionApprovals.tool, input.tool),
        eq(schema.aiActionApprovals.argsHash, argsHash),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(schema.aiActionApprovals)
    .values({
      invocationId: input.invocationId,
      tool: input.tool,
      argsHash,
      argsSanitized: sanitizeAIArgs(input.args),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .returning();
  return created;
}

export async function decideApproval(input: {
  approvalId: string;
  reviewerId: string;
  approve: boolean;
}): Promise<AIApproval | null> {
  const [current] = await db
    .select()
    .from(schema.aiActionApprovals)
    .where(eq(schema.aiActionApprovals.id, input.approvalId))
    .limit(1);
  if (!current || current.status !== 'PENDING') return null;

  const expired = new Date(current.expiresAt).getTime() < Date.now();
  const status = expired ? 'EXPIRED' : input.approve ? 'APPROVED' : 'REJECTED';
  const [updated] = await db
    .update(schema.aiActionApprovals)
    .set({ status, reviewerId: input.reviewerId, decidedAt: new Date() })
    .where(eq(schema.aiActionApprovals.id, input.approvalId))
    .returning();
  return updated || null;
}

async function findValidApproval(invocationId: string, tool: string, argsHash: string): Promise<AIApproval | null> {
  const [approval] = await db
    .select()
    .from(schema.aiActionApprovals)
    .where(
      and(
        eq(schema.aiActionApprovals.invocationId, invocationId),
        eq(schema.aiActionApprovals.tool, tool),
        eq(schema.aiActionApprovals.argsHash, argsHash),
        eq(schema.aiActionApprovals.status, 'APPROVED'),
      ),
    )
    .limit(1);
  if (!approval) return null;
  if (new Date(approval.expiresAt).getTime() < Date.now()) {
    await db
      .update(schema.aiActionApprovals)
      .set({ status: 'EXPIRED' })
      .where(eq(schema.aiActionApprovals.id, approval.id));
    return null;
  }
  return approval;
}

/**
 * Enforcement real: ponto único pelo qual chamadas de ferramenta da IA
 * devem passar. READ_ONLY/SAFE_WRITE/SENSITIVE_WRITE (com budgets via
 * evaluateAIPolicy no fluxo de invocação) → allow; HUMAN_APPROVAL sem
 * aprovação válida → require_approval (e cria o registro); FORBIDDEN → deny.
 */
export async function invokeAITool(input: {
  invocationId: string;
  tool: string;
  args: Record<string, unknown>;
}): Promise<ToolVerdict> {
  const classification = classifyAITool(input.tool);

  if (classification === 'FORBIDDEN') {
    return { decision: 'deny', classification, reason: `tool forbidden: ${input.tool}` };
  }
  if (
    classification === 'READ_ONLY' ||
    classification === 'SAFE_WRITE' ||
    classification === 'SENSITIVE_WRITE'
  ) {
    return { decision: 'allow', classification };
  }

  const argsHash = hashToolArgs(input.args);
  const approved = await findValidApproval(input.invocationId, input.tool, argsHash);
  if (approved) {
    return { decision: 'allow', classification };
  }
  const approval = await requestHumanApproval({ invocationId: input.invocationId, tool: input.tool, args: input.args });
  return { decision: 'require_approval', classification, approvalId: approval.id };
}
