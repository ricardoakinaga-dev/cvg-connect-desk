import { describe, expect, it } from 'vitest';
import { resolveTrustedProxies } from '../runtime-config';

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
