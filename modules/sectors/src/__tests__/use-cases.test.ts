import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findAll: vi.fn(),
  findById: vi.fn(),
  findByCode: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getConversations: vi.fn(),
  getStats: vi.fn(),
}));

vi.mock('../infrastructure/repositories/sector.repository', () => ({
  SectorRepository: vi.fn().mockImplementation(() => mocks),
}));

import * as useCases from '../application/use-cases';

describe('sectors use cases', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects duplicate sector codes on create', async () => {
    mocks.findByCode.mockResolvedValue({ id: 'sector_1', code: 'SUP' });

    const result = await useCases.createSector({ name: 'Suporte', code: 'SUP' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    }
  });

  it('returns not found when requesting stats for a missing sector', async () => {
    mocks.findById.mockResolvedValue(null);

    const result = await useCases.getSectorStats('sector_404');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    }
  });

  it('combines sector data with stats for the overview', async () => {
    mocks.findAll.mockResolvedValue([
      { id: 'sector_1', name: 'Suporte' },
      { id: 'sector_2', name: 'Triagem' },
    ]);
    mocks.getStats
      .mockResolvedValueOnce({ totalConversations: 10, activeConversations: 4, pendingConversations: 2 })
      .mockResolvedValueOnce({ totalConversations: 5, activeConversations: 1, pendingConversations: 0 });

    const result = await useCases.getAllSectorStats();

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual([
        {
          id: 'sector_1',
          name: 'Suporte',
          totalConversations: 10,
          activeConversations: 4,
          pendingConversations: 2,
        },
        {
          id: 'sector_2',
          name: 'Triagem',
          totalConversations: 5,
          activeConversations: 1,
          pendingConversations: 0,
        },
      ]);
    }
  });
});
