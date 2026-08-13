import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
}));

const ormMock = vi.hoisted(() => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ type: 'eq', left, right })),
  desc: vi.fn((column: unknown) => ({ type: 'desc', column })),
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  count: vi.fn(() => 'count()'),
  inArray: vi.fn((left: unknown, values: unknown[]) => ({ type: 'inArray', left, values })),
}));

vi.mock('@cvg/database', () => ({
  db: dbMock,
  schema: {
    conversations: {
      id: 'conversations.id',
      externalConversationId: 'conversations.externalConversationId',
      contactId: 'conversations.contactId',
      isActive: 'conversations.isActive',
      status: { enumValues: ['open', 'pending', 'closed', 'archived'] },
      statusV2: { enumValues: ['novo', 'em_atendimento', 'pendente', 'em_espera', 'finalizado', 'arquivado'] },
      queueId: 'conversations.queueId',
      teamId: 'conversations.teamId',
      sectorId: 'conversations.sectorId',
      assignedUserId: 'conversations.assignedUserId',
      createdAt: 'conversations.createdAt',
    },
    conversationStatusHistory: {
      conversationId: 'conversationStatusHistory.conversationId',
      status: { enumValues: ['open', 'pending', 'closed', 'archived'] },
    },
    userSectors: {
      sectorId: 'userSectors.sectorId',
      userId: 'userSectors.userId',
    },
  },
}));

vi.mock('drizzle-orm', () => ormMock);

const { conversationRepository } = await import('../infrastructure/repositories/conversation.repository');

function insertChain(row: unknown) {
  const returning = vi.fn().mockResolvedValue([row]);
  const values = vi.fn(() => ({ returning }));
  dbMock.insert.mockReturnValue({ values });
  return { values, returning };
}

function updateChain(row: unknown) {
  const returning = vi.fn().mockResolvedValue([row]);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  dbMock.update.mockReturnValue({ set });
  return { set, where, returning };
}

function selectWhereChain(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn(() => ({ where }));
  dbMock.select.mockReturnValue({ from });
  return { from, where };
}

