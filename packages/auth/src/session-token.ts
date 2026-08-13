import { createHash } from 'node:crypto';

/**
 * Returns the one-way database representation of a session token.
 * The raw token remains only in the HttpOnly cookie and request context.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
