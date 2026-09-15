import { beforeEach, describe, expect, it, vi } from 'vitest';

const repositoryCreate = vi.hoisted(() => vi.fn());
const auditInsert = vi.hoisted(() => vi.fn());

vi.mock('../infrastructure/repositories/note.repository', () => ({
  noteRepository: { create: repositoryCreate },
}));
vi.mock('../infrastructure/audit', () => ({
  insertOperationalAudit: auditInsert,
}));
vi.mock('@cvg/database', () => ({
  db: {
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({}),
  },
  schema: {},
}));
vi.mock('@cvg/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cvg/events')>();
  return {
    ...actual,
    persistOutboxEventIntent: vi.fn(),
    publishRealtimeHintsAfterCommit: vi.fn(),
  };
});

import { createNote } from '../application/use-cases/create-note.use-case';
import { persistOutboxEventIntent } from '@cvg/events';

describe('createNote — autoria vinculada ao principal e transação (PROD-18)', () => {
  const conversationId = '11111111-1111-4111-8111-111111111111';
  const actorA = '22222222-2222-4222-8222-222222222222';
  const actorB = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    repositoryCreate.mockReset();
    repositoryCreate.mockImplementation(async (data: { conversationId?: string; authorId?: string }) => ({
      id: 'note-unit-1',
      conversationId: data.conversationId ?? null,
      taskId: null,
      authorId: data.authorId,
      referenceType: 'conversation',
      referenceId: data.conversationId ?? null,
      createdAt: new Date('2026-09-13T00:00:00.000Z'),
    }));
    auditInsert.mockReset();
    auditInsert.mockResolvedValue(undefined);
    vi.mocked(persistOutboxEventIntent).mockReset();
    vi.mocked(persistOutboxEventIntent).mockResolvedValue(undefined);
  });

  it('rejeita authorId divergente do principal sem persistir', async () => {
    const result = await createNote({
      conversationId,
      content: 'tentativa de spoof',
      userId: actorA,
      authorId: actorB,
    });

    expect(result.isErr()).toBe(true);
    expect(repositoryCreate).not.toHaveBeenCalled();
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it('sem authorId persiste o principal e audita o ator real no mesmo tx', async () => {
    const result = await createNote({ conversationId, content: 'nota do ator A', userId: actorA });

    expect(result.isOk()).toBe(true);
    expect(repositoryCreate).toHaveBeenCalledTimes(1);
    expect(repositoryCreate.mock.calls[0][0]).toMatchObject({ authorId: actorA, conversationId });
    expect(auditInsert).toHaveBeenCalledTimes(1);
    expect(auditInsert.mock.calls[0][1]).toMatchObject({
      userId: actorA,
      action: 'note.created',
      entityType: 'note',
      metadata: { authorId: actorA },
    });
    expect(persistOutboxEventIntent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event_type: 'note.created' }),
    );
  });

  it('authorId igual ao principal é aceito e persistido como o principal', async () => {
    const result = await createNote({
      conversationId,
      content: 'nota compatível',
      userId: actorA,
      authorId: actorA,
    });

    expect(result.isOk()).toBe(true);
    expect(repositoryCreate.mock.calls[0][0]).toMatchObject({ authorId: actorA });
  });

  it('sem userId rejeita authorId vindo do corpo (não confia no cliente)', async () => {
    const result = await createNote({
      conversationId,
      content: 'sem principal',
      authorId: actorB,
    });

    expect(result.isErr()).toBe(true);
    expect(repositoryCreate).not.toHaveBeenCalled();
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it('sem userId nem authorId também é rejeitado', async () => {
    const result = await createNote({ conversationId, content: 'sem autor' });

    expect(result.isErr()).toBe(true);
    expect(repositoryCreate).not.toHaveBeenCalled();
  });

  it('sem content retorna erro mesmo com principal', async () => {
    const result = await createNote({ conversationId, content: '', userId: actorA });

    expect(result.isErr()).toBe(true);
    expect(repositoryCreate).not.toHaveBeenCalled();
  });
});
