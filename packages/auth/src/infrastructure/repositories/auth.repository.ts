import { db, schema } from '@cvg/database';
import { eq, inArray } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { invalidateAuthCacheToken } from '../../auth-cache';
import { hashSessionToken } from '../../session-token';

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
    const token = crypto.randomUUID();
    await db
      .insert(schema.sessions)
      .values({
        userId,
        tokenHash: hashSessionToken(token),
        expiresAt: expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
    return token;
  },

  async findSessionByToken(token: string) {
    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.tokenHash, hashSessionToken(token)));
    return session || null;
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

    return roles
      .filter(r => roleIds.includes(r.id))
      .map(r => r.name);
  },

  async invalidateSession(token: string): Promise<void> {
    await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.tokenHash, hashSessionToken(token)));
    invalidateAuthCacheToken(token);
  },

  async invalidateAllUserSessions(userId: string): Promise<void> {
    await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.userId, userId));
  },
};
