import { ConflictError, BadRequestError, NotFoundError, err, ok } from '@cvg/shared';
import type { CreateTutorInput, UpdateTutorInput } from '../../types';
import { normalizePhone, TutorRepository } from '../../infrastructure/repositories/tutor.repository';

const repo = new TutorRepository();

function isBadRequest(error: unknown): error is BadRequestError {
  return error instanceof BadRequestError || (typeof error === 'object' && error !== null && (error as { statusCode?: number }).statusCode === 400);
}

function normalizeOptionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const normalized = value.trim();
  return normalized || null;
}

function validatedPhone(phone: string | null | undefined): string | null | undefined {
  if (phone === undefined || phone === null) return phone;
  const normalized = normalizePhone(phone);
  if (normalized.length < 8) {
    throw new BadRequestError('Telefone deve conter pelo menos 8 dígitos');
  }
  return normalized;
}

function validatedName(name: string | undefined): string {
  const normalized = name?.trim() || '';
  if (!normalized) throw new BadRequestError('Nome é obrigatório');
  return normalized;
}

export async function listTutors(search?: string) {
  return ok(await repo.findAll(search));
}

export async function getTutor(id: string) {
  const tutor = await repo.getWithPatients(id);
  if (!tutor) return err(new NotFoundError('Tutor'));
  return ok(tutor);
}

export async function createTutor(input: CreateTutorInput) {
  try {
    const name = validatedName(input.name);
    const phone = validatedPhone(input.phone);
    if (phone) {
      const existing = await repo.findByPhone(phone);
      if (existing) return err(new ConflictError('Telefone já cadastrado'));
    }

    const tutor = await repo.create({
      name,
      phone,
      email: normalizeOptionalText(input.email),
      externalId: normalizeOptionalText(input.externalId),
    });
    return ok(tutor);
  } catch (error) {
    if (isBadRequest(error)) return err(error);
    throw error;
  }
}

export async function updateTutor(id: string, input: UpdateTutorInput) {
  const tutor = await repo.findById(id);
  if (!tutor) return err(new NotFoundError('Tutor'));

  try {
    const phone = validatedPhone(input.phone);
    if (phone) {
      const existing = await repo.findByPhone(phone, id);
      if (existing) return err(new ConflictError('Telefone já cadastrado'));
    }

    const updated = await repo.update(id, {
      ...input,
      name: input.name === undefined ? undefined : validatedName(input.name),
      phone,
      email: normalizeOptionalText(input.email),
      externalId: normalizeOptionalText(input.externalId),
    });
    if (!updated) return err(new NotFoundError('Tutor'));
    return ok(updated);
  } catch (error) {
    if (isBadRequest(error)) return err(error);
    throw error;
  }
}

export async function deleteTutor(id: string) {
  const tutor = await repo.findById(id);
  if (!tutor) return err(new NotFoundError('Tutor'));

  const references = await repo.getReferenceCounts(id);
  const totalReferences = Object.values(references).reduce((sum, value) => sum + value, 0);
  if (totalReferences > 0) {
    return err(new ConflictError('Tutor possui registros vinculados e não pode ser excluído'));
  }

  await repo.delete(id);
  return ok({ deleted: true });
}

export async function getTutorStats() {
  return ok(await repo.getStats());
}
