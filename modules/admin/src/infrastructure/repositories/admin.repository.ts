import { db, schema } from '@cvg/database';
import { and, eq } from 'drizzle-orm';
import type {
  UserListItem, CreateUserInput, UpdateUserInput,
  RoleListItem, CreateRoleInput, UpdateRoleInput,
  PermissionItem, CreatePermissionInput, PermissionName,
  QueueItem, CreateQueueInput, UpdateQueueInput,
  TeamItem, CreateTeamInput, UpdateTeamInput,
} from '../../types';

export type User = typeof schema.users.$inferSelect;
export type Role = typeof schema.roles.$inferSelect;
export type Permission = typeof schema.permissions.$inferSelect;
export type Queue = typeof schema.queues.$inferSelect;
export type Team = typeof schema.teams.$inferSelect;

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

  async findById(id: string): Promise<User | null> {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    return user || null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    return user || null;
  }

  async create(data: CreateUserInput): Promise<User> {
    const [user] = await db
      .insert(schema.users)
      .values({
        name: data.name,
        email: data.email,
        passwordHash: data.password, // NOTE: hash deve ser feito no use case ou service
        isActive: data.isActive ?? true,
      })
      .returning();
    return user;
  }

  async update(id: string, data: Partial<UpdateUserInput>): Promise<User> {
    const updateData: Partial<Pick<User, 'name' | 'email' | 'passwordHash' | 'isActive'>> = {};
    if (data.name) updateData.name = data.name;
    if (data.email) updateData.email = data.email;
    if (data.password) updateData.passwordHash = data.password; // NOTE: hash no use case
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
    // Remove assigned roles existentes
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    // Insere novas atribuições
    if (roleIds.length > 0) {
      const values = roleIds.map(roleId => ({ userId, roleId }));
      await db.insert(schema.userRoles).values(values);
    }
  }

  async getRoles(userId: string): Promise<Role[]> {
    const rows = await db
      .select()
      .from(schema.roles)
      .innerJoin(schema.userRoles, eq(schema.userRoles.roleId, schema.roles.id))
      .where(eq(schema.userRoles.userId, userId));
    return rows.map(row => row.roles);
  }

  async getPermissions(userId: string): Promise<Permission[]> {
    const rows = await db
      .select()
      .from(schema.permissions)
      .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
      .innerJoin(schema.userRoles, eq(schema.userRoles.roleId, schema.rolePermissions.roleId))
      .where(eq(schema.userRoles.userId, userId));
    return rows.map(row => row.permissions);
  }
}

export class RoleRepository {
  async findAll(): Promise<RoleListItem[]> {
    const roles = await db.select().from(schema.roles);
    // Podemos melhorar com count de permissions depois
    return roles.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description ?? undefined,
      createdAt: r.createdAt,
    }));
  }

  async findById(id: string): Promise<Role | null> {
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.id, id));
    return role || null;
  }

  async findByName(name: string): Promise<Role | null> {
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, name));
    return role || null;
  }

  async create(data: CreateRoleInput): Promise<Role> {
    const [role] = await db
      .insert(schema.roles)
      .values({ name: data.name, description: data.description })
      .returning();
    if (data.permissionIds && data.permissionIds.length > 0) {
      await this.assignPermissions(role.id, data.permissionIds);
    }
    return role;
  }

  async update(id: string, data: Partial<UpdateRoleInput>): Promise<Role> {
    const updateData: Partial<Pick<Role, 'name' | 'description'>> = {};
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

  async getPermissions(roleId: string): Promise<Permission[]> {
    const rows = await db
      .select()
      .from(schema.permissions)
      .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
      .where(eq(schema.rolePermissions.roleId, roleId));
    return rows.map(row => row.permissions);
  }
}

export class PermissionRepository {
  async findAll(): Promise<PermissionItem[]> {
    const permissions = await db.select().from(schema.permissions);
    return permissions.map(p => ({
      id: p.id,
      name: p.name as PermissionName,
      description: p.description ?? undefined,
      createdAt: p.createdAt,
    }));
  }

  async findById(id: string): Promise<Permission | null> {
    const [perm] = await db.select().from(schema.permissions).where(eq(schema.permissions.id, id));
    return perm || null;
  }

  async findByName(name: string): Promise<Permission | null> {
    const [perm] = await db.select().from(schema.permissions).where(eq(schema.permissions.name, name));
    return perm || null;
  }

  async create(data: CreatePermissionInput): Promise<Permission> {
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
      description: q.description ?? undefined,
      createdAt: q.createdAt,
    }));
  }

  async findById(id: string): Promise<Queue | null> {
    const [queue] = await db.select().from(schema.queues).where(eq(schema.queues.id, id));
    return queue || null;
  }

  async create(data: CreateQueueInput): Promise<Queue> {
    const [queue] = await db
      .insert(schema.queues)
      .values({ name: data.name, description: data.description })
      .returning();
    return queue;
  }

  async update(id: string, data: UpdateQueueInput): Promise<Queue> {
    const updateData: Partial<Pick<Queue, 'name' | 'description'>> = {};
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
    // TODO: count users por team depois
    return teams.map(t => ({
      id: t.id,
      name: t.name,
      createdAt: t.createdAt,
    }));
  }

  async findById(id: string): Promise<Team | null> {
    const [team] = await db.select().from(schema.teams).where(eq(schema.teams.id, id));
    return team || null;
  }

  async create(data: CreateTeamInput): Promise<Team> {
    const [team] = await db
      .insert(schema.teams)
      .values({ name: data.name })
      .returning();
    return team;
  }

  async update(id: string, data: UpdateTeamInput): Promise<Team> {
    const updateData: Partial<Pick<Team, 'name'>> = {};
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

  async getUsers(_teamId: string): Promise<User[]> {
    // Nota: não há FK direta teams→users;需要通过 user_roles ou tabela de associação dedicada
    // Por enquanto retorna vazio
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
      and(
        eq(schema.userRoles.userId, userId),
        eq(schema.userRoles.roleId, roleId),
      )
    );
  }
}

export const adminRepository = new AdminRepository();
