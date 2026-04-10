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
  getStats: vi.fn(),
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
  },
}));

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
    mocks.findById.mockResolvedValue({ id: 'contact_1' });
    mocks.getActiveConversation.mockResolvedValue({ id: 'conv_1' });

    const result = await useCases.startConversation('contact_1', 'sector_1', 'user_1');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ conversationId: 'conv_1', isNew: false });
    }
    expect(mocks.conversationCreate).not.toHaveBeenCalled();
  });

  it('creates a new conversation and history when no active one exists', async () => {
    mocks.findById.mockResolvedValue({ id: 'contact_1', phone: '5511999999999' });
    mocks.getActiveConversation.mockResolvedValue(null);
    mocks.conversationCreate.mockResolvedValue({ id: 'conv_new' });

    const result = await useCases.startConversation('contact_1', 'sector_1', 'user_1');

    expect(result.isOk()).toBe(true);
    expect(mocks.conversationCreate).toHaveBeenCalledWith(expect.objectContaining({
      contactId: 'contact_1',
      status: 'open',
      statusV2: 'novo',
      isActive: true,
      sectorId: 'sector_1',
      assignedUserId: 'user_1',
    }));
    expect(mocks.addStatusHistory).toHaveBeenCalledWith('conv_new', 'open', 'user_1', 'Conversa iniciada pelo Desk');
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
