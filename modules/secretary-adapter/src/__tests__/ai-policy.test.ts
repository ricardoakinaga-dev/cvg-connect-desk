import { describe, it, expect, beforeEach } from 'vitest';
import {
  AIBudgetExhaustedError,
  classifyAIAction,
  evaluateAIPolicy,
  recordAIDecision,
  getAIDecisions,
  clearAIDecisions,
  sanitizeAIArgs,
} from '../application/ai-policy';

describe('AI safety policy', () => {
  beforeEach(() => {
    clearAIDecisions();
  });

  it('classifies known actions and denies unknown by default', () => {
    expect(classifyAIAction('classify')).toBe('READ_ONLY');
    expect(classifyAIAction('evaluate')).toBe('READ_ONLY');
    expect(classifyAIAction('respond')).toBe('SAFE_WRITE');
    expect(classifyAIAction('handoff')).toBe('SAFE_WRITE');
    expect(classifyAIAction('delete')).toBe('FORBIDDEN');
    expect(classifyAIAction('export')).toBe('FORBIDDEN');
    expect(classifyAIAction('')).toBe('FORBIDDEN');
  });

  it('denies forbidden actions with audit reason', () => {
    const result = evaluateAIPolicy({
      invocationId: 'sec_1',
      action: 'delete',
      conversationId: 'conv-1',
      contentChars: 10,
      historyItems: 0,
      priorInvocations: 0,
    });
    expect(result.decision).toBe('deny');
    expect(result.classification).toBe('FORBIDDEN');
    expect(result.reason).toContain('unknown action');
  });

  it('enforces content and history budgets', () => {
    const big = evaluateAIPolicy({
      invocationId: 'sec_2',
      action: 'classify',
      conversationId: 'conv-1',
      contentChars: 1_000_000,
      historyItems: 0,
      priorInvocations: 0,
    });
    expect(big.decision).toBe('deny');

    const longHistory = evaluateAIPolicy({
      invocationId: 'sec_3',
      action: 'classify',
      conversationId: 'conv-1',
      contentChars: 10,
      historyItems: 10_000,
      priorInvocations: 0,
    });
    expect(longHistory.decision).toBe('deny');
  });

  it('enforces per-conversation invocation budget', () => {
    const result = evaluateAIPolicy({
      invocationId: 'sec_4',
      action: 'respond',
      conversationId: 'conv-1',
      contentChars: 10,
      historyItems: 1,
      priorInvocations: 10_000,
    });
    expect(result.decision).toBe('deny');
    expect(result.reason).toContain('budget');
    expect(result.reasonCode).toBe('INVOCATION_BUDGET');
  });

  it('limite exato nega: priorInvocations === limite (PROD-13/AC1)', () => {
    const previous = process.env.SECRETARY_MAX_INVOCATIONS_PER_CONVERSATION;
    process.env.SECRETARY_MAX_INVOCATIONS_PER_CONVERSATION = '2';
    try {
      const allowed = evaluateAIPolicy({
        invocationId: 'sec_exact_1',
        action: 'classify',
        conversationId: 'conv-1',
        contentChars: 10,
        historyItems: 0,
        priorInvocations: 1,
      });
      const denied = evaluateAIPolicy({
        invocationId: 'sec_exact_2',
        action: 'classify',
        conversationId: 'conv-1',
        contentChars: 10,
        historyItems: 0,
        priorInvocations: 2,
      });
      expect(allowed.decision).toBe('allow');
      expect(denied.decision).toBe('deny');
      expect(denied.reasonCode).toBe('INVOCATION_BUDGET');
    } finally {
      if (previous === undefined) delete process.env.SECRETARY_MAX_INVOCATIONS_PER_CONVERSATION;
      else process.env.SECRETARY_MAX_INVOCATIONS_PER_CONVERSATION = previous;
    }
  });

  it('erro tipado de budget: 403 AI_BUDGET_EXHAUSTED permanente', () => {
    const error = new AIBudgetExhaustedError('limite');
    expect(error.statusCode).toBe(403);
    expect(error.errorCode).toBe('AI_BUDGET_EXHAUSTED');
    expect(error.permanent).toBe(true);
  });

  it('allows compliant invocations', () => {
    const result = evaluateAIPolicy({
      invocationId: 'sec_5',
      action: 'classify',
      conversationId: 'conv-1',
      contentChars: 100,
      historyItems: 2,
      priorInvocations: 0,
    });
    expect(result).toMatchObject({ decision: 'allow', classification: 'READ_ONLY' });
  });

  it('records decisions and sanitizes args (no prompt/PII)', () => {
    recordAIDecision({
      invocationId: 'sec_6',
      action: 'classify',
      classification: 'READ_ONLY',
      decision: 'allow',
      conversationId: 'conv-1',
    });
    expect(getAIDecisions()).toHaveLength(1);

    const sanitized = sanitizeAIArgs({
      content: 'x'.repeat(1000),
      sender: '+5511999999999',
      contactPhone: '5511888888888',
      conversationHistory: [{ role: 'user', content: 'oi' }],
      action: 'classify',
    });
    expect(sanitized.contentPreview).toBe('x'.repeat(200));
    expect(sanitized.sender).toBe('[PHONE]');
    expect(sanitized.contactPhone).toBe('[PHONE]');
    expect(sanitized.historyItems).toBe(1);
  });

  it('sanitiza RECURSIVAMENTE (PROD-13/AC4): aninhados não vazam PII', () => {
    const sanitized = sanitizeAIArgs({
      contact: {
        phone: '+5511999999999',
        email: 'titular@example.com',
        notes: [
          { text: 'y'.repeat(700), phone: '+5511888888888', nested: { email: 'x@y.z', prompt: 'segredo' } },
        ],
        context: 'contexto integral',
      },
      deep: { level1: { level2: { level3: { level4: { phone: '+5511777777777' } } } } },
    });
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain('5511999999999');
    expect(serialized).not.toContain('5511888888888');
    expect(serialized).not.toContain('5511777777777');
    expect(serialized).not.toContain('titular@example.com');
    expect(serialized).not.toContain('x@y.z');
    expect(serialized).not.toContain('segredo');
    expect(serialized).not.toContain('contexto integral');
    const contact = sanitized.contact as Record<string, unknown>;
    expect(contact.phone).toBe('[PHONE]');
    expect(contact.email).toBe('[EMAIL]');
    expect(contact.context).toBe('[OMITTED]');
    const notes = contact.notes as Array<Record<string, unknown>>;
    expect(notes[0]!.phone).toBe('[PHONE]');
    expect(notes[0]!.nested).toMatchObject({ email: '[EMAIL]', prompt: '[OMITTED]' });
    expect(String(notes[0]!.text)).toContain('[TRUNCATED 700 chars]');
  });
});
