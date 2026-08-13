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
}));

vi.mock('@cvg/database', () => ({
  db: dbMock,
  schema: {
    messages: {
      id: 'messages.id',
      conversationId: 'messages.conversationId',
      externalMessageId: 'messages.externalMessageId',
      direction: 'messages.direction',
      status: {
        enumValues: ['pending', 'sent', 'delivered', 'failed'],
      },
      createdAt: 'messages.createdAt',
    },
  },
}));

vi.mock('drizzle-orm', () => ormMock);

const { messageRepository } = await import('../infrastructure/repositories/message.repository');

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

describe('messageRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates messages and returns the inserted row', async () => {
    const row = { id: 'message-1' };
    const chain = insertChain(row);

    await expect(messageRepository.create({ content: 'Oi' } as never)).resolves.toBe(row);

    expect(chain.values).toHaveBeenCalledWith({ content: 'Oi' });
  });

  it('finds messages by id and external id', async () => {
    selectWhereChain([{ id: 'message-1' }]);
    await expect(messageRepository.findById('message-1')).resolves.toEqual({ id: 'message-1' });

    selectWhereChain([]);
    await expect(messageRepository.findByExternalId('external-1')).resolves.toBeNull();
  });

  it('lists messages by conversation ordered by newest first', async () => {
    const rows = [{ id: 'message-1' }];
    const orderBy = vi.fn().mockResolvedValue(rows);
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    dbMock.select.mockReturnValue({ from });

    await expect(messageRepository.findByConversationId('conversation-1')).resolves.toBe(rows);

    expect(orderBy).toHaveBeenCalledWith({ type: 'desc', column: 'messages.createdAt' });
  });

  it('limits recent messages by conversation', async () => {
    const rows = [{ id: 'message-1' }];
    const limit = vi.fn().mockResolvedValue(rows);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    dbMock.select.mockReturnValue({ from });

    await expect(messageRepository.findRecentByConversationId('conversation-1', 3)).resolves.toBe(rows);

    expect(limit).toHaveBeenCalledWith(3);
  });

  it('updates status, delivery status and arbitrary fields', async () => {
    const statusChain = updateChain({ id: 'message-1', status: 'sent' });
    await expect(messageRepository.updateStatus('message-1', 'sent')).resolves.toEqual({ id: 'message-1', status: 'sent' });
    expect(statusChain.set).toHaveBeenCalledWith({ status: 'sent' });

    const deliveredAt = new Date('2026-04-28T00:00:00.000Z');
    const deliveryChain = updateChain({ id: 'message-1', status: 'delivered', deliveredAt });
    await expect(messageRepository.updateDeliveryStatus('message-1', deliveredAt)).resolves.toEqual({
      id: 'message-1',
      status: 'delivered',
      deliveredAt,
    });
    expect(deliveryChain.set).toHaveBeenCalledWith({ status: 'delivered', deliveredAt });

    const update = { metadata: { retry: true } };
    const updateFieldsChain = updateChain({ id: 'message-1', ...update });
    await expect(messageRepository.update('message-1', update as never)).resolves.toEqual({ id: 'message-1', ...update });
    expect(updateFieldsChain.set).toHaveBeenCalledWith(update);
  });

  it('finds pending outbound messages with default and explicit limits', async () => {
    const rows = [{ id: 'message-1' }];
    const limit = vi.fn().mockResolvedValue(rows);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    dbMock.select.mockReturnValue({ from });

    await expect(messageRepository.findPendingOutbound()).resolves.toBe(rows);
    expect(limit).toHaveBeenCalledWith(10);

    await messageRepository.findPendingOutbound(25);
    expect(limit).toHaveBeenLastCalledWith(25);
  });
});
