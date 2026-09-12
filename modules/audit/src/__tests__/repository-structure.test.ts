import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Audit Module Structure', () => {
  const auditPath = resolve(__dirname, '../infrastructure/repositories/audit.repository.ts');
  const content = readFileSync(auditPath, 'utf-8');

  it('exports auditRepository object', () => {
    expect(content).toContain('export const auditRepository');
  });

  it('has create method', () => {
    expect(content).toContain('async create(');
  });

  it('has findAll method', () => {
    expect(content).toContain('async findAll(');
  });

  it('has findByEntity method', () => {
    expect(content).toContain('async findByEntity(');
  });

  it('has findByUser method', () => {
    expect(content).toContain('async findByUser(');
  });

  it('uses db from @cvg/database', () => {
    expect(content).toContain("from '@cvg/database'");
  });

  it('uses drizzle-orm operators', () => {
    expect(content).toContain('eq(');
    expect(content).toContain('and');
    expect(content).toContain('desc(');
  });

  it('is append-only: exposes no update/delete/remove methods', () => {
    expect(content).not.toMatch(/async\s+update\s*\(/);
    expect(content).not.toMatch(/async\s+delete\s*\(/);
    expect(content).not.toMatch(/async\s+remove\s*\(/);
    expect(content).not.toMatch(/\.update\(schema\.auditLogs/);
    expect(content).not.toMatch(/\.delete\(\s*schema\.auditLogs/);
  });
});
