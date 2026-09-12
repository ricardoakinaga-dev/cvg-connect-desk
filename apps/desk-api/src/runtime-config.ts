export function isProduction(): boolean {
  const env = (process.env.NODE_ENV || process.env.DESK_ENV || '').toLowerCase();
  return env === 'production' || env === 'prod';
}

/**
 * Resolve Fastify's proxy trust from an explicit allow-list. In production,
 * accepting `true` would let callers forge the client IP used by rate limits.
 */
export function resolveTrustedProxies(
  configured = process.env.TRUST_PROXY?.trim(),
  production = isProduction(),
): false | string[] | true {
  if (!configured || configured === 'false') return false;
  if (configured === 'true') {
    if (production) throw new Error('TRUST_PROXY must list explicit proxy addresses in production');
    return true;
  }

  const proxies = configured.split(',').map((value) => value.trim()).filter(Boolean);
  if (proxies.length === 0) throw new Error('TRUST_PROXY must contain at least one proxy address');
  return proxies;
}