describe('conversationRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates and finds conversations', async () => {
    const row = { id: 'conversation-1' };
    const chain = insertChain(row);
    await expect(conversationRepository.create({ status: 'open' } as never)).resolves.toBe(row);
    expect(chain.values).toHaveBeenCalledWith({ status: 'open' });

    selectWhereChain([row]);
    await expect(conversationRepository.findById('conversation-1')).resolves.toBe(row);

    selectWhereChain([]);
    await expect(conversationRepository.findByExternalId('external-1')).resolves.toBeNull();
  });

  it('finds conversations by contact and active contact', async () => {
    selectWhereChain([{ id: 'conversation-1' }]);
    await expect(conversationRepository.findByContactId('contact-1')).resolves.toEqual([{ id: 'conversation-1' }]);

    selectWhereChain([{ id: 'conversation-2', isActive: true }]);
    await expect(conversationRepository.findActiveByContactId('contact-1')).resolves.toEqual([
      { id: 'conversation-2', isActive: true },
    ]);
    expect(ormMock.and).toHaveBeenCalled();
  });

  it('lists conversations with filters and user sector scoping', async () => {
    const userSectors = [{ sectorId: 'sector-1' }, { sectorId: 'sector-2' }];
    const sectorWhere = vi.fn().mockResolvedValue(userSectors);
    const sectorFrom = vi.fn(() => ({ where: sectorWhere }));
    const orderBy = vi.fn().mockResolvedValue([{ id: 'conversation-1' }]);
    const where = vi.fn(() => ({ orderBy }));
    const dynamic = vi.fn(() => ({ where, orderBy }));
    const from = vi
      .fn()
      .mockReturnValueOnce({ $dynamic: dynamic })
      .mockReturnValueOnce({ where: sectorWhere });

    dbMock.select
      .mockReturnValueOnce({ from })
      .mockReturnValueOnce({ from: sectorFrom });

    await expect(conversationRepository.findAll({
      status: 'open',
      statusV2: 'novo',
      queueId: 'queue-1',
      teamId: 'team-1',
      assignedUserId: 'user-2',
      userId: 'user-1',
    })).resolves.toEqual([{ id: 'conversation-1' }]);

    expect(ormMock.inArray).toHaveBeenCalledWith('conversations.sectorId', ['sector-1', 'sector-2']);
    expect(where).toHaveBeenCalled();
  });

  it('lists conversations without filtering when user has no sector scope', async () => {
    const sectorWhere = vi.fn().mockResolvedValue([]);
    const sectorFrom = vi.fn(() => ({ where: sectorWhere }));
    const orderBy = vi.fn().mockResolvedValue([{ id: 'conversation-1' }]);
    const dynamic = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ $dynamic: dynamic }));

    dbMock.select
      .mockReturnValueOnce({ from })
      .mockReturnValueOnce({ from: sectorFrom });

    await expect(conversationRepository.findAll({ userId: 'user-1' })).resolves.toEqual([{ id: 'conversation-1' }]);

    expect(ormMock.inArray).not.toHaveBeenCalled();
  });

  it('updates conversation state and handler fields', async () => {
    const base = { id: 'conversation-1' };
    let chain = updateChain({ ...base, status: 'open' });
    await conversationRepository.update('conversation-1', { status: 'open' } as never);
    expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'open', updatedAt: expect.any(Date) }));

    chain = updateChain({ ...base, statusV2: 'finalizado', status: 'closed', isActive: false });
    await conversationRepository.updateStatusV2('conversation-1', 'finalizado', 'user-1');
    expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({
      statusV2: 'finalizado',
      status: 'closed',
      isActive: false,
      closedAt: expect.any(Date),
      assignedUserId: 'user-1',
    }));

    chain = updateChain({ ...base, sectorId: 'sector-1' });
    await conversationRepository.updateSector('conversation-1', 'sector-1');
    expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ sectorId: 'sector-1' }));

    chain = updateChain({ ...base, assignedUserId: 'user-1' });
    await conversationRepository.assignUser('conversation-1', 'user-1');
    expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ assignedUserId: 'user-1' }));

    chain = updateChain({ ...base, status: 'closed' });
    await conversationRepository.close('conversation-1');
    expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({
      isActive: false,
      status: 'closed',
      statusV2: 'finalizado',
      closedAt: expect.any(Date),
    }));

    chain = updateChain({ ...base, currentHandler: 'human' });
    await conversationRepository.updateCurrentHandler('conversation-1', 'human');
    expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({ currentHandler: 'human' }));
  });

  it('maps statusV2 fallbacks while updating status', async () => {
    const chain = updateChain({ id: 'conversation-1', statusV2: 'desconhecido', status: 'open' });

    await conversationRepository.updateStatusV2('conversation-1', 'desconhecido');

    expect(chain.set).toHaveBeenCalledWith(expect.objectContaining({
      statusV2: 'desconhecido',
      status: 'open',
    }));
  });

  it('adds status history and computes kanban counts', async () => {
    const historyChain = insertChain({ id: 'history-1' });
    await expect(conversationRepository.addStatusHistory('conversation-1', 'open', 'user-1', 'created')).resolves.toEqual({
      id: 'history-1',
    });
    expect(historyChain.values).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      status: 'open',
      changedBy: 'user-1',
      reason: 'created',
    });

    const groupByStatus = vi.fn().mockResolvedValue([{ statusV2: 'novo', count: 1 }]);
    const whereStatus = vi.fn(() => ({ groupBy: groupByStatus }));
    const fromStatus = vi.fn(() => ({ where: whereStatus }));
    dbMock.select.mockReturnValueOnce({ from: fromStatus });

    await expect(conversationRepository.countByStatusV2('sector-1')).resolves.toEqual([{ statusV2: 'novo', count: 1 }]);
    expect(whereStatus).toHaveBeenCalled();

    const groupBySector = vi.fn().mockResolvedValue([{ sectorId: 'sector-1', count: 1 }]);
    const whereSector = vi.fn(() => ({ groupBy: groupBySector }));
    const fromSector = vi.fn(() => ({ where: whereSector }));
    dbMock.select.mockReturnValueOnce({ from: fromSector });

    await expect(conversationRepository.countBySector()).resolves.toEqual([{ sectorId: 'sector-1', count: 1 }]);
  });
});
