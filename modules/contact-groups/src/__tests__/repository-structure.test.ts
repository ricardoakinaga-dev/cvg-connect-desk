import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('ContactGroups Module Structure', () => {
  const cgPath = resolve(__dirname, '../infrastructure/repositories/contact-group.repository.ts');
  const content = readFileSync(cgPath, 'utf-8');

  it('exports ContactGroupRepository class', () => {
    expect(content).toContain('export class ContactGroupRepository');
  });

  it('has findAll method', () => {
    expect(content).toContain('async findAll(');
  });

  it('has findById method', () => {
    expect(content).toContain('async findById(');
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

  it('has getMembers method', () => {
    expect(content).toContain('async getMembers(');
  });

  it('has addMember method', () => {
    expect(content).toContain('async addMember(');
  });

  it('has removeMember method', () => {
    expect(content).toContain('async removeMember(');
  });

  it('uses db from @cvg/database', () => {
    expect(content).toContain("from '@cvg/database'");
  });

  it('uses drizzle-orm operators', () => {
    expect(content).toContain('eq(');
    expect(content).toContain('and');
  });
});
