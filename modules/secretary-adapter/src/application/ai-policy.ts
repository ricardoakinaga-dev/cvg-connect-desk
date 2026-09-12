/**
 * AI Safety policy layer (Phase 5 — §8).
 * O Agent Secretary nunca possui autoridade irrestrita:
 * - toda ação é classificada (READ_ONLY/SAFE_WRITE/SENSITIVE_WRITE/HUMAN_APPROVAL/FORBIDDEN);
 * - ações desconhecidas são FORBIDDEN por padrão (deny-by-default);
 * - budgets explícitos: tamanho de contexto, histórico, chamadas e duração;
 * - toda decisão é registrada com argumentos sanitizados (sem prompt integral,
 *   sem PII) e trace id para auditoria.
 */

export type AIActionClass =
  | 'READ_ONLY'
  | 'SAFE_WRITE'
  | 'SENSITIVE_WRITE'
  | 'HUMAN_APPROVAL'
  | 'FORBIDDEN';

export type AIDecision = 'allow' | 'deny';

export interface AIBudgetLimits {
  maxContentChars: number;
  maxHistoryItems: number;
  maxInvocationsPerConversation: number;
  maxDurationMs: number;
}

export function getAIBudgetLimits(): AIBudgetLimits {
  return {
    maxContentChars: Number(process.env.SECRETARY_MAX_CONTENT_CHARS) || 4000,
    maxHistoryItems: Number(process.env.SECRETARY_MAX_HISTORY_ITEMS) || 10,
    maxInvocationsPerConversation: Number(process.env.SECRETARY_MAX_INVOCATIONS_PER_CONVERSATION) || 20,
    maxDurationMs: Number(process.env.SECRETARY_TIMEOUT_MS) || 30000,
  };
}

const ACTION_CLASSIFICATION: Record<string, AIActionClass> = {
  classify: 'READ_ONLY',
  evaluate: 'READ_ONLY',
  respond: 'SAFE_WRITE',
  handoff: 'SAFE_WRITE',
};

export function classifyAIAction(action: string): AIActionClass {
  return ACTION_CLASSIFICATION[action] ?? 'FORBIDDEN';
}

export interface AIDecisionRecord {
  invocationId: string;
  action: string;
  classification: AIActionClass;
  decision: AIDecision;
  reason?: string;
  conversationId: string;
  messageId?: string;
  model?: string;
  at: string;
}

const MAX_DECISION_LOG = 500;
const decisionLog: AIDecisionRecord[] = [];

export function recordAIDecision(record: Omit<AIDecisionRecord, 'at'>): AIDecisionRecord {
  const full: AIDecisionRecord = { ...record, at: new Date().toISOString() };
  decisionLog.push(full);
  if (decisionLog.length > MAX_DECISION_LOG) {
    decisionLog.splice(0, decisionLog.length - MAX_DECISION_LOG);
  }
  return full;
}

export function getAIDecisions(): AIDecisionRecord[] {
  return [...decisionLog];
}

export function clearAIDecisions(): void {
  decisionLog.length = 0;
}

/** Sanitiza argumentos para o registro de decisão: sem prompt integral, sem PII. */
export function sanitizeAIArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === 'content' && typeof value === 'string') {
      out.contentPreview = value.slice(0, 200);
      out.contentChars = value.length;
    } else if (key === 'conversationHistory' && Array.isArray(value)) {
      out.historyItems = value.length;
    } else if (key === 'contactPhone' || key === 'sender') {
      out[key] = '[PHONE]';
    } else if (key === 'context' || key === 'prompt') {
      out[key] = '[OMITTED]';
    } else if (typeof value === 'string' && value.length > 500) {
      out[key] = `${value.slice(0, 200)}…[TRUNCATED ${value.length} chars]`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export interface AIPolicyInput {
  invocationId: string;
  action: string;
  conversationId: string;
  messageId?: string;
  contentChars: number;
  historyItems: number;
  priorInvocations: number;
}

/** Avalia a policy. Retorna allow/deny com motivo auditável. */
export function evaluateAIPolicy(input: AIPolicyInput): { decision: AIDecision; classification: AIActionClass; reason?: string } {
  const classification = classifyAIAction(input.action);
  if (classification === 'FORBIDDEN') {
    return { decision: 'deny', classification, reason: `unknown action: ${input.action}` };
  }

  const limits = getAIBudgetLimits();
  if (input.contentChars > limits.maxContentChars) {
    return { decision: 'deny', classification, reason: `content exceeds ${limits.maxContentChars} chars` };
  }
  if (input.historyItems > limits.maxHistoryItems) {
    return { decision: 'deny', classification, reason: `history exceeds ${limits.maxHistoryItems} items` };
  }
  if (input.priorInvocations >= limits.maxInvocationsPerConversation) {
    return { decision: 'deny', classification, reason: 'invocation budget exhausted for conversation' };
  }
  return { decision: 'allow', classification };
}
