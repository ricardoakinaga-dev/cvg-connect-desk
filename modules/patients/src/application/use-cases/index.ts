import { BadRequestError, ConflictError, NotFoundError, err, ok } from '@cvg/shared';
import type { CreatePatientInput, UpdatePatientInput } from '../../types';
import { PatientRepository } from '../../infrastructure/repositories/patient.repository';

const repo = new PatientRepository();

function isBadRequest(error: unknown): error is BadRequestError {
  return error instanceof BadRequestError || (typeof error === 'object' && error !== null && (error as { statusCode?: number }).statusCode === 400);
}

function normalizeOptionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const normalized = value.trim();
  return normalized || null;
}

function validatedName(name: string | undefined): string {
  const normalized = name?.trim() || '';
  if (!normalized) throw new BadRequestError('Nome é obrigatório');
  return normalized;
}

async function validateTutor(tutorId: string | null | undefined) {
  if (tutorId && !(await repo.tutorExists(tutorId))) {
    return err(new NotFoundError('Tutor'));
  }
  return null;
}

export async function listPatients(filters?: { search?: string; tutorId?: string; species?: string }) {
  return ok(await repo.findAll(filters));
}

export async function getPatient(id: string) {
  const patient = await repo.getWithDetails(id);
  if (!patient) return err(new NotFoundError('Paciente'));
  return ok(patient);
}

export async function createPatient(input: CreatePatientInput) {
  try {
    const name = validatedName(input.name);
    const tutorError = await validateTutor(input.tutorId);
    if (tutorError) return tutorError;

    const patient = await repo.create({
      name,
      species: normalizeOptionalText(input.species),
      breed: normalizeOptionalText(input.breed),
      tutorId: input.tutorId ?? null,
      externalId: normalizeOptionalText(input.externalId),
    });
    return ok(patient);
  } catch (error) {
    if (isBadRequest(error)) return err(error);
    throw error;
  }
}

export async function updatePatient(id: string, input: UpdatePatientInput) {
  const patient = await repo.findById(id);
  if (!patient) return err(new NotFoundError('Paciente'));

  try {
    const tutorError = await validateTutor(input.tutorId);
    if (tutorError) return tutorError;

    const updated = await repo.update(id, {
      ...input,
      name: input.name === undefined ? undefined : validatedName(input.name),
      species: normalizeOptionalText(input.species),
      breed: normalizeOptionalText(input.breed),
      externalId: normalizeOptionalText(input.externalId),
    });
    if (!updated) return err(new NotFoundError('Paciente'));
    return ok(updated);
  } catch (error) {
    if (isBadRequest(error)) return err(error);
    throw error;
  }
}

export async function deletePatient(id: string) {
  const patient = await repo.findById(id);
  if (!patient) return err(new NotFoundError('Paciente'));

  const references = await repo.getReferenceCounts(id);
  if (Object.values(references).some((value) => value > 0)) {
    return err(new ConflictError('Paciente possui registros vinculados e não pode ser excluído'));
  }

  await repo.delete(id);
  return ok({ deleted: true });
}

export async function getPatientStats() {
  return ok(await repo.getStats());
}
