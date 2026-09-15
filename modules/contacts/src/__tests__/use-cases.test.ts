import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findAll: vi.fn(),
  findById: vi.fn(),
  findByPhone: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getWithDetails: vi.fn(),
  getActiveConversation: vi.fn(),
  lockById: vi.fn(),
  getStats: vi.fn(),
  conversationFindActive: vi.fn(),
  conversationCreate: vi.fn(),
  addStatusHistory: vi.fn(),
}));

vi.mock('../infrastructure/repositories/contact.repository', () => ({
  ContactRepository: vi.fn().mockImplementation(() => mocks),
}));

vi.mock('@cvg/chat', () => ({
  conversationRepository: {
    create: mocks.conversationCreate,
    addStatusHistory: mocks.addStatusHistory,
    findActiveByContactId: mocks.conversationFindActive,
  },
}));

vi.mock('@cvg/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cvg/database')>();
  return {
    ...actual,
    db: { transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({}) },
  };
});

vi.mock('@cvg/audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cvg/audit')>();
  return { ...actual, insertAuditLog: vi.fn() };
});

vi.mock('@cvg/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cvg/events')>();
  return {
    ...actual,
    persistOutboxEventIntent: vi.fn(),
    publishRealtimeHintsAfterCommit: vi.fn(),
  };
});

import * as useCases from '../application/use-cases';

describe('contacts use cases', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects duplicate phone numbers on create', async () => {
    mocks.findByPhone.mockResolvedValue({ id: 'contact_1', phone: '5511999999999' });

    const result = await useCases.createContact({
      name: 'Maria',
      phone: '(11) 99999-9999',
      email: 'maria@example.com',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    }
  });

  it('reuses an existing active conversation when starting one', async () => {
    mocks.lockById.mockResolvedValue({ id: 'contact_1' });
    mocks.conversationFindActive.mockResolvedValue({ id: 'conv_1' });

    const result = await useCases.startConversation('contact_1', 'sector_1', 'user_1');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toMatchObject({ conversationId: 'conv_1', isNew: false, deduplicated: true });
    }
    expect(mocks.conversationCreate).not.toHaveBeenCalled();
    expect(mocks.addStatusHistory).not.toHaveBeenCalled();
  });

  it('creates a new conversation and history when no active one exists', async () => {
    mocks.lockById.mockResolvedValue({ id: 'contact_1', phone: '5511999999999' });
    mocks.conversationFindActive.mockResolvedValue(null);
    mocks.conversationCreate.mockResolvedValue({
      id: 'conv_new',
      externalConversationId: 'desk_5511999999999_1',
      externalChannelId: 'whatsapp',
      createdAt: new Date('2026-09-15T00:00:00.000Z'),
    });

    const result = await useCases.startConversation('contact_1', 'sector_1', 'user_1');

    expect(result.isOk()).toBe(true);
    expect(mocks.conversationCreate).toHaveBeenCalledWith(expect.objectContaining({
      contactId: 'contact_1',
      status: 'open',
      statusV2: 'novo',
      isActive: true,
      sectorId: 'sector_1',
      assignedUserId: 'user_1',
    }), expect.anything());
    expect(mocks.addStatusHistory).toHaveBeenCalledWith(
      'conv_new', 'open', 'user_1', 'Conversa iniciada pelo Desk', expect.anything(),
    );
  });

  it('returns not found when fetching a missing contact', async () => {
    mocks.getWithDetails.mockResolvedValue(null);

    const result = await useCases.getContact('contact_404');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    }
  });
});
