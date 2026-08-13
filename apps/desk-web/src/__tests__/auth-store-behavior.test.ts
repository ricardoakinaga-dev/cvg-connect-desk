import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: apiMock,
}));

const { useAuthStore } = await import('../store/auth');

const user = {
  id: 'user-1',
  name: 'Agente CVG',
  email: 'agente@example.test',
  roles: ['Agent'],
};

describe('useAuthStore behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  });

  it('logs in without storing a bearer token', async () => {
    apiMock.post.mockResolvedValue({ user });

    await useAuthStore.getState().login('agente@example.test', 'senha-segura');

    expect(apiMock.post).toHaveBeenCalledWith('/auth/login', {
      email: 'agente@example.test',
      password: 'senha-segura',
    });
    expect(useAuthStore.getState()).toMatchObject({
      user,
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });
    expect(useAuthStore.getState()).not.toHaveProperty('token');
  });

  it('stores login errors and rethrows them', async () => {
    const error = new Error('Credenciais invalidas');
    apiMock.post.mockRejectedValue(error);

    await expect(useAuthStore.getState().login('agente@example.test', 'errada')).rejects.toThrow('Credenciais invalidas');

    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: 'Credenciais invalidas',
    });
  });

  it('clears local session on logout even when the API call fails', async () => {
    useAuthStore.setState({ user, isAuthenticated: true, isLoading: false, error: 'old' });
    apiMock.post.mockRejectedValue(new Error('network'));

    await useAuthStore.getState().logout();

    expect(apiMock.post).toHaveBeenCalledWith('/auth/logout');
    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      isAuthenticated: false,
      error: null,
    });
  });

  it('checks cookie-backed auth and clears state when the session is invalid', async () => {
    apiMock.get.mockResolvedValueOnce({ user });

    await useAuthStore.getState().checkAuth();

    expect(apiMock.get).toHaveBeenCalledWith('/auth/me');
    expect(useAuthStore.getState()).toMatchObject({
      user,
      isAuthenticated: true,
      isLoading: false,
    });

    apiMock.get.mockRejectedValueOnce(new Error('expired'));
    await useAuthStore.getState().checkAuth();

    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
  });

  it('does not call logout API when there is no authenticated session', async () => {
    await useAuthStore.getState().logout();

    expect(apiMock.post).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      isAuthenticated: false,
    });
  });
});
