import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Layout } from '../Layout';

vi.mock('../../../store/auth', () => ({
  useAuthStore: () => ({
    user: {
      id: 'u-1',
      name: 'Ana Souza',
      roles: ['admin'],
      permissions: ['chat:read', 'tasks:read', 'notes:read', 'alerts:read', 'dashboard:read', 'admin:read'],
    },
    logout: vi.fn(),
  }),
}));

let compact = false;

beforeEach(() => {
  compact = false;
  window.matchMedia = ((query: string) => ({
    matches: query.includes('max-width: 860px') ? compact : false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/tasks']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/tasks" element={<div>conteúdo de tarefas</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('Layout shell', () => {
  it('renders skip link, navigation, logout and routed content with accessible names', () => {
    renderShell();
    expect(screen.getByRole('link', { name: 'Ir para o conteúdo' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Inbox' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sair com segurança' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abrir navegação' })).toBeTruthy();
    expect(screen.getByText('conteúdo de tarefas')).toBeTruthy();
    expect(document.querySelector('.sidebar')?.hasAttribute('inert')).toBe(false);
  });

  it('renders the real idle connection state instead of a hardcoded online claim', () => {
    renderShell();
    const statuses = screen.getAllByRole('status').map((node) => node.textContent).join(' ');
    expect(statuses).toContain('Sem conexão');
    expect(statuses).toContain('Tempo real inativo');
    expect(statuses).not.toContain('Central ativa');
    expect(screen.queryByText('Online')).toBeNull();
  });

  it('keeps the sidebar inert and the drawer closed while compact', () => {
    compact = true;
    renderShell();
    const sidebar = document.querySelector('.sidebar');
    expect(sidebar?.hasAttribute('inert')).toBe(true);
    expect(screen.getByRole('button', { name: 'Abrir navegação' }).getAttribute('aria-expanded')).toBe('false');
  });
});
