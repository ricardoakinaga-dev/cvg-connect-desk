import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Notes Module Structure', () => {
  const notesPath = resolve(__dirname, '../infrastructure/repositories/note.repository.ts');
  const content = readFileSync(notesPath, 'utf-8');

  it('exports noteRepository object', () => {
    expect(content).toContain('export const noteRepository');
  });

  it('has create method', () => {
    expect(content).toContain('async create(');
  });

  it('has findById method', () => {
    expect(content).toContain('async findById(');
  });

  it('has findByConversationId method', () => {
    expect(content).toContain('async findByConversationId(');
  });

  it('uses db from @cvg/database', () => {
    expect(content).toContain("from '@cvg/database'");
  });
});