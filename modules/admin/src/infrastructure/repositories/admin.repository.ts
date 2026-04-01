import { db, schema } from '@cvg/database';
import { eq, sql } from 'drizzle-orm';
import type {
  UserListItem, CreateUserInput, UpdateUserInput,
  RoleListItem, CreateRoleInput, UpdateRoleInput,
  PermissionItem, CreatePermissionInput,
  QueueItem, CreateQueueInput, UpdateQueueInput,
  TeamItem, CreateTeamInput, UpdateTeamInput,
  AssignUserToTeamInput, AssignUserToQueueInput,
} from '../../types';

type UserRow = typeof schema.users.$inferSelect;
type RoleRow = typeof schema.roles.$inferSelect;
type PermissionRow = typeof schema.permissions.$inferSelect;
type QueueRow = typeof schema.queues.$inferSelect;
type TeamRow = typeof schema.teams.$inferSelect;

export class UserRepository {
  async findAll(): Promise<UserListItem[]> {
    const users = await db.select().from(schema.users).orderBy(schema.users.createdAt);
    return users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      isActive: u.isActive,
      createdAt: u.createdAt,
    }));
  }

  async findById(id: string): Promise<UserRow | null> {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    return user || null;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    return user || null;
  }

  async create(data: CreateUserInput): Promise<UserRow> {
    const [user] = await db
      .insert(schema.users)
      .values({
        name: data.name,
        email: data.email,
        passwordHash: data.password,
        isActive: data.isActive ?? true,
      })
      .returning();
    return user;
  }

  async update(id: string, data: Partial<UpdateUserInput>): Promise<UserRow> {
    const updateData: Record<string, unknown> = {};
    if (data.name) updateData.name = data.name;
    if (data.email) updateData.email = data.email;
    if (data.password) updateData.passwordHash = data.password;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    const [user] = await db
      .update(schema.users)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(schema.users.id, id))
      .returning();
    return user;
  }

  async delete(id: string): Promise<void> {
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }

  async assignRoles(userId: string, roleIds: string[]): Promise<void> {
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    if (roleIds.length > 0) {
      const values = roleIds.map(roleId => ({ userId, roleId }));
      await db.insert(schema.userRoles).values(values);
    }
  }

  async getRoles(userId: string): Promise<RoleRow[]> {
    return db
      .select({
        id: schema.roles.id,
        name: schema.roles.name,
        description: schema.roles.description,
        createdAt: schema.roles.createdAt,
      })
      .from(schema.roles)
      .innerJoin(schema.userRoles, eq(schema.userRoles.roleId, schema.roles.id))
      .where(eq(schema.userRoles.userId, userId));
  }

  async getPermissions(userId: string): Promise<PermissionRow[]> {
    return db
      .select({
        id: schema.permissions.id,
        name: schema.permissions.name,
        description: schema.permissions.description,
        createdAt: schema.permissions.createdAt,
      })
      .from(schema.permissions)
      .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
      .innerJoin(schema.userRoles, eq(schema.userRoles.roleId, schema.rolePermissions.roleId))
      .where(eq(schema.userRoles.userId, userId));
  }
}

export class RoleRepository {
  async findAll(): Promise<RoleListItem[]> {
    const roles = await db.select().from(schema.roles);
    return roles.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      createdAt: r.createdAt,
    }));
  }

  async findById(id: string): Promise<RoleRow | null> {
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.id, id));
    return role || null;
  }

  async findByName(name: string): Promise<RoleRow | null> {
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, name));
    return role || null;
  }

  async create(data: CreateRoleInput): Promise<RoleRow> {
    const [role] = await db
      .insert(schema.roles)
      .values({ name: data.name, description: data.description })
      .returning();
    if (data.permissionIds && data.permissionIds.length > 0) {
      await this.assignPermissions(role.id, data.permissionIds);
    }
    return role;
  }

  async update(id: string, data: Partial<UpdateRoleInput>): Promise<RoleRow> {
    const updateData: Record<string, unknown> = {};
    if (data.name) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;

    const [role] = await db
      .update(schema.roles)
      .set(updateData)
      .where(eq(schema.roles.id, id))
      .returning();
    if (data.permissionIds !== undefined) {
      await this.assignPermissions(id, data.permissionIds);
    }
    return role;
  }

  async delete(id: string): Promise<void> {
    await db.delete(schema.roles).where(eq(schema.roles.id, id));
  }

  async assignPermissions(roleId: string, permissionIds: string[]): Promise<void> {
    await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
    if (permissionIds.length > 0) {
      const values = permissionIds.map(pId => ({ roleId, permissionId: pId }));
      await db.insert(schema.rolePermissions).values(values);
    }
  }

  async getPermissions(roleId: string): Promise<PermissionRow[]> {
    return db
      .select({
        id: schema.permissions.id,
        name: schema.permissions.name,
        description: schema.permissions.description,
        createdAt: schema.permissions.createdAt,
      })
      .from(schema.permissions)
      .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
      .where(eq(schema.rolePermissions.roleId, roleId));
  }
}

