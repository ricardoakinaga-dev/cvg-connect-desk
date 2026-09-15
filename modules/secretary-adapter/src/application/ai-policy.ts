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

export type AIDenyReasonCode =
  | 'ACTION_FORBIDDEN'
  | 'CONTENT_BUDGET'
  | 'HISTORY_BUDGET'
  | 'INVOCATION_BUDGET';

/**
 * PROD-13 / C08 — bloqueio do orçamento DURÁVEL por conversa (`denied` em
 * `secretary_invocations`). Erro tipado, permanente e mapeável a 403
 * `AI_POLICY_DENIED`; a superfície assíncrona (worker) o converte em estado
 * `denied` durável, sem retry infinito e sem DLQ ruidosa.
 */
export class AIBudgetExhaustedError extends Error {
  readonly errorCode = 'AI_BUDGET_EXHAUSTED';
  readonly permanent = true;
  readonly statusCode = 403;

  constructor(message = 'invocation budget exhausted for conversation') {
    super(message);
    this.name = 'AIBudgetExhaustedError';
    Object.setPrototypeOf(this, AIBudgetExhaustedError.prototype);
  }
}

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

/** Sanitiza argumentos para o registro de decisão: sem prompt integral, sem PII.
 *
 * PROD-13: a sanitização é RECURSIVA — objetos/arrays aninhados não podem
 * vazar telefone, e-mail, conteúdo ou prompt (AC4). O nome do campo é avaliado
 * em qualquer profundidade; strings longas são truncadas.
 */
const MAX_SANITIZE_DEPTH = 8;

function isPhoneKey(loweredKey: string): boolean {
  return loweredKey === 'contactphone' || loweredKey === 'sender' || loweredKey === 'phone'
    || loweredKey === 'recipient' || loweredKey.endsWith('phone') || loweredKey.endsWith('telefone');
}

function isEmailKey(loweredKey: string): boolean {
  return loweredKey === 'email' || loweredKey.endsWith('email');
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth >= MAX_SANITIZE_DEPTH) return '[TRUNCATED_DEPTH]';
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    return sanitizeRecord(value as Record<string, unknown>, depth + 1);
  }
  if (typeof value === 'string' && value.length > 500) {
    return `${value.slice(0, 200)}…[TRUNCATED ${value.length} chars]`;
  }
  return value;
}

function sanitizeRecord(record: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const lowered = key.toLowerCase();
    if (key === 'content' && typeof value === 'string') {
      out.contentPreview = value.slice(0, 200);
      out.contentChars = value.length;
    } else if (key === 'conversationHistory' && Array.isArray(value)) {
      out.historyItems = value.length;
    } else if (isPhoneKey(lowered)) {
      out[key] = '[PHONE]';
    } else if (isEmailKey(lowered)) {
      out[key] = '[EMAIL]';
    } else if (key === 'context' || key === 'prompt') {
      out[key] = '[OMITTED]';
    } else {
      out[key] = sanitizeValue(value, depth);
    }
  }
  return out;
}

export function sanitizeAIArgs(args: Record<string, unknown>): Record<string, unknown> {
  return sanitizeRecord(args, 0);
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
export function evaluateAIPolicy(input: AIPolicyInput): {
  decision: AIDecision;
  classification: AIActionClass;
  reason?: string;
  reasonCode?: AIDenyReasonCode;
} {
  const classification = classifyAIAction(input.action);
  if (classification === 'FORBIDDEN') {
    return {
      decision: 'deny',
      classification,
      reason: `unknown action: ${input.action}`,
      reasonCode: 'ACTION_FORBIDDEN',
    };
  }

  const limits = getAIBudgetLimits();
  if (input.contentChars > limits.maxContentChars) {
    return {
      decision: 'deny',
      classification,
      reason: `content exceeds ${limits.maxContentChars} chars`,
      reasonCode: 'CONTENT_BUDGET',
    };
  }
  if (input.historyItems > limits.maxHistoryItems) {
    return {
      decision: 'deny',
      classification,
      reason: `history exceeds ${limits.maxHistoryItems} items`,
      reasonCode: 'HISTORY_BUDGET',
    };
  }
  if (input.priorInvocations >= limits.maxInvocationsPerConversation) {
    return {
      decision: 'deny',
      classification,
      reason: 'invocation budget exhausted for conversation',
      reasonCode: 'INVOCATION_BUDGET',
    };
  }
  return { decision: 'allow', classification };
}
