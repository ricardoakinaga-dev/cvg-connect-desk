import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Tasks Module Structure', () => {
  const tasksPath = resolve(__dirname, '../infrastructure/repositories/task.repository.ts');
  const content = readFileSync(tasksPath, 'utf-8');

  it('exports taskRepository object', () => {
    expect(content).toContain('export const taskRepository');
  });

  it('has create method', () => {
    expect(content).toContain('async create(');
  });

  it('has findById method', () => {
    expect(content).toContain('async findById(');
  });

  it('has findAll method', () => {
    expect(content).toContain('async findAll(');
  });

  it('has update method', () => {
    expect(content).toContain('async update(');
  });

  it('has updateStatus method', () => {
    expect(content).toContain('async updateStatus(');
  });

  it('uses db from @cvg/database', () => {
    expect(content).toContain("from '@cvg/database'");
  });

  it('uses drizzle-orm operators', () => {
    expect(content).toContain('eq(');
    expect(content).toContain('and');
  });
});