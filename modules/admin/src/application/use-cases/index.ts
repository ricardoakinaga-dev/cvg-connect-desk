import { ok, err, type Result } from '@cvg/shared';
import { AppError, BadRequestError, NotFoundError } from '@cvg/shared';
import { db, schema } from '@cvg/database';
import { and, eq, notInArray } from 'drizzle-orm';
import { adminRepository } from '../../infrastructure/repositories';
import { insertAuditLog } from '@cvg/audit';
import * as bcrypt from 'bcryptjs';
import type {
  PublicUser, CreateUserInput, UpdateUserInput,
  Role, CreateRoleInput, UpdateRoleInput,
  Permission, CreatePermissionInput,
  Queue, CreateQueueInput, UpdateQueueInput,
  Team, CreateTeamInput, UpdateTeamInput,
} from '../../types';
import { toPublicUser } from '../../types';

/**
 * Contexto de auditoria da ação administrativa (SA-006/AC2). A trilha
 * participa do MESMO commit da entidade e da substituição de papéis.
 */
export interface AdminActionContext {
  actorId?: string;
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
}

function pgErrorCode(error: unknown): string | undefined {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code ?? candidate?.cause?.code;
}

function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === '23505';
}

/** Violação de FK na atribuição de papéis ⇒ erro de entrada, nunca 500. */
function isForeignKeyViolation(error: unknown): boolean {
  return pgErrorCode(error) === '23503';
}

/**
 * Substitui os papéis do usuário DENTRO do executor recebido.
 * Ordem segura: insere os novos vínculos primeiro (idempotente) e só então
 * remove os obsoletos — uma falha no meio nunca deixa o usuário sem papéis
 * (A07/SA-006-AC1) e não há janela sem vínculo.
 */
async function replaceRolesTx(
  executor: Pick<typeof db, 'insert' | 'delete'>,
  userId: string,
  roleIds: string[],
): Promise<void> {
  const unique = [...new Set(roleIds)];
  if (unique.length > 0) {
    await executor
      .insert(schema.userRoles)
      .values(unique.map((roleId) => ({ userId, roleId })))
      .onConflictDoNothing();
    await executor
      .delete(schema.userRoles)
      .where(and(eq(schema.userRoles.userId, userId), notInArray(schema.userRoles.roleId, unique)));
  } else {
    await executor.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
  }
}

// User Use Cases
export async function createUser(
  input: CreateUserInput,
  context: AdminActionContext = {},
): Promise<Result<PublicUser, Error>> {
  try {
    if (!input.name || !input.email || !input.password) {
      return err(new BadRequestError('Name, email and password are required'));
    }

    const existing = await adminRepository.userRepository.findByEmail(input.email);
    if (existing) {
      return err(new AppError('User with this email already exists', 409, 'USER_EXISTS'));
    }

    const passwordHash = await bcrypt.hash(input.password, 12);

    const user = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.users)
        .values({
          name: input.name,
          email: input.email,
          passwordHash,
          isActive: input.isActive ?? true,
        })
        .returning();

      if (input.roleIds && input.roleIds.length > 0) {
        await replaceRolesTx(tx, created.id, input.roleIds);
      }

      await insertAuditLog(tx, {
        userId: context.actorId ?? null,
        action: 'admin.user.created',
        entityType: 'user',
        entityId: created.id,
        newValue: { id: created.id, name: created.name, email: created.email, isActive: created.isActive, roleIds: input.roleIds ?? [] },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        correlationId: context.correlationId ?? null,
      });

      return created;
    });

    return ok(toPublicUser(user));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return err(new AppError('User with this email already exists', 409, 'USER_EXISTS'));
    }
    if (isForeignKeyViolation(error)) {
      return err(new BadRequestError('Um ou mais papéis informados não existem', 'INVALID_ROLE'));
    }
    return err(error as Error);
  }
}

