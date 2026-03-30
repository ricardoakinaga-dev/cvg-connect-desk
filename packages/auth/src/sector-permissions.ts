import { db } from '@cvg/database';
import { userSectors, sectors } from '@cvg/database';
import { eq, and, inArray } from 'drizzle-orm';

export type AccessLevel = 'read' | 'write' | 'admin';

export const sectorPermissionService = {
  /**
   * Retorna IDs dos setores que o usuário tem acesso
   */
  async getUserSectorIds(userId: string): Promise<string[]> {
    const result = await db.select({ sectorId: userSectors.sectorId })
      .from(userSectors)
      .where(eq(userSectors.userId, userId));
    return result.map(r => r.sectorId);
  },

  /**
   * Retorna setores com nível de acesso do usuário
   */
  async getUserSectors(userId: string) {
    return db.select({
      sectorId: sectors.id,
      sectorName: sectors.name,
      sectorCode: sectors.code,
      sectorIcon: sectors.icon,
      sectorColor: sectors.color,
      accessLevel: userSectors.accessLevel,
    })
      .from(userSectors)
      .innerJoin(sectors, eq(userSectors.sectorId, sectors.id))
      .where(eq(userSectors.userId, userId));
  },

  /**
   * Verifica se usuário tem acesso a um setor específico
   */
  async hasAccess(userId: string, sectorId: string, requiredLevel?: AccessLevel): Promise<boolean> {
    const [entry] = await db.select({ accessLevel: userSectors.accessLevel })
      .from(userSectors)
      .where(and(eq(userSectors.userId, userId), eq(userSectors.sectorId, sectorId)));

    if (!entry) return false;
    if (!requiredLevel) return true;

    const levels: Record<AccessLevel, number> = { read: 1, write: 2, admin: 3 };
    return levels[entry.accessLevel as AccessLevel] >= levels[requiredLevel];
  },

  /**
   * Verifica se o usuário é admin global (acesso a todos os setores)
   * Um admin é identificado por ter a role Admin
   */
  async isGlobalAdmin(userId: string): Promise<boolean> {
    const { db: database, schema } = await import('@cvg/database');
    const { userRoles, roles } = schema;
    const { eq: eqOp } = await import('drizzle-orm');

    const result = await database.select({ roleName: roles.name })
      .from(userRoles)
      .innerJoin(roles, eqOp(userRoles.roleId, roles.id))
      .where(eqOp(userRoles.userId, userId));

    return result.some(r => r.name === 'Admin');
  },

  /**
   * Define permissões de setor para um usuário (substitui todas)
   */
  async setUserSectors(userId: string, sectorPermissions: { sectorId: string; accessLevel: AccessLevel }[]) {
    // Remover permissões antigas
    await db.delete(userSectors).where(eq(userSectors.userId, userId));

    // Inserir novas
    if (sectorPermissions.length > 0) {
      await db.insert(userSectors).values(
        sectorPermissions.map(sp => ({
          userId,
          sectorId: sp.sectorId,
          accessLevel: sp.accessLevel,
        }))
      );
    }
  },

  /**
   * Adiciona permissão de setor para um usuário
   */
  async addSectorPermission(userId: string, sectorId: string, accessLevel: AccessLevel = 'read') {
    await db.insert(userSectors).values({
      userId,
      sectorId,
      accessLevel,
    }).onConflictDoUpdate({
      target: [userSectors.userId, userSectors.sectorId],
      set: { accessLevel, updatedAt: new Date() },
    });
  },

  /**
   * Remove permissão de setor de um usuário
   */
  async removeSectorPermission(userId: string, sectorId: string) {
    await db.delete(userSectors).where(
      and(eq(userSectors.userId, userId), eq(userSectors.sectorId, sectorId))
    );
  },
};
