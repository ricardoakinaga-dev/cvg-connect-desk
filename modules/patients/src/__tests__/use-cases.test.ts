import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findAll: vi.fn(),
  findById: vi.fn(),
  tutorExists: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getWithDetails: vi.fn(),
  getReferenceCounts: vi.fn(),
  getStats: vi.fn(),
}));

vi.mock('../infrastructure/repositories/patient.repository', () => ({
  PatientRepository: vi.fn().mockImplementation(() => mocks),
}));

import * as useCases from '../application/use-cases';

describe('patient use cases', () => {
  afterEach(() => vi.clearAllMocks());

  it('rejects an unknown tutor before creating a patient', async () => {
    mocks.tutorExists.mockResolvedValue(false);

    const result = await useCases.createPatient({ name: 'Rex', tutorId: 'missing-tutor' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error).toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('normalizes optional fields and preserves the relationship', async () => {
    mocks.tutorExists.mockResolvedValue(true);
    mocks.create.mockResolvedValue({ id: 'patient-1', name: 'Rex' });

    const result = await useCases.createPatient({
      name: ' Rex ', species: ' Cachorro ', breed: ' SRD ', tutorId: 'tutor-1',
    });

    expect(result.isOk()).toBe(true);
    expect(mocks.create).toHaveBeenCalledWith({
      name: 'Rex', species: 'Cachorro', breed: 'SRD', tutorId: 'tutor-1', externalId: undefined,
    });
  });

  it('does not delete a patient with linked records', async () => {
    mocks.findById.mockResolvedValue({ id: 'patient-1' });
    mocks.getReferenceCounts.mockResolvedValue({ contacts: 0, tasks: 1, notes: 0 });

    const result = await useCases.deletePatient('patient-1');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error).toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});
