export interface SessionLike {
  id: string;
  userId: string;
  expiresAt: Date | null;
  absoluteExpiresAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date | null;
  revokedAt: Date | null;
}

export interface UserLike {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
}

export interface SessionPolicy {
  normalTtlMs: number;
  absoluteTtlMs: number;
  idleTimeoutMs: number;
}

export type SessionDenyReason =
  | 'invalid_token'
  | 'expired'
  | 'absolute_expired'
  | 'idle'
  | 'inactive_user';

export interface SessionPrincipal {
  id: string;
  email: string;
  name: string;
  roles: string[];
}

export type SessionEvaluation =
  | { ok: true; principal: SessionPrincipal }
  | { ok: false; reason: SessionDenyReason; message: string };

function envPositiveInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export const SESSION_TTL_MS = envPositiveInt('SESSION_TTL_MS', 7 * 24 * 60 * 60 * 1000);
export const SESSION_ABSOLUTE_TTL_MS = envPositiveInt('SESSION_ABSOLUTE_TTL_MS', 30 * 24 * 60 * 60 * 1000);
export const SESSION_IDLE_TIMEOUT_MS = envPositiveInt('SESSION_IDLE_TIMEOUT_MS', 24 * 60 * 60 * 1000);

export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  normalTtlMs: SESSION_TTL_MS,
  absoluteTtlMs: SESSION_ABSOLUTE_TTL_MS,
  idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
};

export const SESSION_DENY_MESSAGES: Record<SessionDenyReason, string> = {
  invalid_token: 'Invalid token',
  expired: 'Token expired',
  absolute_expired: 'Session expired',
  idle: 'Session idle timeout',
  inactive_user: 'User not found or inactive',
};

function validDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export interface ResolvedSessionDeadlines {
  expiresAt: Date | null;
  absoluteExpiresAt: Date | null;
  lastSeenAt: Date | null;
}

export function resolveSessionDeadlines(
  session: SessionLike,
  _now: Date,
  policy: SessionPolicy = DEFAULT_SESSION_POLICY,
): ResolvedSessionDeadlines {
  const createdAt = validDate(session.createdAt) ? session.createdAt : null;

  const expiresAt = validDate(session.expiresAt)
    ? session.expiresAt
    : createdAt
      ? new Date(createdAt.getTime() + policy.normalTtlMs)
      : null;

  const absoluteExpiresAt = validDate(session.absoluteExpiresAt)
    ? session.absoluteExpiresAt
    : createdAt
      ? new Date(createdAt.getTime() + policy.absoluteTtlMs)
      : null;

  const lastSeenAt = validDate(session.lastSeenAt) ? session.lastSeenAt : createdAt;

  return { expiresAt, absoluteExpiresAt, lastSeenAt };
}

function deny(reason: SessionDenyReason): SessionEvaluation {
  return { ok: false, reason, message: SESSION_DENY_MESSAGES[reason] };
}

export function evaluateSession(
  session: SessionLike | null | undefined,
  user: UserLike | null | undefined,
  now: Date,
  policy: SessionPolicy = DEFAULT_SESSION_POLICY,
  roles: string[] = [],
): SessionEvaluation {
  if (!session || session.revokedAt) {
    return deny('invalid_token');
  }

  const deadlines = resolveSessionDeadlines(session, now, policy);

  if (!deadlines.expiresAt || !deadlines.absoluteExpiresAt) {
    return deny('invalid_token');
  }

  if (now.getTime() >= deadlines.expiresAt.getTime()) {
    return deny('expired');
  }

  if (now.getTime() >= deadlines.absoluteExpiresAt.getTime()) {
    return deny('absolute_expired');
  }

  if (deadlines.lastSeenAt && now.getTime() - deadlines.lastSeenAt.getTime() >= policy.idleTimeoutMs) {
    return deny('idle');
  }

  if (!user || !user.isActive) {
    return deny('inactive_user');
  }

  return {
    ok: true,
    principal: {
      id: user.id,
      email: user.email,
      name: user.name,
      roles,
    },
  };
}
