import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Alerts Module Structure', () => {
  const alertsPath = resolve(__dirname, '../infrastructure/repositories/alert.repository.ts');
  const content = readFileSync(alertsPath, 'utf-8');

  it('exports alertRepository object', () => {
    expect(content).toContain('export const alertRepository');
  });

  it('has create method', () => {
    expect(content).toContain('async create(');
  });

  it('has acknowledgeIfActive method (CAS transacional)', () => {
    expect(content).toContain('async acknowledgeIfActive(');
  });

  it('has resolveIfNotResolved method (CAS transacional)', () => {
    expect(content).toContain('async resolveIfNotResolved(');
  });

  it('has findById method', () => {
    expect(content).toContain('async findById(');
  });

  it('has findAll method', () => {
    expect(content).toContain('async findAll(');
  });

  it('uses db from @cvg/database', () => {
    expect(content).toContain("from '@cvg/database'");
  });
});