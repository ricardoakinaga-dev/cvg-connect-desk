import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Contacts Module Structure', () => {
  const contactsPath = resolve(__dirname, '../infrastructure/repositories/contact.repository.ts');
  const content = readFileSync(contactsPath, 'utf-8');

  it('exports ContactRepository class', () => {
    expect(content).toContain('export class ContactRepository');
  });

  it('has findAll method', () => {
    expect(content).toContain('async findAll(');
  });

  it('has findById method', () => {
    expect(content).toContain('async findById(');
  });

  it('has findByPhone method', () => {
    expect(content).toContain('async findByPhone(');
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

  it('has getWithDetails method', () => {
    expect(content).toContain('async getWithDetails(');
  });

  it('has getActiveConversation method', () => {
    expect(content).toContain('async getActiveConversation(');
  });

  it('has getStats method', () => {
    expect(content).toContain('async getStats(');
  });

  it('uses db from @cvg/database', () => {
    expect(content).toContain("from '@cvg/database'");
  });

  it('uses drizzle-orm operators', () => {
    expect(content).toContain('eq(');
    expect(content).toContain('and');
    expect(content).toContain('or(');
    expect(content).toContain('desc(');
  });
});
