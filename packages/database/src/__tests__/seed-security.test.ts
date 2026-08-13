import { describe, expect, it } from 'vitest';
import { resolveSeedAdminCredentials } from '../seed-config';

describe('seed bootstrap credentials', () => {
  it('requires credentials to be supplied by the environment', () => {
    expect(() => resolveSeedAdminCredentials({})).toThrow(/SEED_ADMIN_EMAIL.*SEED_ADMIN_PASSWORD/);
  });

  it('rejects the historical default credentials and weak passwords', () => {
    expect(() => resolveSeedAdminCredentials({
      SEED_ADMIN_EMAIL: 'admin@cvg.com',
      SEED_ADMIN_PASSWORD: 'admin123',
    })).toThrow(/default/i);

    expect(() => resolveSeedAdminCredentials({
      SEED_ADMIN_EMAIL: 'admin@example.com',
      SEED_ADMIN_PASSWORD: 'short',
    })).toThrow(/12 characters/i);
  });

  it('accepts an explicit strong bootstrap credential', () => {
    expect(resolveSeedAdminCredentials({
      SEED_ADMIN_EMAIL: 'owner@example.com',
      SEED_ADMIN_PASSWORD: 'A-strong-bootstrap-secret-42',
    })).toEqual({
      email: 'owner@example.com',
      password: 'A-strong-bootstrap-secret-42',
    });
  });
});