export async function updateUser(
  id: string,
  input: Partial<UpdateUserInput>,
  context: AdminActionContext = {},
): Promise<Result<PublicUser, Error>> {
  try {
    const user = await adminRepository.userRepository.findById(id);
    if (!user) {
      return err(new NotFoundError('User not found'));
    }

    let passwordHash: string | undefined;
    if (input.password) {
      passwordHash = await bcrypt.hash(input.password, 12);
    }

    const updated = await db.transaction(async (tx) => {
      const patch: Partial<typeof schema.users.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.email !== undefined) patch.email = input.email;
      if (passwordHash !== undefined) patch.passwordHash = passwordHash;
      if (input.isActive !== undefined) patch.isActive = input.isActive;

      const [row] = await tx
        .update(schema.users)
        .set(patch)
        .where(eq(schema.users.id, id))
        .returning();

      // SA-012: troca de credencial revoga TODAS as sessões do usuário no
      // MESMO commit — tokens antigos deixam de valer em HTTP e WS.
      if (passwordHash !== undefined) {
        await tx.delete(schema.sessions).where(eq(schema.sessions.userId, id));
      }

      if (input.roleIds !== undefined) {
        await replaceRolesTx(tx, id, input.roleIds);
      }

      await insertAuditLog(tx, {
        userId: context.actorId ?? null,
        action: 'admin.user.updated',
        entityType: 'user',
        entityId: id,
        oldValue: { name: user.name, email: user.email, isActive: user.isActive },
        newValue: {
          name: row.name,
          email: row.email,
          isActive: row.isActive,
          ...(input.roleIds !== undefined ? { roleIds: input.roleIds } : {}),
          passwordChanged: Boolean(passwordHash),
        },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        correlationId: context.correlationId ?? null,
      });

      return row;
    });

    return ok(toPublicUser(updated));
  } catch (error) {
    if (isUniqueViolation(error)) {
      return err(new AppError('User with this email already exists', 409, 'USER_EXISTS'));
    }
    if (isForeignKeyViolation(error)) {
      return err(new BadRequestError('Um ou mais papéis informados não existem', 'INVALID_ROLE'));
    }
    return err(error as Error);
  }
}

export async function deleteUser(id: string, context: AdminActionContext = {}): Promise<Result<void, Error>> {
  try {
    const user = await adminRepository.userRepository.findById(id);
    if (!user) {
      return err(new NotFoundError('User not found'));
    }

    await db.transaction(async (tx) => {
      await tx.delete(schema.users).where(eq(schema.users.id, id));
      await insertAuditLog(tx, {
        userId: context.actorId ?? null,
        action: 'admin.user.deleted',
        entityType: 'user',
        entityId: id,
        oldValue: { name: user.name, email: user.email, isActive: user.isActive },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        correlationId: context.correlationId ?? null,
      });
    });

    return ok(undefined);
  } catch (error) {
    return err(error as Error);
  }
}

export async function assignRolesToUser(
  userId: string,
  roleIds: string[],
  context: AdminActionContext = {},
): Promise<Result<void, Error>> {
  try {
    const user = await adminRepository.userRepository.findById(userId);
    if (!user) {
      return err(new NotFoundError('User not found'));
    }

    await db.transaction(async (tx) => {
      // Serializa concorrentes do mesmo usuário: o segundo espera o commit do
      // primeiro e aplica seu conjunto sobre o resultado final, sem janela de
      // remoção cruzada (SA-006/AC3).
      await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).for('update');
      await replaceRolesTx(tx, userId, roleIds);
      await insertAuditLog(tx, {
        userId: context.actorId ?? null,
        action: 'admin.user.roles_replaced',
        entityType: 'user',
        entityId: userId,
        newValue: { roleIds },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        correlationId: context.correlationId ?? null,
      });
    });

    return ok(undefined);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return err(new AppError('Role assignment conflict', 409, 'ROLE_ASSIGNMENT_CONFLICT'));
    }
    if (isForeignKeyViolation(error)) {
      return err(new BadRequestError('Um ou mais papéis informados não existem', 'INVALID_ROLE'));
    }
    return err(error as Error);
  }
}

