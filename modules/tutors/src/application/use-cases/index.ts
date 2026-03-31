import { TutorRepository } from '../../infrastructure/repositories/tutor.repository';
import { ok, err, NotFoundError, ConflictError } from '@cvg/shared';
import type { CreateTutorInput, UpdateTutorInput } from '../../types';

const repo = new TutorRepository();

export async function listTutors(search?: string) {
  const tutors = await repo.findAll(search);
  return ok(tutors);
}

export async function getTutor(id: string) {
  const tutor = await repo.getWithPatients(id);
  if (!tutor) return err(new NotFoundError('Tutor'));
  return ok(tutor);
}

export async function createTutor(input: CreateTutorInput) {
  if (input.phone) {
    const existing = await repo.findByPhone(input.phone);
    if (existing) return err(new ConflictError('Telefone já cadastrado'));
  }

  const tutor = await repo.create(input);
  return ok(tutor);
}

export async function updateTutor(id: string, input: UpdateTutorInput) {
  const tutor = await repo.findById(id);
  if (!tutor) return err(new NotFoundError('Tutor'));

  const updated = await repo.update(id, input);
  return ok(updated);
}

export async function deleteTutor(id: string) {
  const tutor = await repo.findById(id);
  if (!tutor) return err(new NotFoundError('Tutor'));
  await repo.delete(id);
  return ok({ deleted: true });
}

export async function getTutorStats() {
  return ok(await repo.getStats());
}
