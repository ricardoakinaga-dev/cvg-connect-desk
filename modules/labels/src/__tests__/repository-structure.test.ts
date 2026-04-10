import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Labels Module Structure', () => {
  const labelsPath = resolve(__dirname, '../infrastructure/repositories/label.repository.ts');
  const content = readFileSync(labelsPath, 'utf-8');

  it('exports LabelRepository class', () => {
    expect(content).toContain('export class LabelRepository');
  });

  it('has findAll method', () => {
    expect(content).toContain('async findAll(');
  });

  it('has findById method', () => {
    expect(content).toContain('async findById(');
  });

  it('has findByName method', () => {
    expect(content).toContain('async findByName(');
  });

  it('has findByCategory method', () => {
    expect(content).toContain('async findByCategory(');
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

  it('has getConversationLabels method', () => {
    expect(content).toContain('async getConversationLabels(');
  });

  it('has addConversationLabel method', () => {
    expect(content).toContain('async addConversationLabel(');
  });

  it('has removeConversationLabel method', () => {
    expect(content).toContain('async removeConversationLabel(');
  });

  it('has getContactLabels method', () => {
    expect(content).toContain('async getContactLabels(');
  });

  it('has addContactLabel method', () => {
    expect(content).toContain('async addContactLabel(');
  });

  it('has removeContactLabel method', () => {
    expect(content).toContain('async removeContactLabel(');
  });

  it('uses db from @cvg/database', () => {
    expect(content).toContain("from '@cvg/database'");
  });

  it('uses drizzle-orm operators', () => {
    expect(content).toContain('eq(');
    expect(content).toContain('and');
  });
});
