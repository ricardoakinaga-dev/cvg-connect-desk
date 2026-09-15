import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Tasks } from '../pages/Tasks';
import { Alerts } from '../pages/Alerts';
import { useAuthStore } from '../store/auth';

const mocks = vi.hoisted(() => ({
  taskList: vi.fn(),
  alertList: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: { get: mocks.apiGet, post: mocks.apiPost, patch: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
  taskApi: { list: mocks.taskList, create: vi.fn(), updateStatus: vi.fn() },
  alertApi: { list: mocks.alertList, acknowledge: vi.fn(), resolve: vi.fn() },
  noteApi: { list: vi.fn() },
}));

const now = Date.now();
const makeTask = (id: string, title: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title,
  status: 'pending',
  priority: 'medium',
  createdAt: new Date(now).toISOString(),
  ...overrides,
});
const makeAlert = (id: string, title: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title,
  severity: 'info',
  type: 'system',
  status: 'active',
  createdAt: new Date(now).toISOString(),
  ...overrides,
});

beforeEach(() => {
  useAuthStore.setState({
    user: { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: 'Operador', email: 'op@example.test', roles: ['Admin'], permissions: ['tasks:read', 'alerts:read'] } as never,
    isAuthenticated: true,
    isLoading: false,
    authStatus: 'authenticated',
  });
  mocks.taskList.mockReset();
  mocks.alertList.mockReset();
  mocks.apiGet.mockReset();
  mocks.apiGet.mockImplementation((url: string) => {
    if (url.startsWith('/conversations')) return Promise.resolve({ items: [] });
    return Promise.resolve([]);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderedTitles(container: HTMLElement, selector: string): string[] {
  return Array.from(container.querySelectorAll(selector)).map((node) => node.textContent?.trim() ?? '');
}

describe('SA-037/SA-039 — prioridade da fila (A09)', () => {
  it('Tarefas ordena vencidas/urgentes antes das demais e concluídas por último', async () => {
    mocks.taskList.mockResolvedValue([
      makeTask('1', 'Tarefa concluída', { status: 'completed' }),
      makeTask('2', 'Tarefa baixa futura', { priority: 'low', dueAt: new Date(now + 86_400_000).toISOString() }),
      makeTask('3', 'Tarefa urgente vencida', { priority: 'urgent', dueAt: new Date(now - 3_600_000).toISOString() }),
      makeTask('4', 'Tarefa média pendente', { priority: 'medium' }),
    ]);

    const { container } = render(
      <MemoryRouter initialEntries={['/tasks']}>
        <Tasks />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Tarefa urgente vencida')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Tarefa concluída')).toBeTruthy());
    const titles = renderedTitles(container, '.task-card h3, .task-card .task-title, .task-card h2');
    const order = titles.length > 0 ? titles : renderedTitles(container, '.task-card');
    expect(order[0]).toContain('Tarefa urgente vencida');
    expect(order[order.length - 1]).toContain('Tarefa concluída');
  });

  it('Alertas ordena crítico ativo primeiro e resolvidos por último', async () => {
    mocks.alertList.mockResolvedValue([
      makeAlert('1', 'Alerta resolvido', { status: 'resolved', severity: 'critical' }),
      makeAlert('2', 'Alerta info ativo', { severity: 'info' }),
      makeAlert('3', 'Alerta crítico ativo', { severity: 'critical' }),
      makeAlert('4', 'Alerta reconhecido', { status: 'acknowledged', severity: 'error' }),
    ]);

    const { container } = render(
      <MemoryRouter initialEntries={['/alerts']}>
        <Alerts />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Alerta crítico ativo')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Alerta resolvido')).toBeTruthy());
    const titles = renderedTitles(container, '.alert-card .alert-title');
    const order = titles.length > 0 ? titles : renderedTitles(container, '.alert-card');
    expect(order[0]).toContain('Alerta crítico ativo');
    expect(order[order.length - 1]).toContain('Alerta resolvido');
  });
});
