import { describe, expect, it } from 'vitest';
import { resolveTrustedProxies, validateProductionConfig } from '../runtime-config';

describe('trusted proxy configuration', () => {
  it('does not trust proxies by default', () => {
    expect(resolveTrustedProxies(undefined, false)).toBe(false);
  });

  it('accepts explicit proxy addresses', () => {
    expect(resolveTrustedProxies('10.0.0.10, 10.0.0.11', true)).toEqual(['10.0.0.10', '10.0.0.11']);
  });

  it('rejects trustProxy=true in production', () => {
    expect(() => resolveTrustedProxies('true', true)).toThrow('explicit proxy addresses');
  });

  it('allows trustProxy=true only outside production', () => {
    expect(resolveTrustedProxies('true', false)).toBe(true);
  });
});

describe('production configuration readiness', () => {
  const validEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://desk:secret@db:5432/desk',
    REDIS_URL: 'redis://redis:6379',
    CORS_ORIGIN: 'https://desk.example',
    WEBHOOK_SECRET: 'webhook-secret-strong',
    INTERNAL_EVENTS_SECRET: 'internal-secret-strong',
    MEDIA_STORAGE_DRIVER: 's3',
    S3_BUCKET: 'private-media',
    S3_ACCESS_KEY_ID: 'access-key',
    S3_SECRET_ACCESS_KEY: 'secret-key',
    MALWARE_SCANNER: 'clamav',
    CLAMAV_HOST: 'clamav',
    CLAMAV_PORT: '3310',
    METRICS_TOKEN: 'metrics-secret',
  };

  it('accepts the effective production contract without requiring JWT', () => {
    expect(validateProductionConfig(validEnv)).toEqual([]);
  });

  it('fails closed for missing critical runtime configuration', () => {
    const issues = validateProductionConfig({ ...validEnv, NODE_ENV: 'test', CORS_ORIGIN: '*', INTERNAL_EVENTS_SECRET: undefined, MALWARE_SCANNER: undefined, METRICS_TOKEN: undefined });
    expect(issues.map((issue) => issue.variable)).toEqual(expect.arrayContaining([
      'NODE_ENV',
      'CORS_ORIGIN',
      'INTERNAL_EVENTS_SECRET',
      'MALWARE_SCANNER',
      'METRICS_TOKEN',
    ]));
  });
});
