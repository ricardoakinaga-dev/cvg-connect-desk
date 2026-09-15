import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@cvg/shared';
import { adminRepository } from '../infrastructure/repositories';
import { createUser, createRole, createPermission } from '../application/use-cases';

describe('admin use-cases — contrato de erro (AppError)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('createUser com e-mail duplicado devolve AppError 409 com code USER_EXISTS', async () => {
    const existingUser = {
      id: 'user-existing',
      name: 'Dup',
      email: 'dup@example.test',
      passwordHash: 'hash',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.spyOn(adminRepository.userRepository, 'findByEmail').mockResolvedValue(existingUser);

    const result = await createUser({ name: 'Dup', email: 'dup@example.test', password: 'secret' });

    expect(result.isErr()).toBe(true);
    if (result.isErr() && result.error instanceof AppError) {
      expect(result.error.statusCode).toBe(409);
      expect(result.error.code).toBe('USER_EXISTS');
      expect(result.error.message).toBe('User with this email already exists');
    } else {
      throw new Error('esperado Err(AppError) para e-mail duplicado');
    }
  });

  it('createRole com nome duplicado devolve AppError 409 com code ROLE_EXISTS', async () => {
    const existingRole = {
      id: 'role-existing',
      name: 'Admin',
      description: null,
      createdAt: new Date(),
    };
    vi.spyOn(adminRepository.roleRepository, 'findByName').mockResolvedValue(existingRole);

    const result = await createRole({ name: 'Admin' });

    expect(result.isErr()).toBe(true);
    if (result.isErr() && result.error instanceof AppError) {
      expect(result.error.statusCode).toBe(409);
      expect(result.error.code).toBe('ROLE_EXISTS');
      expect(result.error.message).toBe('Role with this name already exists');
    } else {
      throw new Error('esperado Err(AppError) para role duplicada');
    }
  });

  it('createPermission com nome duplicado devolve AppError 409 com code PERMISSION_EXISTS', async () => {
    const existingPermission = {
      id: 'perm-existing',
      name: 'admin:read',
      description: null,
      createdAt: new Date(),
    };
    vi.spyOn(adminRepository.permissionRepository, 'findByName').mockResolvedValue(existingPermission);

    const result = await createPermission({ name: 'admin:read' });

    expect(result.isErr()).toBe(true);
    if (result.isErr() && result.error instanceof AppError) {
      expect(result.error.statusCode).toBe(409);
      expect(result.error.code).toBe('PERMISSION_EXISTS');
      expect(result.error.message).toBe('Permission with this name already exists');
    } else {
      throw new Error('esperado Err(AppError) para permissão duplicada');
    }
  });
});
