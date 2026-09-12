import { db, schema } from '@cvg/database';
import { eq, inArray } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';
import { v4 as uuid } from 'uuid';

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface LoginResult {
  user: {
    id: string;
    email: string;
    name: string;
    roles: string[];
  };
  token: string;
}

export const authRepository = {
  async findUserByEmail(email: string) {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email));
    return user || null;
  },

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  },

  async createSession(userId: string, expiresAt?: Date): Promise<string> {
    const token = `${uuid()}.${randomBytes(24).toString('hex')}`;
    const tokenHash = hashSessionToken(token);
    const now = new Date();
    const absoluteExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await db
      .insert(schema.sessions)
      .values({
        userId,
        token: tokenHash,
        tokenHash,
        lastSeenAt: now,
        absoluteExpiresAt,
        expiresAt: expiresAt || new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      });
    return token;
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

  async rotateSession(oldToken: string, userId: string): Promise<string> {
    await this.revokeSession(oldToken, 'rotation');
    return this.createSession(userId);
  },

  async invalidateAllUserSessions(userId: string): Promise<void> {
    await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.userId, userId));
  },
};
