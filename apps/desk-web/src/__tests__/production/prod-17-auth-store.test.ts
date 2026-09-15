import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../../lib/api', () => ({ api: apiMock }));

import { useAuthStore } from '../../store/auth';

const validUser = {
  id: 'u-1',
  name: 'Ana Souza',
  email: 'ana@example.test',
  roles: ['Custom'],
  permissions: ['tasks:read'],
};

beforeEach(() => {
  localStorage.clear();
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  useAuthStore.setState({
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: false,
    authStatus: 'unauthenticated',
    bootError: null,
    error: null,
    sessionNotice: null,
  });
});

describe('PROD-17 — estado persistido e validação de sessão', () => {
  it('valida a sessão persistida e atualiza capacidades efetivas', async () => {
    useAuthStore.setState({ token: 'persisted-token', isAuthenticated: true, authStatus: 'checking' });
    apiMock.get.mockResolvedValue({ user: validUser });

    await useAuthStore.getState().checkAuth();

    expect(apiMock.get).toHaveBeenCalledWith('/auth/me');
    expect(useAuthStore.getState()).toMatchObject({
      user: validUser,
      token: 'persisted-token',
      isAuthenticated: true,
      isLoading: false,
      authStatus: 'authenticated',
      bootError: null,
    });
  });

  it('não descarta sessão nem libera dados quando a validação falha por rede', async () => {
    useAuthStore.setState({ user: validUser, token: 'persisted-token', isAuthenticated: true, authStatus: 'authenticated' });
    apiMock.get.mockRejectedValue(new Error('Failed to fetch'));

    await useAuthStore.getState().checkAuth();

    expect(useAuthStore.getState()).toMatchObject({
      user: validUser,
      token: 'persisted-token',
      isAuthenticated: false,
      isLoading: false,
      authStatus: 'error',
    });
    expect(useAuthStore.getState().bootError).toMatch(/validar sua sessão/);
  });

  it('limpa o principal somente quando a API confirma 401', async () => {
    useAuthStore.setState({ user: validUser, token: 'expired-token', isAuthenticated: true, authStatus: 'authenticated' });
    apiMock.get.mockRejectedValue(Object.assign(new Error('Invalid token'), { status: 401 }));

    await useAuthStore.getState().checkAuth();

    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      token: null,
      isAuthenticated: false,
      authStatus: 'unauthenticated',
      sessionNotice: 'Sua sessão expirou. Entre novamente para continuar.',
    });
  });
});
