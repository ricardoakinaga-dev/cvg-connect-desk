import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Settings } from '../pages/Settings';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: {
    get: mocks.get,
    post: mocks.post,
  },
}));

vi.mock('../store/auth', () => ({
  useAuthStore: (selector?: (state: { token: string }) => unknown) => {
    const state = { token: 'session-token' };
    return selector ? selector(state) : state;
  },
}));

describe('Settings page', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('desembrulha o envelope real de /auth/me e exibe o perfil efetivo', async () => {
    mocks.get.mockResolvedValue({
      user: {
        id: 'user-1',
        name: 'Marina Souza',
        email: 'marina@example.com',
        isActive: true,
        createdAt: '2026-01-15T12:00:00.000Z',
        roles: ['Atendimento'],
        permissions: ['chat:read', 'tasks:read'],
      },
    });

    render(<Settings />);

    await waitFor(() => expect(screen.getByText('Marina Souza')).toBeTruthy());
    expect(screen.getByText('marina@example.com')).toBeTruthy();
    expect(screen.getByText('Atendimento')).toBeTruthy();
    expect(screen.getByText('chat:read')).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledWith('/auth/me');
  });
});
