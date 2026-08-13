import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Frontend API Client Structure', () => {
  const apiPath = resolve(__dirname, '../lib/api.ts');
  const content = readFileSync(apiPath, 'utf-8');

  it('exports api client', () => {
    expect(content).toContain('export const api');
  });

  it('has ApiClient class', () => {
    expect(content).toContain('class ApiClient');
  });

  it('has get method', () => {
    expect(content).toContain('async get<T>(');
  });

  it('has post method', () => {
    expect(content).toContain('async post<T>(');
  });

  it('has patch method', () => {
    expect(content).toContain('async patch<T>(');
  });

  it('has put method', () => {
    expect(content).toContain('async put<T>(');
  });

  it('has delete method', () => {
    expect(content).toContain('async delete<T>(');
  });

  it('exports conversationApi', () => {
    expect(content).toContain('export const conversationApi');
  });

  it('exports taskApi', () => {
    expect(content).toContain('export const taskApi');
  });

  it('exports alertApi', () => {
    expect(content).toContain('export const alertApi');
  });

  it('exports dashboardApi', () => {
    expect(content).toContain('export const dashboardApi');
  });

  it('exports deadLetterApi', () => {
    expect(content).toContain('export const deadLetterApi');
  });

  it('exports webhookSecurityApi', () => {
    expect(content).toContain('export const webhookSecurityApi');
  });

  it('exports labelApi', () => {
    expect(content).toContain('export const labelApi');
  });

  it('exports sectorApi', () => {
    expect(content).toContain('export const sectorApi');
  });

  it('exports transferApi', () => {
    expect(content).toContain('export const transferApi');
  });

  it('sends cookie credentials on requests', () => {
    expect(content).toContain("credentials: 'include'");
  });

  it('uses CSRF cookie instead of bearer token storage', () => {
    expect(content).toContain('cvg_csrf');
    expect(content).toContain('X-CSRF-Token');
    expect(content).not.toContain('localStorage.getItem');
    expect(content).not.toContain('Authorization');
  });
});
