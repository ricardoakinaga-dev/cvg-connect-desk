import { SectorRepository } from '../../infrastructure/repositories/sector.repository';
import { ok, err, NotFoundError, ConflictError } from '@cvg/shared';
import type { CreateSectorInput, UpdateSectorInput } from '../../types';

const repo = new SectorRepository();

export async function listSectors(activeOnly = true) {
  const sectors = await repo.findAll(activeOnly);
  return ok(sectors);
}

export async function getSector(id: string) {
  const sector = await repo.findById(id);
  if (!sector) return err(new NotFoundError('Setor'));
  return ok(sector);
}

export async function createSector(input: CreateSectorInput) {
  const existing = await repo.findByCode(input.code);
  if (existing) return err(new ConflictError(`Setor com código '${input.code}' já existe`));
  const sector = await repo.create(input);
  return ok(sector);
}

export async function updateSector(id: string, input: UpdateSectorInput) {
  const sector = await repo.findById(id);
  if (!sector) return err(new NotFoundError('Setor'));
  const updated = await repo.update(id, input);
  return ok(updated);
}

export async function deleteSector(id: string) {
  const sector = await repo.findById(id);
  if (!sector) return err(new NotFoundError('Setor'));
  await repo.delete(id);
  return ok({ deleted: true });
}

export async function getSectorConversations(sectorId: string, status?: string) {
  const sector = await repo.findById(sectorId);
  if (!sector) return err(new NotFoundError('Setor'));
  const conversations = await repo.getConversations(sectorId, status);
  return ok(conversations);
}

export async function getSectorStats(sectorId: string) {
  const sector = await repo.findById(sectorId);
  if (!sector) return err(new NotFoundError('Setor'));
  const stats = await repo.getStats(sectorId);
  return ok({ sector, ...stats });
}

export async function getAllSectorStats() {
  const sectors = await repo.findAll(true);
  const stats = await Promise.all(
    sectors.map(async (s) => {
      const st = await repo.getStats(s.id);
      return { ...s, ...st };
    })
  );
  return ok(stats);
}
