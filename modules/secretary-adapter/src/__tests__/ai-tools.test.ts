import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db, schema } from '@cvg/database';
import { eq } from 'drizzle-orm';
import {
  AIToolDeniedError,
  classifyAITool,
  hashToolArgs,
  invokeAITool,
  requestHumanApproval,
  decideApproval,
  setAIApprovalReviewerAuthorizer,
} from '../application/ai-tools';
import { clearAIDecisions } from '../application/ai-policy';

const REVIEWER_BLOCKED = 'blocked-reviewer';

async function insertReviewer(): Promise<string> {
  const reviewerId = randomUUID();
  await db.insert(schema.users).values({
    id: reviewerId,
    name: 'Reviewer',
    email: `reviewer.${reviewerId}@example.com`,
    passwordHash: 'x',
    isActive: true,
  });
  return reviewerId;
}

describe('AI tool registry + human approval (real PG)', () => {
  const invocationId = `ai-tools-${Date.now()}`;

  beforeEach(() => {
    clearAIDecisions();
    // D05 OPEN em produção; o teste liga o workflow em ambiente isolado para
    // exercitar o fluxo endurecido (nenhum efeito real de ferramenta roda).
    process.env.SECRETARY_AI_TOOLS_ENABLED = 'true';
    setAIApprovalReviewerAuthorizer(({ reviewerId }) => reviewerId !== REVIEWER_BLOCKED);
  });

  afterEach(() => {
    delete process.env.SECRETARY_AI_TOOLS_ENABLED;
    setAIApprovalReviewerAuthorizer(null);
  });

  it('classifies concrete tools across all five classes', () => {
    expect(classifyAITool('contact.lookup')).toBe('READ_ONLY');
    expect(classifyAITool('conversation.read')).toBe('READ_ONLY');
    expect(classifyAITool('note.create')).toBe('SAFE_WRITE');
    expect(classifyAITool('contact.update')).toBe('SENSITIVE_WRITE');
    expect(classifyAITool('conversation.transfer')).toBe('SENSITIVE_WRITE');
    expect(classifyAITool('contact.delete')).toBe('HUMAN_APPROVAL');
    expect(classifyAITool('message.delete')).toBe('HUMAN_APPROVAL');
    expect(classifyAITool('sector.membership.change')).toBe('HUMAN_APPROVAL');
    expect(classifyAITool('permission.grant')).toBe('FORBIDDEN');
    expect(classifyAITool('secret.read')).toBe('FORBIDDEN');
    expect(classifyAITool('audit.delete')).toBe('FORBIDDEN');
    expect(classifyAITool('config.write')).toBe('FORBIDDEN');
    expect(classifyAITool('unknown.tool')).toBe('FORBIDDEN');
  });

  it('deny-default: sem ratificação (D05 OPEN) TODA ferramenta nega 403 AI_POLICY_DENIED', async () => {
    delete process.env.SECRETARY_AI_TOOLS_ENABLED;
    for (const tool of ['contact.lookup', 'note.create', 'contact.delete']) {
      const verdict = await invokeAITool({ invocationId, tool, args: { id: 'c1' } });
      expect(verdict).toMatchObject({
        decision: 'deny',
        reasonCode: 'AI_TOOLS_DISABLED',
        statusCode: 403,
        code: 'AI_POLICY_DENIED',
      });
    }
    await expect(
      decideApproval({ approvalId: randomUUID(), reviewerId: randomUUID(), approve: true }),
    ).rejects.toBeInstanceOf(AIToolDeniedError);
  });

  it('allows read/write tools without approval (flag habilitada em teste)', async () => {
    expect(await invokeAITool({ invocationId, tool: 'contact.lookup', args: { id: 'c1' } }))
      .toMatchObject({ decision: 'allow' });
    expect(await invokeAITool({ invocationId, tool: 'note.create', args: { text: 'nota' } }))
      .toMatchObject({ decision: 'allow' });
    expect(await invokeAITool({ invocationId, tool: 'contact.update', args: { id: 'c1' } }))
      .toMatchObject({ decision: 'allow' });
  });

  it('denies forbidden tools outright', async () => {
    const verdict = await invokeAITool({ invocationId, tool: 'audit.delete', args: {} });
    expect(verdict.decision).toBe('deny');
    if (verdict.decision === 'deny') {
      expect(verdict.reason).toContain('forbidden');
      expect(verdict.reasonCode).toBe('AI_TOOL_FORBIDDEN');
    }
  });

  it('human-approval flow: request → pending → approve → allow com USO ÚNICO', async () => {
    const args = { contactId: 'c-9', phone: '+5511999999999' };
    const first = await invokeAITool({ invocationId, tool: 'contact.delete', args });
    expect(first.decision).toBe('require_approval');
    if (first.decision !== 'require_approval') throw new Error('expected require_approval');

    // Segunda chamada reutiliza o mesmo registro (idempotente).
    const second = await invokeAITool({ invocationId, tool: 'contact.delete', args });
    expect(second).toMatchObject({ decision: 'require_approval', approvalId: first.approvalId });

    // Registro sanitizado: sem PII (inclusive aninhada).
    const [stored] = await db
      .select()
      .from(schema.aiActionApprovals)
      .where(eq(schema.aiActionApprovals.id, first.approvalId));
    expect(stored.status).toBe('PENDING');
    expect(JSON.stringify(stored.argsSanitized)).not.toContain('5511999999999');

    const reviewerId = await insertReviewer();
    try {
      const decided = await decideApproval({ approvalId: first.approvalId, reviewerId, approve: true });
      expect(decided?.status).toBe('APPROVED');
      expect(decided?.reviewerId).toBe(reviewerId);

      const after = await invokeAITool({ invocationId, tool: 'contact.delete', args });
      expect(after).toMatchObject({ decision: 'allow' });

      // Uso único: o mesmo approve NÃO autoriza a segunda execução.
      const replay = await invokeAITool({ invocationId, tool: 'contact.delete', args });
      expect(replay).toMatchObject({ decision: 'deny', reasonCode: 'AI_APPROVAL_CONSUMED' });

      const [consumed] = await db
        .select()
        .from(schema.aiActionApprovals)
        .where(eq(schema.aiActionApprovals.id, first.approvalId));
      expect(consumed.status).toBe('CONSUMED');
      expect(consumed.consumedAt).not.toBeNull();
    } finally {
      await db.delete(schema.aiActionApprovals).where(eq(schema.aiActionApprovals.invocationId, invocationId));
      await db.delete(schema.users).where(eq(schema.users.id, reviewerId));
    }
  });

  it('rejected approval keeps tool denied (sem novo pedido implícito)', async () => {
    const invocation = `${invocationId}-rej`;
    const args = { id: 'm-1' };
    const first = await invokeAITool({ invocationId: invocation, tool: 'message.delete', args });
    expect(first.decision).toBe('require_approval');
    if (first.decision !== 'require_approval') throw new Error('expected require_approval');

    const reviewerId = await insertReviewer();
    try {
      const decided = await decideApproval({ approvalId: first.approvalId, reviewerId, approve: false });
      expect(decided?.status).toBe('REJECTED');

      const again = await invokeAITool({ invocationId: invocation, tool: 'message.delete', args });
      expect(again).toMatchObject({ decision: 'deny', reasonCode: 'AI_APPROVAL_REJECTED' });

      // Reabertura é explícita (novo pedido humano), não automática.
      const reopened = await requestHumanApproval({ invocationId: invocation, tool: 'message.delete', args });
      expect(reopened.status).toBe('PENDING');
    } finally {
      await db.delete(schema.aiActionApprovals).where(eq(schema.aiActionApprovals.invocationId, invocation));
      await db.delete(schema.users).where(eq(schema.users.id, reviewerId));
    }
  });

  it('double decision on same approval returns null', async () => {
    const approval = await requestHumanApproval({ invocationId: `${invocationId}-dbl`, tool: 'contact.delete', args: {} });
    const reviewerId = await insertReviewer();
    try {
      expect(await decideApproval({ approvalId: approval.id, reviewerId, approve: true })).not.toBeNull();
      expect(await decideApproval({ approvalId: approval.id, reviewerId, approve: true })).toBeNull();
    } finally {
      await db.delete(schema.aiActionApprovals).where(eq(schema.aiActionApprovals.id, approval.id));
      await db.delete(schema.users).where(eq(schema.users.id, reviewerId));
    }
  });

  it('revisor não autorizado não decide (fail-closed)', async () => {
    const approval = await requestHumanApproval({ invocationId: `${invocationId}-authz`, tool: 'contact.delete', args: {} });
    try {
      await expect(
        decideApproval({ approvalId: approval.id, reviewerId: REVIEWER_BLOCKED, approve: true }),
      ).rejects.toMatchObject({ statusCode: 403, code: 'AI_POLICY_DENIED' });
      const [row] = await db
        .select()
        .from(schema.aiActionApprovals)
        .where(eq(schema.aiActionApprovals.id, approval.id));
      expect(row.status).toBe('PENDING');
    } finally {
      await db.delete(schema.aiActionApprovals).where(eq(schema.aiActionApprovals.id, approval.id));
    }
  });

  it('hash canônico do payload ORIGINAL: telefones diferentes NÃO colidem', () => {
    const a = hashToolArgs('contact.delete', { contactId: 'c1', phone: '+5511999999999' });
    const b = hashToolArgs('contact.delete', { contactId: 'c1', phone: '+5511888888888' });
    expect(a).not.toBe(b);
    // Ordem de chaves não altera o hash (canônico).
    expect(hashToolArgs('contact.delete', { a: 1, b: 2 })).toBe(hashToolArgs('contact.delete', { b: 2, a: 1 }));
    // Escopo entra no vínculo.
    expect(hashToolArgs('contact.delete', { id: 'c1' }, { actorId: 'u1' }))
      .not.toBe(hashToolArgs('contact.delete', { id: 'c1' }, { actorId: 'u2' }));
  });

  it('aprovação do payload A não autoriza payload B (hash original)', async () => {
    const invocation = `${invocationId}-payload`;
    const argsA = { contactId: 'c-a', phone: '+5511900000001' };
    const argsB = { contactId: 'c-b', phone: '+5511900000002' };
    const first = await invokeAITool({ invocationId: invocation, tool: 'contact.delete', args: argsA });
    expect(first.decision).toBe('require_approval');
    if (first.decision !== 'require_approval') throw new Error('expected require_approval');

    const reviewerId = await insertReviewer();
    try {
      await decideApproval({ approvalId: first.approvalId, reviewerId, approve: true });
      const withB = await invokeAITool({ invocationId: invocation, tool: 'contact.delete', args: argsB });
      expect(withB.decision).not.toBe('allow');
      expect(withB).toMatchObject({ decision: 'require_approval' });

      const withA = await invokeAITool({ invocationId: invocation, tool: 'contact.delete', args: argsA });
      expect(withA).toMatchObject({ decision: 'allow' });
    } finally {
      await db.delete(schema.aiActionApprovals).where(eq(schema.aiActionApprovals.invocationId, invocation));
      await db.delete(schema.users).where(eq(schema.users.id, reviewerId));
    }
  });

  it('aprovação expirada nega e é marcada EXPIRED', async () => {
    const invocation = `${invocationId}-exp`;
    const approval = await requestHumanApproval({
      invocationId: invocation,
      tool: 'contact.delete',
      args: { id: 'c1' },
      ttlMs: 50,
    });
    const reviewerId = await insertReviewer();
    try {
      // Decide após a validade: não vira APPROVED.
      await new Promise((resolveWait) => setTimeout(resolveWait, 80));
      const decided = await decideApproval({ approvalId: approval.id, reviewerId, approve: true });
      expect(decided === null || decided.status === 'EXPIRED').toBe(true);

      const denied = await invokeAITool({ invocationId: invocation, tool: 'contact.delete', args: { id: 'c1' } });
      expect(denied).toMatchObject({ decision: 'deny', reasonCode: 'AI_APPROVAL_EXPIRED' });
    } finally {
      await db.delete(schema.aiActionApprovals).where(eq(schema.aiActionApprovals.invocationId, invocation));
      await db.delete(schema.users).where(eq(schema.users.id, reviewerId));
    }
  });

  it('armazena escopo sanitizado recursivamente (sem PII)', async () => {
    const invocation = `${invocationId}-scope`;
    const approval = await requestHumanApproval({
      invocationId: invocation,
      tool: 'contact.delete',
      args: { id: 'c1' },
      scope: { actorId: 'u1', contact: { phone: '+5511999999999', email: 'a@b.c' } },
    });
    try {
      const [row] = await db
        .select()
        .from(schema.aiActionApprovals)
        .where(eq(schema.aiActionApprovals.id, approval.id));
      const serialized = JSON.stringify(row.scopeSanitized);
      expect(serialized).not.toContain('5511999999999');
      expect(serialized).not.toContain('a@b.c');
      expect(serialized).toContain('[PHONE]');
      expect(serialized).toContain('[EMAIL]');
    } finally {
      await db.delete(schema.aiActionApprovals).where(eq(schema.aiActionApprovals.id, approval.id));
    }
  });
});
