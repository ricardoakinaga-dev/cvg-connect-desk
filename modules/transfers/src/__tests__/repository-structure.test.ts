import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Transfers Module Structure', () => {
  const transfersPath = resolve(__dirname, '../infrastructure/repositories/transfer.repository.ts');
  const content = readFileSync(transfersPath, 'utf-8');

  it('exports TransferRepository class', () => {
    expect(content).toContain('export class TransferRepository');
  });

  it('has create method', () => {
    expect(content).toContain('async create(');
  });

  it('has findAll method', () => {
    expect(content).toContain('async findAll(');
  });

  it('has findById method', () => {
    expect(content).toContain('async findById(');
  });

  it('has findByContact method', () => {
    expect(content).toContain('async findByContact(');
  });

  it('has accept method', () => {
    expect(content).toContain('async accept(');
  });

  it('has reject method', () => {
    expect(content).toContain('async reject(');
  });

  it('has updateConversationSector method', () => {
    expect(content).toContain('async updateConversationSector(');
  });

  it('has updateContactSector method', () => {
    expect(content).toContain('async updateContactSector(');
  });

  it('uses db from @cvg/database', () => {
    expect(content).toContain("from '@cvg/database'");
  });

  it('uses drizzle-orm operators', () => {
    expect(content).toContain('eq(');
    expect(content).toContain('and');
  });
});
