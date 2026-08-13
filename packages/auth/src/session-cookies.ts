import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const SESSION_COOKIE_NAME = 'cvg_session';
export const CSRF_COOKIE_NAME = 'cvg_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function isProduction(): boolean {
  const env = (process.env.NODE_ENV || process.env.DESK_ENV || '').toLowerCase();
  return env === 'production' || env === 'prod';
}

export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(';').reduce<Record<string, string>>((cookies, part) => {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName || rawValue.length === 0) {
      return cookies;
    }

    return {
      ...cookies,
      [rawName]: decodeURIComponent(rawValue.join('=')),
    };
  }, {});
}

function serializeCookie(
  name: string,
  value: string,
  options: { httpOnly?: boolean; maxAge?: number; expires?: Date } = {}
): string {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'SameSite=Strict',
  ];

  if (options.httpOnly) {
    attributes.push('HttpOnly');
  }

  if (isProduction()) {
    attributes.push('Secure');
  }

  if (options.maxAge !== undefined) {
    attributes.push(`Max-Age=${options.maxAge}`);
  }

  if (options.expires) {
    attributes.push(`Expires=${options.expires.toUTCString()}`);
  }

  return attributes.join('; ');
}

export function getRequestSessionToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  const cookies = parseCookieHeader(request.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] || null;
}

export function getRequestCsrfToken(request: FastifyRequest): string | null {
  const cookies = parseCookieHeader(request.headers.cookie);
  return cookies[CSRF_COOKIE_NAME] || null;
}

export function setSessionCookies(reply: FastifyReply, token: string): string {
  const csrfToken = randomUUID();
  reply.header('Set-Cookie', [
    serializeCookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      maxAge: SESSION_MAX_AGE_SECONDS,
    }),
    serializeCookie(CSRF_COOKIE_NAME, csrfToken, {
      maxAge: SESSION_MAX_AGE_SECONDS,
    }),
  ]);

  return csrfToken;
}

export function clearSessionCookies(reply: FastifyReply): void {
  const expires = new Date(0);
  reply.header('Set-Cookie', [
    serializeCookie(SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      maxAge: 0,
      expires,
    }),
    serializeCookie(CSRF_COOKIE_NAME, '', {
      maxAge: 0,
      expires,
    }),
  ]);
}
