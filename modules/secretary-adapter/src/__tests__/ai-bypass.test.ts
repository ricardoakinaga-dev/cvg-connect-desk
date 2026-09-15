import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import {
  classifyAITool,
  invokeAITool,
} from '../application/ai-tools';
import { classifyAIAction, evaluateAIPolicy } from '../application/ai-policy';

/**
 * AI safety final (§19): bypass attempts.
 * - unknown action/tool → FORBIDDEN por default
 * - case variation/alias → NÃO é alias (registry é exato)
 * - invalid args após aprovação → hash diferente → nova aprovação
 *
 * PROD-13/D05: o workflow é desabilitado por padrão; os testes de pedido de
 * aprovação ligam a flag em ambiente isolado (nenhuma ferramenta executa).
 */
describe('AI safety bypass validation', () => {
  beforeEach(() => {
    process.env.SECRETARY_AI_TOOLS_ENABLED = 'true';
  });

  afterEach(() => {
    delete process.env.SECRETARY_AI_TOOLS_ENABLED;
  });
  it('unknown tool → FORBIDDEN', async () => {
    expect(classifyAITool('nonsense.nope')).toBe('FORBIDDEN');
    expect(await invokeAITool({ invocationId: 'bypass1', tool: 'nonsense.nope', args: {} }))
      .toMatchObject({ decision: 'deny', classification: 'FORBIDDEN' });
  });

  it('tool alias não existe: variação de case não burla registry', async () => {
    // Registry é exato: 'CONTACT.Delete' ≠ 'contact.delete'
    expect(classifyAITool('CONTACT.Delete')).toBe('FORBIDDEN');
    expect(classifyAITool(' Contact.delete' )).toBe('FORBIDDEN');
    expect(classifyAITool('contact.delete ')).toBe('FORBIDDEN');
    expect(await invokeAITool({ invocationId: 'bypass2', tool: 'contact.Delete', args: {} }))
      .toMatchObject({ decision: 'deny' });
  });

  it('malformed action (vazio/null-like) → FORBIDDEN por default', () => {
    expect(classifyAIAction('')).toBe('FORBIDDEN');
    expect(classifyAIAction('Classify')).toBe('FORBIDDEN'); // case-sensitive legado
  });

  it('alterar argumentos após aprovação invalida (hash difere)', async () => {
    // INVOCA com args A → require_approval (hash A)
    const first = await invokeAITool({ invocationId: 'bypass3', tool: 'contact.delete', args: { id: 'c1' } });
    expect(first.decision).toBe('require_approval');
    // MESMO tool, args B → hash difere → approval BROWN separado (não é mesmo hash)
    const second = await invokeAITool({ invocationId: 'bypass3', tool: 'contact.delete', args: { id: 'c2' } });
    expect(second.decision).toBe('require_approval');
    if (first.decision === 'require_approval' && second.decision === 'require_approval') {
      expect(second.approvalId).not.toBe(first.approvalId);
    }
  });

  it('invocation id diferente com mesmos args → aprovação separada (ligado ao invocation)', async () => {
    const a = await invokeAITool({ invocationId: 'bypass4', tool: 'contact.delete', args: { id: 'x' } });
    const b = await invokeAITool({ invocationId: 'bypass5', tool: 'contact.delete', args: { id: 'x' } });
    if (a.decision === 'require_approval' && b.decision === 'require_approval') {
      expect(a.approvalId).not.toBe(b.approvalId);
    }
  });

  it('policies: priorInvocations alto ainda nega SENSITIVE_WRITE dentro do budget', () => {
    const denied = evaluateAIPolicy({
      invocationId: 'bypass6',
      action: 'handoff',
      conversationId: 'c',
      contentChars: 1,
      historyItems: 0,
      priorInvocations: 999,
    });
    expect(denied.decision).toBe('deny');
  });
});
