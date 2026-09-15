import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Tasks } from '../pages/Tasks';
import { Alerts } from '../pages/Alerts';
import { Notes } from '../pages/Notes';
import { useAuthStore } from '../store/auth';

const mocks = vi.hoisted(() => ({
  taskList: vi.fn(),
  taskCreate: vi.fn(),
  taskUpdateStatus: vi.fn(),
  alertList: vi.fn(),
  alertAck: vi.fn(),
  alertResolve: vi.fn(),
  noteList: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: {
    get: mocks.apiGet,
    post: mocks.apiPost,
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
  taskApi: {
    list: mocks.taskList,
    create: mocks.taskCreate,
    updateStatus: mocks.taskUpdateStatus,
  },
  alertApi: {
    list: mocks.alertList,
    acknowledge: mocks.alertAck,
    resolve: mocks.alertResolve,
  },
  noteApi: {
    list: mocks.noteList,
  },
}));

const CONV_A = '11111111-1111-4111-8111-111111111111';
const CONV_B = '22222222-2222-4222-8222-222222222222';

const taskA = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: 'Tarefa da conversa A',
  status: 'pending',
  priority: 'high',
  conversationId: CONV_A,
  createdAt: new Date().toISOString(),
};
const taskB = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  title: 'Tarefa da conversa B',
  status: 'pending',
  priority: 'high',
  conversationId: CONV_B,
  createdAt: new Date().toISOString(),
};
const alertA = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  title: 'Alerta da conversa A',
  severity: 'critical',
  type: 'message',
  status: 'active',
  conversationId: CONV_A,
  createdAt: new Date().toISOString(),
};
const alertB = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  title: 'Alerta da conversa B',
  severity: 'critical',
  type: 'message',
  status: 'active',
  conversationId: CONV_B,
  createdAt: new Date().toISOString(),
};
const noteA = {
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  referenceType: 'conversation',
  referenceId: CONV_A,
  conversationId: CONV_A,
  authorId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  content: 'Nota da conversa A',
  createdAt: new Date().toISOString(),
};
const noteB = { ...noteA, id: '99999999-9999-4999-8999-999999999999', referenceId: CONV_B, conversationId: CONV_B, content: 'Nota da conversa B' };

