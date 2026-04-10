import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Auth Module Structure', () => {
  const authPath = resolve(__dirname, '../infrastructure/repositories/auth.repository.ts');
  const content = readFileSync(authPath, 'utf-8');

  it('exports authRepository object', () => {
    expect(content).toContain('export const authRepository');
  });

  it('has findUserByEmail method', () => {
    expect(content).toContain('async findUserByEmail(');
  });

  it('has verifyPassword method', () => {
    expect(content).toContain('async verifyPassword(');
  });

  it('has createSession method', () => {
    expect(content).toContain('async createSession(');
  });

  it('has getUserRoles method', () => {
    expect(content).toContain('async getUserRoles(');
  });

  it('has invalidateSession method', () => {
    expect(content).toContain('async invalidateSession(');
  });

  it('has invalidateAllUserSessions method', () => {
    expect(content).toContain('async invalidateAllUserSessions(');
  });

  it('uses db from @cvg/database', () => {
    expect(content).toContain("from '@cvg/database'");
  });

  it('uses drizzle-orm operators', () => {
    expect(content).toContain('eq(');
  });
});
