import { db, schema } from '@cvg/database';
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';
import { v4 as uuid } from 'uuid';
import {
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_DENY_MESSAGES,
  SESSION_TTL_MS,
  evaluateSession,
  resolveSessionDeadlines,
  type SessionEvaluation,
  type SessionLike,
} from '../../session-policy';

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

// O schema drizzle declara absolute_expires_at/last_seen_at/revoked_at como
// `timestamp` sem timezone, mas as colunas reais sao timestamptz (0013). O mapper
// do drizzle devolve a parede local como UTC (deslocamento pelo offset do banco).
// A projecao em epoch abaixo elimina o desvio sem alterar o schema.
const sessionSelection = {
  id: schema.sessions.id,
  userId: schema.sessions.userId,
  token: schema.sessions.token,
  tokenHash: schema.sessions.tokenHash,
  expiresAt: schema.sessions.expiresAt,
  createdAt: schema.sessions.createdAt,
  revokedReason: schema.sessions.revokedReason,
  absoluteExpiresAt: sql<number | null>`(extract(epoch from ${schema.sessions.absoluteExpiresAt}) * 1000)::double precision`,
  lastSeenAt: sql<number | null>`(extract(epoch from ${schema.sessions.lastSeenAt}) * 1000)::double precision`,
  revokedAt: sql<number | null>`(extract(epoch from ${schema.sessions.revokedAt}) * 1000)::double precision`,
};

interface SessionProjectionRow {
  id: string;
  userId: string;
  token: string;
  tokenHash: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  revokedReason: string | null;
  absoluteExpiresAt: number | null;
  lastSeenAt: number | null;
  revokedAt: number | null;
}

function toInstant(value: number | null): Date | null {
  return value === null ? null : new Date(Math.round(Number(value)));
}

function toSessionLike(row: SessionProjectionRow): SessionLike {
  return {
    id: row.id,
    userId: row.userId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    absoluteExpiresAt: toInstant(row.absoluteExpiresAt),
    lastSeenAt: toInstant(row.lastSeenAt),
    revokedAt: toInstant(row.revokedAt),
  };
}

function generateSessionToken(): string {
  return `${uuid()}.${randomBytes(24).toString('hex')}`;
}

export interface LoginResult {
  user: {
    id: string;
    email: string;
    name: string;
    roles: string[];
    isActive?: boolean;
    createdAt?: string;
    permissions?: string[];
    permissionsAuthoritative?: boolean;
  };
  token: string;
}

export type RotateSessionResult =
  | { ok: true; token: string; userId: string }
  | Extract<SessionEvaluation, { ok: false }>;

export const authRepository = {
  async findUserByEmail(email: string) {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email));
    return user || null;
  },

  async findUserById(userId: string) {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    return user || null;
  },

  async findSessionByToken(token: string): Promise<SessionLike | null> {
    const [session] = await db
      .select(sessionSelection)
      .from(schema.sessions)
      .where(eq(schema.sessions.token, hashSessionToken(token)));
    return session ? toSessionLike(session) : null;
  },

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  },

  async createSession(userId: string, expiresAt?: Date): Promise<string> {
    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    const now = new Date();
    const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS);
    const normalExpiresAt = expiresAt || new Date(now.getTime() + SESSION_TTL_MS);
    const boundedExpiresAt = new Date(Math.min(normalExpiresAt.getTime(), absoluteExpiresAt.getTime()));
    await db
      .insert(schema.sessions)
      .values({
        userId,
        token: tokenHash,
        tokenHash,
        lastSeenAt: now,
        absoluteExpiresAt,
        expiresAt: boundedExpiresAt,
      });
    return token;
  },

  async touchSession(sessionId: string, now: Date): Promise<boolean> {
    const touched = await db
      .update(schema.sessions)
      .set({ lastSeenAt: now })
      .where(
        and(
          eq(schema.sessions.id, sessionId),
          isNull(schema.sessions.revokedAt),
          or(isNull(schema.sessions.expiresAt), gt(schema.sessions.expiresAt, now)),
          or(isNull(schema.sessions.absoluteExpiresAt), gt(schema.sessions.absoluteExpiresAt, now)),
          sql`EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = ${schema.sessions.userId} AND "users"."is_active" = true)`,
        ),
      )
      .returning({ id: schema.sessions.id });

    return touched.length === 1;
  },

  async getUserRoles(userId: string): Promise<string[]> {
    const userRoles = await db
      .select()
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, userId));

    if (userRoles.length === 0) {
      return [];
    }

    const roleIds = userRoles.map(ur => ur.roleId);
    const roles = await db
      .select()
      .from(schema.roles)
      .where(inArray(schema.roles.id, roleIds));

    return roles.map(r => r.name);
  },

  async invalidateSession(token: string): Promise<void> {
    await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.token, hashSessionToken(token)));
  },

  async revokeSession(token: string, reason = 'logout'): Promise<void> {
    await db
      .update(schema.sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(eq(schema.sessions.token, hashSessionToken(token)));
  },

  async rotateSession(oldToken: string, now: Date = new Date()): Promise<RotateSessionResult> {
    const oldTokenHash = hashSessionToken(oldToken);

    return db.transaction(async (tx) => {
      const [row] = await tx
        .select(sessionSelection)
        .from(schema.sessions)
        .where(eq(schema.sessions.token, oldTokenHash))
        .for('update');

      if (!row) {
        return {
          ok: false,
          reason: 'invalid_token',
          message: SESSION_DENY_MESSAGES.invalid_token,
        } as const;
      }

      const session = toSessionLike(row);
      const [user] = await tx
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, session.userId));

      const evaluation = evaluateSession(session, user, now);
      if (!evaluation.ok) {
        return evaluation;
      }

      const deadlines = resolveSessionDeadlines(session, now);
      if (!deadlines.absoluteExpiresAt) {
        return {
          ok: false,
          reason: 'invalid_token',
          message: SESSION_DENY_MESSAGES.invalid_token,
        } as const;
      }

      const revoked = await tx
        .update(schema.sessions)
        .set({ revokedAt: now, revokedReason: 'rotation' })
        .where(and(eq(schema.sessions.id, session.id), isNull(schema.sessions.revokedAt)))
        .returning({ id: schema.sessions.id });

      if (revoked.length !== 1) {
        return {
          ok: false,
          reason: 'invalid_token',
          message: SESSION_DENY_MESSAGES.invalid_token,
        } as const;
      }

      const token = generateSessionToken();
      const tokenHash = hashSessionToken(token);
      const expiresAt = new Date(
        Math.min(now.getTime() + SESSION_TTL_MS, deadlines.absoluteExpiresAt.getTime()),
      );

      await tx.insert(schema.sessions).values({
        userId: session.userId,
        token: tokenHash,
        tokenHash,
        lastSeenAt: now,
        absoluteExpiresAt: deadlines.absoluteExpiresAt,
        expiresAt,
      });

      return { ok: true, token, userId: session.userId } as const;
    });
  },

  async invalidateAllUserSessions(userId: string): Promise<void> {
    await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.userId, userId));
  },
};
