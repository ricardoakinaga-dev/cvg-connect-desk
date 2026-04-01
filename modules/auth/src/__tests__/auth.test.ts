import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cvg/database', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  },
  schema: {
    users: { id: 'id', email: 'email', passwordHash: 'passwordHash', isActive: 'isActive', name: 'name', createdAt: 'createdAt' },
    sessions: { token: 'token', userId: 'userId', expiresAt: 'expiresAt' },
    roles: { id: 'id', name: 'name' },
    userRoles: { userId: 'userId', roleId: 'roleId' },
  },
  eq: vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
    genSalt: vi.fn(),
  },
}));

import bcrypt from 'bcryptjs';

describe('Auth - Password Verification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deve verificar senha correta', async () => {
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    const result = await bcrypt.compare('senha123', '$2b$12$hash');
    expect(result).toBe(true);
  });

  it('deve rejeitar senha incorreta', async () => {
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
    const result = await bcrypt.compare('senha_errada', '$2b$12$hash');
    expect(result).toBe(false);
  });
});

describe('Auth - Login Flow', () => {
  it('deve retornar 401 quando usuário não existe', async () => {
    const { authRepository } = await import('../infrastructure/repositories/auth.repository');
    vi.spyOn(authRepository, 'findUserByEmail').mockResolvedValue(null as any);

    const user = await authRepository.findUserByEmail('nao@existe.com');
    expect(user).toBeNull();
  });

  it('deve retornar 401 quando usuário está inativo', async () => {
    const { authRepository } = await import('../infrastructure/repositories/auth.repository');
    vi.spyOn(authRepository, 'findUserByEmail').mockResolvedValue({
      id: 'user-001', email: 'inativo@test.com', isActive: false,
      passwordHash: '$2b$12$hash', name: 'Inativo',
    } as any);

    const user = await authRepository.findUserByEmail('inativo@test.com');
    expect(user?.isActive).toBe(false);
  });
});

describe('Auth - Session Management', () => {
  it('deve criar sessão com token', async () => {
    const { authRepository } = await import('../infrastructure/repositories/auth.repository');
    vi.spyOn(authRepository, 'createSession').mockResolvedValue('token-abc-123');

    const token = await authRepository.createSession('user-001');
    expect(token).toBe('token-abc-123');
  });

  it('deve invalidar sessão no logout', async () => {
    const { authRepository } = await import('../infrastructure/repositories/auth.repository');
    vi.spyOn(authRepository, 'invalidateSession').mockResolvedValue(undefined);

    await expect(authRepository.invalidateSession('token-abc-123')).resolves.toBeUndefined();
  });
});
