import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findAll: vi.fn(),
  findById: vi.fn(),
  findByContact: vi.fn(),
  accept: vi.fn(),
  reject: vi.fn(),
  updateConversationSector: vi.fn(),
  updateContactSector: vi.fn(),
}));

vi.mock('../infrastructure/repositories/transfer.repository', () => ({
  TransferRepository: vi.fn().mockImplementation(() => mocks),
}));

import * as useCases from '../application/use-cases';

describe('transfers use cases', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('auto-accepts and updates conversation/contact sectors when possible', async () => {
    mocks.create.mockResolvedValue({ id: 'transfer_1', status: 'accepted' });

    const result = await useCases.createTransfer({
      contactId: 'contact_1',
      conversationId: 'conv_1',
      fromSectorId: 'sector_old',
      toSectorId: 'sector_new',
      autoAccept: true,
    });

    expect(result.isOk()).toBe(true);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'accepted' }));
    expect(mocks.updateConversationSector).toHaveBeenCalledWith('conv_1', 'sector_new');
    expect(mocks.updateContactSector).toHaveBeenCalledWith('contact_1', 'sector_old', 'sector_new');
  });

  it('rejects accepting a transfer that is not pending', async () => {
    mocks.findById.mockResolvedValue({ id: 'transfer_1', status: 'accepted' });

    const result = await useCases.acceptTransfer('transfer_1');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toMatchObject({ code: 'BAD_REQUEST', statusCode: 400 });
    }
  });

  it('returns not found when rejecting a missing transfer', async () => {
    mocks.findById.mockResolvedValue(null);

    const result = await useCases.rejectTransfer('transfer_404');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    }
  });
});
