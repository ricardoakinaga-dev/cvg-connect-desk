import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App, { SessionExpiredWatcher } from '../../App';
import { SESSION_EXPIRED_EVENT } from '../../lib/api';
import { defaultNavigationPath, visibleNavGroups } from '../../navigation';

const harness = vi.hoisted(() => {
  const state = {
    user: null as { id: string; name: string; email: string; roles: string[]; permissions?: string[] } | null,
    token: null as string | null,
    isAuthenticated: false,
    isLoading: true,
    authStatus: 'checking' as 'checking' | 'authenticated' | 'unauthenticated' | 'error' | 'forbidden',
    bootError: null as string | null,
    error: null as string | null,
    sessionNotice: null as string | null,
    checkAuth: vi.fn(),
    expireSession: vi.fn(),
    logout: vi.fn(),
  };

  const useAuthStore = (selector?: (value: typeof state) => unknown) => selector ? selector(state) : state;
  const realtimeState = { status: 'idle', connected: false, attempt: 0, changedAt: 0 } as const;

  return {
    state,
    useAuthStore,
    realtimeDisconnect: vi.fn(),
    realtimeClient: {
      disconnect: vi.fn(),
      connect: vi.fn(),
      getConnectionState: () => realtimeState,
      subscribeConnectionState: () => () => undefined,
    },
  };
});

vi.mock('../../store/auth', () => ({ useAuthStore: harness.useAuthStore }));
vi.mock('../../lib/realtime', () => ({ realtimeClient: harness.realtimeClient }));

function resetAuth(overrides: Partial<typeof harness.state> = {}) {
  Object.assign(harness.state, {
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: false,
    authStatus: 'unauthenticated',
    bootError: null,
    error: null,
    sessionNotice: null,
    ...overrides,
  });
  harness.state.checkAuth.mockReset();
  harness.state.expireSession.mockReset();
  harness.realtimeClient.disconnect.mockReset();
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

describe('PROD-17 — boot, capacidades e expiração de sessão', () => {
  beforeEach(() => {
    resetAuth();
    window.matchMedia = ((query: string) => ({
      matches: query.includes('max-width: 860px') ? false : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });

  it('não libera uma rota protegida antes de confirmar /auth/me', async () => {
    resetAuth({
      user: { id: 'u-1', name: 'Ana', email: 'ana@example.test', roles: ['Admin'], permissions: ['admin:read'] },
      token: 'persisted-token',
      isAuthenticated: true,
      isLoading: true,
      authStatus: 'checking',
    });
    harness.state.checkAuth.mockResolvedValue(undefined);
    window.history.replaceState({}, '', '/admin');

    render(<App />);

    expect(screen.getByText('Carregando sua sessão…')).toBeTruthy();
    expect(screen.queryByText('Administração')).toBeNull();
    await waitFor(() => expect(harness.state.checkAuth).toHaveBeenCalledTimes(1));
  });

  it('mantém a área protegida fechada e oferece retry quando a validação falha na rede', () => {
    resetAuth({
      user: { id: 'u-1', name: 'Ana', email: 'ana@example.test', roles: ['Admin'], permissions: ['admin:read'] },
      token: 'persisted-token',
      isAuthenticated: false,
      authStatus: 'error',
      bootError: 'Não foi possível validar sua sessão.',
    });
    window.history.replaceState({}, '', '/admin');

    render(<App />);

    expect(screen.getByText('Sessão não validada')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy();
    expect(screen.queryByText('Administração')).toBeNull();
  });

  it('filtra menu por permission efetiva e trata deep-link sem permissão', () => {
    resetAuth({
      user: { id: 'u-1', name: 'Ana', email: 'ana@example.test', roles: ['Custom'], permissions: ['tasks:read'] },
      token: 'token',
      isAuthenticated: true,
      authStatus: 'authenticated',
    });
    window.history.replaceState({}, '', '/admin');

    render(<App />);

    expect(screen.getByRole('link', { name: 'Tarefas' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Administração' })).toBeNull();
    expect(screen.getByText('Acesso negado')).toBeTruthy();
  });

  it('limpa a conexão realtime e navega ao login após expiração confirmada', async () => {
    resetAuth({
      user: { id: 'u-1', name: 'Ana', email: 'ana@example.test', roles: ['Admin'], permissions: ['admin:read'] },
      token: 'token',
      isAuthenticated: true,
      authStatus: 'authenticated',
    });

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <SessionExpiredWatcher />
        <LocationProbe />
      </MemoryRouter>,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { notice: 'Sessão expirada' } }));
    });

    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('/login'));
    expect(harness.realtimeClient.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.state.expireSession).toHaveBeenCalledWith('Sessão expirada');
  });

  it('calcula a rota inicial a partir das capacidades, nunca de uma suposição de papel', () => {
    const user = { id: 'u-1', name: 'Ana', email: 'ana@example.test', roles: ['Custom'], permissions: ['notes:read'] };
    const groups = visibleNavGroups(user);

    expect(groups.flatMap((group) => group.items).map((item) => item.to)).toEqual(['/notes']);
    expect(defaultNavigationPath(user)).toBe('/notes');
    expect(defaultNavigationPath(null)).toBe('/settings');
  });
});
