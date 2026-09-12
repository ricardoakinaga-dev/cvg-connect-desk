import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findAll: vi.fn(),
  findById: vi.fn(),
  findByPhone: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getWithPatients: vi.fn(),
  getReferenceCounts: vi.fn(),
  getStats: vi.fn(),
}));

vi.mock('../infrastructure/repositories/tutor.repository', () => ({
  TutorRepository: vi.fn().mockImplementation(() => mocks),
  normalizePhone: (phone: string) => phone.replace(/\D/g, ''),
}));

import * as useCases from '../application/use-cases';

describe('tutor use cases', () => {
  afterEach(() => vi.clearAllMocks());

  it('normalizes a phone and rejects duplicates', async () => {
    mocks.findByPhone.mockResolvedValue({ id: 'tutor-1' });

    const result = await useCases.createTutor({ name: ' Maria ', phone: '(11) 99999-0000' });

    expect(result.isErr()).toBe(true);
    expect(mocks.findByPhone).toHaveBeenCalledWith('11999990000');
  });

  it('rejects blank names before touching the repository', async () => {
    const result = await useCases.createTutor({ name: '   ' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error).toMatchObject({ code: 'BAD_REQUEST', statusCode: 400 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('does not delete a tutor with linked records', async () => {
    mocks.findById.mockResolvedValue({ id: 'tutor-1' });
    mocks.getReferenceCounts.mockResolvedValue({ patients: 1, contacts: 0, tasks: 0, notes: 0 });

    const result = await useCases.deleteTutor('tutor-1');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error).toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});
