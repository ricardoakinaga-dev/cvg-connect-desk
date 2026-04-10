import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Admin Module Structure', () => {
  const adminPath = resolve(__dirname, '../infrastructure/repositories/admin.repository.ts');
  const content = readFileSync(adminPath, 'utf-8');

  it('exports adminRepository object', () => {
    expect(content).toContain('export const adminRepository');
  });

  it('exports UserRepository class', () => {
    expect(content).toContain('export class UserRepository');
  });

  it('exports RoleRepository class', () => {
    expect(content).toContain('export class RoleRepository');
  });

  it('exports PermissionRepository class', () => {
    expect(content).toContain('export class PermissionRepository');
  });

  it('exports QueueRepository class', () => {
    expect(content).toContain('export class QueueRepository');
  });

  it('exports TeamRepository class', () => {
    expect(content).toContain('export class TeamRepository');
  });

  it('has findAll method in UserRepository', () => {
    expect(content).toContain('async findAll(');
  });

  it('has findById method in UserRepository', () => {
    expect(content).toContain('async findById(');
  });

  it('has create method in UserRepository', () => {
    expect(content).toContain('async create(');
  });

  it('has update method in UserRepository', () => {
    expect(content).toContain('async update(');
  });

  it('has delete method in UserRepository', () => {
    expect(content).toContain('async delete(');
  });

  it('has findAll method in RoleRepository', () => {
    expect(content).toContain('async findAll(');
  });

  it('has findById method in RoleRepository', () => {
    expect(content).toContain('async findById(');
  });

  it('uses db from @cvg/database', () => {
    expect(content).toContain("from '@cvg/database'");
  });

  it('uses drizzle-orm operators', () => {
    expect(content).toContain('eq(');
  });
});
