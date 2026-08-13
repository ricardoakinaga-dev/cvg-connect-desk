import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

const SESSION_COOKIE_NAME = 'cvg_session';
const CSRF_COOKIE_NAME = 'cvg_csrf';

function parseCookies(value: string | undefined): Record<string, string> {
  return (value || '').split(';').reduce<Record<string, string>>((cookies, part) => {
    const [name, ...rest] = part.trim().split('=');
    return name && rest.length > 0
      ? { ...cookies, [name]: decodeURIComponent(rest.join('=')) }
      : cookies;
  }, {});
}

function serialize(name: string, value: string, httpOnly = false, maxAge = 604800): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'SameSite=Strict',
    httpOnly ? 'HttpOnly' : '',
    process.env.NODE_ENV === 'production' ? 'Secure' : '',
    `Max-Age=${maxAge}`,
  ].filter(Boolean).join('; ');
}

export function getRequestSessionToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7);
  return parseCookies(request.headers.cookie)[SESSION_COOKIE_NAME] || null;
}

export function setSessionCookies(reply: FastifyReply, token: string): void {
  reply.header('Set-Cookie', [
    serialize(SESSION_COOKIE_NAME, token, true),
    serialize(CSRF_COOKIE_NAME, randomUUID()),
  ]);
}

export function clearSessionCookies(reply: FastifyReply): void {
  reply.header('Set-Cookie', [
    serialize(SESSION_COOKIE_NAME, '', true, 0),
    serialize(CSRF_COOKIE_NAME, '', false, 0),
  ]);
}
