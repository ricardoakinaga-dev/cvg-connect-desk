import { db, schema } from '@cvg/database';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';

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
    const token = uuid();
    const [session] = await db
      .insert(schema.sessions)
      .values({
        userId,
        token,
        expiresAt: expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning();
    return session.token;
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
      .where(
        roleIds.length > 0 
          ? undefined 
          : eq(schema.roles.id, '00000000-0000-0000-0000-000000000000' as any)
      );

    return roles
      .filter(r => roleIds.includes(r.id))
      .map(r => r.name);
  },

  async invalidateSession(token: string): Promise<void> {
    await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.token, token));
  },

  async invalidateAllUserSessions(userId: string): Promise<void> {
    await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.userId, userId));
  },
};