export class PermissionRepository {
  async findAll(): Promise<PermissionItem[]> {
    const permissions = await db.select().from(schema.permissions);
    return permissions.map(p => ({
      id: p.id,
      name: p.name as any,
      description: p.description,
      createdAt: p.createdAt,
    }));
  }

  async findById(id: string): Promise<PermissionRow | null> {
    const [perm] = await db.select().from(schema.permissions).where(eq(schema.permissions.id, id));
    return perm || null;
  }

  async findByName(name: string): Promise<PermissionRow | null> {
    const [perm] = await db.select().from(schema.permissions).where(eq(schema.permissions.name, name));
    return perm || null;
  }

  async create(data: CreatePermissionInput): Promise<PermissionRow> {
    const [perm] = await db
      .insert(schema.permissions)
      .values({ name: data.name, description: data.description })
      .returning();
    return perm;
  }

  async delete(id: string): Promise<void> {
    await db.delete(schema.permissions).where(eq(schema.permissions.id, id));
  }
}

export class QueueRepository {
  async findAll(): Promise<QueueItem[]> {
    const queues = await db.select().from(schema.queues);
    return queues.map(q => ({
      id: q.id,
      name: q.name,
      description: q.description,
      createdAt: q.createdAt,
    }));
  }

  async findById(id: string): Promise<QueueRow | null> {
    const [queue] = await db.select().from(schema.queues).where(eq(schema.queues.id, id));
    return queue || null;
  }

  async create(data: CreateQueueInput): Promise<QueueRow> {
    const [queue] = await db
      .insert(schema.queues)
      .values({ name: data.name, description: data.description })
      .returning();
    return queue;
  }

  async update(id: string, data: UpdateQueueInput): Promise<QueueRow> {
    const updateData: Record<string, unknown> = {};
    if (data.name) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;

    const [queue] = await db
      .update(schema.queues)
      .set(updateData)
      .where(eq(schema.queues.id, id))
      .returning();
    return queue;
  }

  async delete(id: string): Promise<void> {
    await db.delete(schema.queues).where(eq(schema.queues.id, id));
  }
}

export class TeamRepository {
  async findAll(): Promise<TeamItem[]> {
    const teams = await db.select().from(schema.teams);
    return teams.map(t => ({
      id: t.id,
      name: t.name,
      createdAt: t.createdAt,
    }));
  }

  async findById(id: string): Promise<TeamRow | null> {
    const [team] = await db.select().from(schema.teams).where(eq(schema.teams.id, id));
    return team || null;
  }

  async create(data: CreateTeamInput): Promise<TeamRow> {
    const [team] = await db
      .insert(schema.teams)
      .values({ name: data.name })
      .returning();
    return team;
  }

  async update(id: string, data: UpdateTeamInput): Promise<TeamRow> {
    const updateData: Record<string, unknown> = {};
    if (data.name) updateData.name = data.name;

    const [team] = await db
      .update(schema.teams)
      .set(updateData)
      .where(eq(schema.teams.id, id))
      .returning();
    return team;
  }

  async delete(id: string): Promise<void> {
    await db.delete(schema.teams).where(eq(schema.teams.id, id));
  }

  async getUsers(teamId: string): Promise<UserRow[]> {
    return [];
  }
}

export class AdminRepository {
  userRepository = new UserRepository();
  roleRepository = new RoleRepository();
  permissionRepository = new PermissionRepository();
  queueRepository = new QueueRepository();
  teamRepository = new TeamRepository();

  async assignUserRole(userId: string, roleId: string): Promise<void> {
    await db.insert(schema.userRoles).values({ userId, roleId }).onConflictDoNothing();
  }

  async removeUserRole(userId: string, roleId: string): Promise<void> {
    await db.delete(schema.userRoles).where(
      eq(schema.userRoles.userId, userId) && eq(schema.userRoles.roleId, roleId)
    );
  }
}

export const adminRepository = new AdminRepository();
