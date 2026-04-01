import { ok, err, type Result } from '@cvg/shared';
import { AppError, BadRequestError, NotFoundError } from '@cvg/shared';
import { adminRepository } from '../../infrastructure/repositories';
import * as bcrypt from 'bcryptjs';
import type {
  CreateUserInput, UpdateUserInput,
  CreateRoleInput, UpdateRoleInput,
  CreatePermissionInput,
  CreateQueueInput, UpdateQueueInput,
  CreateTeamInput, UpdateTeamInput,
} from '../../types';
import type { users, roles, permissions, queues, teams } from '@cvg/database';
type User = typeof users.$inferSelect;
type Role = typeof roles.$inferSelect;
type Permission = typeof permissions.$inferSelect;
type Queue = typeof queues.$inferSelect;
type Team = typeof teams.$inferSelect;

// User Use Cases
export async function createUser(input: CreateUserInput): Promise<Result<User, Error>> {
  try {
    if (!input.name || !input.email || !input.password) {
      return err(new BadRequestError('Name, email and password are required'));
    }

    const existing = await adminRepository.userRepository.findByEmail(input.email);
    if (existing) {
      return err(new AppError('User with this email already exists', 409, 'USER_EXISTS'));
    }

    const passwordHash = await bcrypt.hash(input.password, 12);

    const user = await adminRepository.userRepository.create({
      ...input,
      password: passwordHash,
    });

    if (input.roleIds && input.roleIds.length > 0) {
      await adminRepository.userRepository.assignRoles(user.id, input.roleIds);
    }

    return ok(user);
  } catch (error) {
    return err(error as Error);
  }
}

export async function updateUser(id: string, input: Partial<UpdateUserInput>): Promise<Result<User, Error>> {
  try {
    const user = await adminRepository.userRepository.findById(id);
    if (!user) {
      return err(new NotFoundError('User not found'));
    }

    let passwordHash: string | undefined;
    if (input.password) {
      passwordHash = await bcrypt.hash(input.password, 12);
    }

    const updated = await adminRepository.userRepository.update(id, {
      ...input,
      password: passwordHash,
    });

    if (input.roleIds !== undefined) {
      await adminRepository.userRepository.assignRoles(id, input.roleIds);
    }

    return ok(updated);
  } catch (error) {
    return err(error as Error);
  }
}

export async function deleteUser(id: string): Promise<Result<void, Error>> {
  try {
    const user = await adminRepository.userRepository.findById(id);
    if (!user) {
      return err(new NotFoundError('User not found'));
    }

    await adminRepository.userRepository.delete(id);
    return ok(undefined);
  } catch (error) {
    return err(error as Error);
  }
}

export async function assignRolesToUser(userId: string, roleIds: string[]): Promise<Result<void, Error>> {
  try {
    await adminRepository.userRepository.assignRoles(userId, roleIds);
    return ok(undefined);
  } catch (error) {
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
