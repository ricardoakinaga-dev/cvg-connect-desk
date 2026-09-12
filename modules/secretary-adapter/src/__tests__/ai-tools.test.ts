import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db, schema } from '@cvg/database';
import { eq } from 'drizzle-orm';
import {
  classifyAITool,
  invokeAITool,
  requestHumanApproval,
  decideApproval,
} from '../application/ai-tools';
import { clearAIDecisions } from '../application/ai-policy';

describe('AI tool registry + human approval (real PG)', () => {
  const invocationId = `ai-tools-${Date.now()}`;

  beforeEach(() => {
    clearAIDecisions();
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

  it('allows read/write tools without approval', async () => {
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
    }
  });

  it('human-approval flow: request → pending → approve → allow', async () => {
    const args = { contactId: 'c-9', phone: '+5511999999999' };
    const first = await invokeAITool({ invocationId, tool: 'contact.delete', args });
    expect(first.decision).toBe('require_approval');
    if (first.decision !== 'require_approval') throw new Error('expected require_approval');

    // Segunda chamada reutiliza o mesmo registro (idempotente).
    const second = await invokeAITool({ invocationId, tool: 'contact.delete', args });
    expect(second).toMatchObject({ decision: 'require_approval', approvalId: first.approvalId });

    // Registro sanitizado: sem PII.
    const [stored] = await db
      .select()
      .from(schema.aiActionApprovals)
      .where(eq(schema.aiActionApprovals.id, first.approvalId));
    expect(stored.status).toBe('PENDING');
    expect(JSON.stringify(stored.argsSanitized)).not.toContain('5511999999999');

    const reviewerId = randomUUID();
    await db.insert(schema.users).values({
      id: reviewerId,
      name: 'Reviewer',
      email: `reviewer.${Date.now()}@example.com`,
      passwordHash: 'x',
      isActive: true,
    });
    try {
      const decided = await decideApproval({ approvalId: first.approvalId, reviewerId, approve: true });
      expect(decided?.status).toBe('APPROVED');
      expect(decided?.reviewerId).toBe(reviewerId);

      const after = await invokeAITool({ invocationId, tool: 'contact.delete', args });
      expect(after).toMatchObject({ decision: 'allow' });
    } finally {
      await db.delete(schema.aiActionApprovals).where(eq(schema.aiActionApprovals.invocationId, invocationId));
      await db.delete(schema.users).where(eq(schema.users.id, reviewerId));
    }
  });

  it('rejected approval keeps tool denied', async () => {
    const invocation = `${invocationId}-rej`;
    const args = { id: 'm-1' };
    const first = await invokeAITool({ invocationId: invocation, tool: 'message.delete', args });
    expect(first.decision).toBe('require_approval');
    if (first.decision !== 'require_approval') throw new Error('expected require_approval');

    const reviewerId = randomUUID();
    await db.insert(schema.users).values({
      id: reviewerId,
      name: 'Reviewer',
      email: `reviewer.rej.${Date.now()}@example.com`,
      passwordHash: 'x',
      isActive: true,
    });
    try {
      const decided = await decideApproval({ approvalId: first.approvalId, reviewerId, approve: false });
      expect(decided?.status).toBe('REJECTED');

      const again = await invokeAITool({ invocationId: invocation, tool: 'message.delete', args });
      expect(again.decision).toBe('require_approval');
    } finally {
      await db.delete(schema.aiActionApprovals).where(eq(schema.aiActionApprovals.invocationId, invocation));
      await db.delete(schema.users).where(eq(schema.users.id, reviewerId));
    }
  });

  it('double decision on same approval returns null', async () => {
    const approval = await requestHumanApproval({ invocationId: `${invocationId}-dbl`, tool: 'contact.delete', args: {} });
    const reviewerId = randomUUID();
    await db.insert(schema.users).values({
      id: reviewerId,
      name: 'Reviewer',
      email: `reviewer.dbl.${Date.now()}@example.com`,
      passwordHash: 'x',
      isActive: true,
    });
    try {
      expect(await decideApproval({ approvalId: approval.id, reviewerId, approve: true })).not.toBeNull();
      expect(await decideApproval({ approvalId: approval.id, reviewerId, approve: true })).toBeNull();
    } finally {
      await db.delete(schema.aiActionApprovals).where(eq(schema.aiActionApprovals.id, approval.id));
      await db.delete(schema.users).where(eq(schema.users.id, reviewerId));
    }
  });
});
