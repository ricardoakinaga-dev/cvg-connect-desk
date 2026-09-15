import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findAll: vi.fn(),
  findById: vi.fn(),
  findByContact: vi.fn(),
  findContact: vi.fn(),
  findSector: vi.fn(),
  findActiveUser: vi.fn(),
  findConversation: vi.fn(),
  lockContact: vi.fn(),
  findPendingDuplicate: vi.fn(),
  findLatestAccepted: vi.fn(),
  transition: vi.fn(),
  accept: vi.fn(),
  reject: vi.fn(),
  updateConversationSector: vi.fn(),
  updateContactSector: vi.fn(),
}));

const auditMock = vi.hoisted(() => ({ insertOperationalAudit: vi.fn() }));

vi.mock('../infrastructure/repositories/transfer.repository', () => ({
  TransferRepository: vi.fn().mockImplementation(() => mocks),
}));
vi.mock('../infrastructure/audit', () => auditMock);
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

import * as useCases from '../application/use-cases';
import { persistOutboxEventIntent } from '@cvg/events';

describe('transfers use cases — transacional/idempotente (PROD-18)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('auto-accept: cria, move setores, audita e grava outbox na mesma transação', async () => {
    mocks.findContact.mockResolvedValue({ id: 'contact_1' });
    mocks.findSector.mockResolvedValue({ id: 'sector_new', isActive: true });
    mocks.findConversation.mockResolvedValue({ id: 'conv_1', contactId: 'contact_1', sectorId: 'sector_old' });
    mocks.lockContact.mockResolvedValue(undefined);
    mocks.create.mockResolvedValue({
      id: 'transfer_1',
      contactId: 'contact_1',
      conversationId: 'conv_1',
      fromSectorId: 'sector_old',
      toSectorId: 'sector_new',
      status: 'accepted',
    });

    const result = await useCases.createTransfer({
      contactId: 'contact_1',
      conversationId: 'conv_1',
      fromSectorId: 'sector_old',
      toSectorId: 'sector_new',
      autoAccept: true,
      fromUserId: 'user_actor',
    });

    expect(result.isOk()).toBe(true);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'accepted' }),
      expect.anything(),
    );
    expect(mocks.updateConversationSector).toHaveBeenCalledWith('conv_1', 'sector_new', expect.anything());
    expect(mocks.updateContactSector).toHaveBeenCalledWith('contact_1', 'sector_old', 'sector_new', expect.anything());
    expect(auditMock.insertOperationalAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'contact_transfer.accepted', entityType: 'contact_transfer' }),
    );
    expect(persistOutboxEventIntent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event_type: 'transfer.accepted' }),
    );
  });

  it('auto-accept repetido no mesmo destino é deduplicado sem nova linha', async () => {
    mocks.findContact.mockResolvedValue({ id: 'contact_1' });
    mocks.findSector.mockResolvedValue({ id: 'sector_new', isActive: true });
    mocks.findConversation.mockResolvedValue({ id: 'conv_1', contactId: 'contact_1', sectorId: 'sector_new' });
    mocks.lockContact.mockResolvedValue(undefined);
    mocks.findLatestAccepted.mockResolvedValue({ id: 'transfer_existing', status: 'accepted' });

    const result = await useCases.createTransfer({
      contactId: 'contact_1',
      conversationId: 'conv_1',
      toSectorId: 'sector_new',
      autoAccept: true,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.deduplicated).toBe(true);
      expect(result.value.id).toBe('transfer_existing');
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('aceite repetido é idempotente (200 dedup) sem novo efeito', async () => {
    mocks.findById.mockResolvedValue({ id: 'transfer_1', status: 'accepted' });

    const result = await useCases.acceptTransfer({ transferId: 'transfer_1', actorId: 'user_actor' });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.deduplicated).toBe(true);
    }
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  it('aceitar transferência já rejeitada responde 409', async () => {
    mocks.findById.mockResolvedValue({ id: 'transfer_1', status: 'rejected' });

    const result = await useCases.acceptTransfer({ transferId: 'transfer_1', actorId: 'user_actor' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toMatchObject({ code: 'TRANSFER_STATE_CONFLICT', statusCode: 409 });
    }
  });

  it('rejeitar transferência inexistente responde 404', async () => {
    mocks.findById.mockResolvedValue(null);

    const result = await useCases.rejectTransfer({ transferId: 'transfer_404', actorId: 'user_actor' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    }
  });
});
