import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Sectors Module Structure', () => {
  const sectorsPath = resolve(__dirname, '../infrastructure/repositories/sector.repository.ts');
  const content = readFileSync(sectorsPath, 'utf-8');

  it('exports SectorRepository class', () => {
    expect(content).toContain('export class SectorRepository');
  });

  it('has findAll method', () => {
    expect(content).toContain('async findAll(');
  });

  it('has findById method', () => {
    expect(content).toContain('async findById(');
  });

  it('has findByCode method', () => {
    expect(content).toContain('async findByCode(');
  });

  it('has create method', () => {
    expect(content).toContain('async create(');
  });

  it('has update method', () => {
    expect(content).toContain('async update(');
  });

  it('has delete method', () => {
    expect(content).toContain('async delete(');
  });

  it('has getConversations method', () => {
    expect(content).toContain('async getConversations(');
  });

  it('has getStats method', () => {
    expect(content).toContain('async getStats(');
  });

  it('has getAllStats method', () => {
    expect(content).toContain('async getAllStats(');
  });

  it('uses db from @cvg/database', () => {
    expect(content).toContain("from '@cvg/database'");
  });

  it('uses drizzle-orm operators', () => {
    expect(content).toContain('eq(');
    expect(content).toContain('and');
    expect(content).toContain('count(');
  });
});