beforeEach(() => {
  useAuthStore.setState({
    user: { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: 'Operador', email: 'op@example.test', roles: ['Admin'], permissions: ['tasks:read', 'alerts:read', 'notes:read'] } as never,
    isAuthenticated: true,
    isLoading: false,
    authStatus: 'authenticated',
  });
  mocks.taskList.mockReset();
  mocks.alertList.mockReset();
  mocks.noteList.mockReset();
  mocks.apiGet.mockReset();
  mocks.apiPost.mockReset();
  mocks.taskList.mockResolvedValue([taskA, taskB]);
  mocks.alertList.mockResolvedValue([alertA, alertB]);
  mocks.noteList.mockResolvedValue([noteA, noteB]);
  mocks.apiGet.mockImplementation((url: string) => {
    if (url.startsWith('/conversations')) return Promise.resolve({ items: [] });
    if (url.startsWith('/tutors')) return Promise.resolve([]);
    if (url.startsWith('/patients')) return Promise.resolve([]);
    return Promise.resolve([]);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SA-008 — contexto de conversa na UI (A06/C04)', () => {
  it('Tarefas envia o filtro da URL e exibe somente a conversa selecionada', async () => {
    mocks.taskList.mockImplementation((filters?: { conversationId?: string }) =>
      Promise.resolve(filters?.conversationId === CONV_A ? [taskA] : [taskA, taskB]));

    render(
      <MemoryRouter initialEntries={[`/tasks?conversationId=${CONV_A}`]}>
        <Tasks />
      </MemoryRouter>,
    );

    await waitFor(() => expect(mocks.taskList).toHaveBeenCalledWith({ conversationId: CONV_A }));
    await waitFor(() => expect(screen.getByText('Tarefa da conversa A')).toBeTruthy());
    expect(screen.queryByText('Tarefa da conversa B')).toBeNull();
    expect(screen.getByText(/conversa selecionada/i)).toBeTruthy();
  });

  it('remover o filtro é ação explícita e refaz a consulta sem contexto', async () => {
    mocks.taskList.mockImplementation((filters?: { conversationId?: string }) =>
      Promise.resolve(filters?.conversationId ? [taskA] : [taskA, taskB]));

    render(
      <MemoryRouter initialEntries={[`/tasks?conversationId=${CONV_A}`]}>
        <Tasks />
      </MemoryRouter>,
    );
    await waitFor(() => expect(mocks.taskList).toHaveBeenCalledWith({ conversationId: CONV_A }));

    fireEvent.click(screen.getByRole('button', { name: 'Remover filtro' }));
    await waitFor(() => expect(mocks.taskList).toHaveBeenCalledWith(undefined));
    await waitFor(() => expect(screen.getByText('Tarefa da conversa B')).toBeTruthy());
  });

  it('contexto inválido mostra erro claro e não chama a API', async () => {
    render(
      <MemoryRouter initialEntries={['/tasks?conversationId=nao-e-uuid']}>
        <Tasks />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/Contexto inválido/i)).toBeTruthy());
    expect(mocks.taskList).not.toHaveBeenCalled();
  });

  it('contexto inacessível (404) mostra erro sem vazar títulos', async () => {
    mocks.taskList.mockRejectedValue(Object.assign(new Error('Conversa não encontrada'), { status: 404 }));
    render(
      <MemoryRouter initialEntries={[`/tasks?conversationId=${CONV_B}`]}>
        <Tasks />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/Contexto inacessível/i)).toBeTruthy());
    expect(screen.queryByText('Tarefa da conversa B')).toBeNull();
    expect(mocks.taskList).toHaveBeenCalledTimes(1);
  });

  it('Alertas envia o filtro da URL e exibe somente a conversa selecionada', async () => {
    mocks.alertList.mockImplementation((filters?: { conversationId?: string }) =>
      Promise.resolve(filters?.conversationId === CONV_A ? [alertA] : [alertA, alertB]));

    render(
      <MemoryRouter initialEntries={[`/alerts?conversationId=${CONV_A}`]}>
        <Alerts />
      </MemoryRouter>,
    );
    await waitFor(() => expect(mocks.alertList).toHaveBeenCalledWith({ conversationId: CONV_A }));
    await waitFor(() => expect(screen.getByText(/Alerta da conversa A/)).toBeTruthy());
    expect(screen.queryByText(/Alerta da conversa B/)).toBeNull();
  });

  it('Notas consulta a CONVERSA (não mine=true) e mostra apenas as notas dela', async () => {
    mocks.noteList.mockResolvedValue([noteA]);
    render(
      <MemoryRouter initialEntries={[`/notes?conversationId=${CONV_A}`]}>
        <Notes />
      </MemoryRouter>,
    );
    await waitFor(() => expect(mocks.noteList).toHaveBeenCalledWith({ conversationId: CONV_A, limit: 100 }));
    expect(mocks.apiGet).not.toHaveBeenCalledWith('/notes?mine=true');
    await waitFor(() => expect(screen.getByText('Nota da conversa A')).toBeTruthy());
    expect(screen.queryByText('Nota da conversa B')).toBeNull();
  });

  it('Notas sem contexto mantém a consulta explícita de minhas notas', async () => {
    mocks.apiGet.mockImplementation((url: string) => {
      if (url === '/notes?mine=true') return Promise.resolve([noteA]);
      return Promise.resolve([]);
    });
    render(
      <MemoryRouter initialEntries={['/notes']}>
        <Notes />
      </MemoryRouter>,
    );
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledWith('/notes?mine=true'));
    expect(mocks.noteList).not.toHaveBeenCalled();
  });
});
