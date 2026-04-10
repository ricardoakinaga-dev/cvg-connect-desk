import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Frontend Auth Store Structure', () => {
  const authPath = resolve(__dirname, '../store/auth.ts');
  const content = readFileSync(authPath, 'utf-8');

  it('uses zustand create', () => {
    expect(content).toContain('zustand');
  });

  it('uses zustand persist middleware', () => {
    expect(content).toContain('persist(');
  });

  it('exports useAuthStore', () => {
    expect(content).toContain('export const useAuthStore');
  });

  it('has login method', () => {
    expect(content).toContain('login: async (email: string, password: string)');
  });

  it('has logout method', () => {
    expect(content).toContain('logout: async ()');
  });

  it('has checkAuth method', () => {
    expect(content).toContain('checkAuth: async ()');
  });

  it('has isAuthenticated state', () => {
    expect(content).toContain('isAuthenticated: boolean');
  });

  it('has user state', () => {
    expect(content).toContain('user: User | null');
  });

  it('has token state', () => {
    expect(content).toContain('token: string | null');
  });

  it('has isLoading state', () => {
    expect(content).toContain('isLoading: boolean');
  });

  it('has error state', () => {
    expect(content).toContain('error: string | null');
  });

  it('stores token in auth-storage', () => {
    expect(content).toContain("name: 'auth-storage'");
  });
});