// Role Use Cases
export async function createRole(input: CreateRoleInput): Promise<Result<Role, Error>> {
  try {
    if (!input.name) {
      return err(new BadRequestError('Role name is required'));
    }

    const existing = await adminRepository.roleRepository.findByName(input.name);
    if (existing) {
      return err(new AppError('Role with this name already exists', 409, 'ROLE_EXISTS'));
    }

    const role = await adminRepository.roleRepository.create(input);
    return ok(role);
  } catch (error) {
    return err(error as Error);
  }
}

export async function updateRole(id: string, input: Partial<UpdateRoleInput>): Promise<Result<Role, Error>> {
  try {
    const role = await adminRepository.roleRepository.findById(id);
    if (!role) {
      return err(new NotFoundError('Role not found'));
    }

    const updated = await adminRepository.roleRepository.update(id, input);
    return ok(updated);
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      return err(new BadRequestError('Uma ou mais permissões informadas não existem', 'INVALID_PERMISSION'));
    }
    return err(error as Error);
  }
}

export async function deleteRole(id: string): Promise<Result<void, Error>> {
  try {
    const role = await adminRepository.roleRepository.findById(id);
    if (!role) {
      return err(new NotFoundError('Role not found'));
    }

    await adminRepository.roleRepository.delete(id);
    return ok(undefined);
  } catch (error) {
    return err(error as Error);
  }
}

// Permission Use Cases
export async function createPermission(input: CreatePermissionInput): Promise<Result<Permission, Error>> {
  try {
    const existing = await adminRepository.permissionRepository.findByName(input.name);
    if (existing) {
      return err(new AppError('Permission with this name already exists', 409, 'PERMISSION_EXISTS'));
    }

    const permission = await adminRepository.permissionRepository.create(input);
    return ok(permission);
  } catch (error) {
    return err(error as Error);
  }
}

export async function deletePermission(id: string): Promise<Result<void, Error>> {
  try {
    await adminRepository.permissionRepository.delete(id);
    return ok(undefined);
  } catch (error) {
    return err(error as Error);
  }
}

// Queue Use Cases
export async function createQueue(input: CreateQueueInput): Promise<Result<Queue, Error>> {
  try {
    const queue = await adminRepository.queueRepository.create(input);
    return ok(queue);
  } catch (error) {
    return err(error as Error);
  }
}

export async function updateQueue(id: string, input: UpdateQueueInput): Promise<Result<Queue, Error>> {
  try {
    const queue = await adminRepository.queueRepository.findById(id);
    if (!queue) {
      return err(new NotFoundError('Queue not found'));
    }

    const updated = await adminRepository.queueRepository.update(id, input);
    return ok(updated);
  } catch (error) {
    return err(error as Error);
  }
}

export async function deleteQueue(id: string): Promise<Result<void, Error>> {
  try {
    await adminRepository.queueRepository.delete(id);
    return ok(undefined);
  } catch (error) {
    return err(error as Error);
  }
}

// Team Use Cases
export async function createTeam(input: CreateTeamInput): Promise<Result<Team, Error>> {
  try {
    const team = await adminRepository.teamRepository.create(input);
    return ok(team);
  } catch (error) {
    return err(error as Error);
  }
}

export async function updateTeam(id: string, input: UpdateTeamInput): Promise<Result<Team, Error>> {
  try {
    const team = await adminRepository.teamRepository.findById(id);
    if (!team) {
      return err(new NotFoundError('Team not found'));
    }

    const updated = await adminRepository.teamRepository.update(id, input);
    return ok(updated);
  } catch (error) {
    return err(error as Error);
  }
}

export async function deleteTeam(id: string): Promise<Result<void, Error>> {
  try {
    await adminRepository.teamRepository.delete(id);
    return ok(undefined);
  } catch (error) {
    return err(error as Error);
  }
}
