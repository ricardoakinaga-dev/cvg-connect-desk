import { describe, it, expect, beforeEach } from 'vitest';
import {
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
});
