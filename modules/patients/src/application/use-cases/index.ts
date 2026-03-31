import { PatientRepository } from '../../infrastructure/repositories/patient.repository';
import { ok, err, NotFoundError } from '@cvg/shared';
import type { CreatePatientInput, UpdatePatientInput } from '../../types';

const repo = new PatientRepository();

export async function listPatients(filters?: { search?: string; tutorId?: string; species?: string }) {
  const patients = await repo.findAll(filters);
  return ok(patients);
}

export async function getPatient(id: string) {
  const patient = await repo.getWithDetails(id);
  if (!patient) return err(new NotFoundError('Paciente'));
  return ok(patient);
}

export async function createPatient(input: CreatePatientInput) {
  const patient = await repo.create(input);
  return ok(patient);
}

export async function updatePatient(id: string, input: UpdatePatientInput) {
  const patient = await repo.findById(id);
  if (!patient) return err(new NotFoundError('Paciente'));

  const updated = await repo.update(id, input);
  return ok(updated);
}

export async function deletePatient(id: string) {
  const patient = await repo.findById(id);
  if (!patient) return err(new NotFoundError('Paciente'));
  await repo.delete(id);
  return ok({ deleted: true });
}

export async function getPatientStats() {
  return ok(await repo.getStats());
}
