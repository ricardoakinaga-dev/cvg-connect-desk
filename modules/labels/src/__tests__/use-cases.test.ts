import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findAll: vi.fn(),
  findById: vi.fn(),
  findByName: vi.fn(),
  findByCategory: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getConversationLabels: vi.fn(),
  addConversationLabel: vi.fn(),
  removeConversationLabel: vi.fn(),
  getContactLabels: vi.fn(),
  addContactLabel: vi.fn(),
  removeContactLabel: vi.fn(),
}));

vi.mock('../infrastructure/repositories/label.repository', () => ({
  LabelRepository: vi.fn().mockImplementation(() => mocks),
}));

import * as useCases from '../application/use-cases';

describe('labels use cases', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists labels from repository', async () => {
    mocks.findAll.mockResolvedValue([{ id: 'label_1', name: 'Urgente' }]);

    const result = await useCases.listLabels();

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual([{ id: 'label_1', name: 'Urgente' }]);
    }
  });

  it('rejects duplicate label names on create', async () => {
    mocks.findByName.mockResolvedValue({ id: 'label_1', name: 'Urgente' });

    const result = await useCases.createLabel({ name: 'Urgente', color: '#ff0000' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    }
  });

  it('blocks edits for system labels', async () => {
    mocks.findById.mockResolvedValue({ id: 'label_1', isSystem: true });

    const result = await useCases.updateLabel('label_1', { description: 'new' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    }
  });

  it('adds a conversation label only when the label exists', async () => {
    mocks.findById.mockResolvedValue({ id: 'label_1', isSystem: false });

    const result = await useCases.addConversationLabel('conv_1', 'label_1', 'user_1');

    expect(result.isOk()).toBe(true);
    expect(mocks.addConversationLabel).toHaveBeenCalledWith('conv_1', 'label_1', 'user_1');
  });

  it('returns not found when adding a missing contact label', async () => {
    mocks.findById.mockResolvedValue(null);

    const result = await useCases.addContactLabel('contact_1', 'label_404');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    }
  });
});
