import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Alerts } from '../pages/Alerts';
import { Audit } from '../pages/Audit';
import { ContactGroups } from '../pages/ContactGroups';
import { Contacts } from '../pages/Contacts';
import { Dashboard } from '../pages/Dashboard';
import { Labels } from '../pages/Labels';
import { Notes } from '../pages/Notes';
import { Sectors } from '../pages/Sectors';
import { Settings } from '../pages/Settings';
import { Tasks } from '../pages/Tasks';

const mocks = vi.hoisted(() => ({
  authStore: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  alertList: vi.fn(),
  alertAcknowledge: vi.fn(),
  alertResolve: vi.fn(),
  dashboardSummary: vi.fn(),
  taskList: vi.fn(),
  taskCreate: vi.fn(),
  taskUpdateStatus: vi.fn(),
}));

vi.mock('../store/auth', () => ({
  useAuthStore: () => mocks.authStore(),
}));

vi.mock('../lib/api', () => ({
  getErrorMessage: (error: unknown, fallback = 'Erro inesperado') =>
    error instanceof Error && error.message ? error.message : fallback,
  api: {
    get: mocks.apiGet,
    post: mocks.apiPost,
    put: mocks.apiPut,
    delete: mocks.apiDelete,
  },
  alertApi: {
    list: mocks.alertList,
    acknowledge: mocks.alertAcknowledge,
    resolve: mocks.alertResolve,
  },
  dashboardApi: {
    getSummary: mocks.dashboardSummary,
  },
  taskApi: {
    list: mocks.taskList,
    create: mocks.taskCreate,
    updateStatus: mocks.taskUpdateStatus,
  },
}));

function renderPage(page: React.ReactNode) {
  return render(
    <MemoryRouter>
      {page}
    </MemoryRouter>
  );
}

const createdAt = '2026-04-28T12:00:00.000Z';

describe('operational pages smoke coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStore.mockReturnValue({
      user: { id: 'user-1', name: 'Agente CVG', email: 'agente@example.test', roles: ['Agent'] },
    });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders alerts and executes acknowledge, resolve and filters', async () => {
    mocks.alertList.mockResolvedValue([
      {
        id: 'alert-1',
        conversationId: null,
        taskId: null,
        type: 'sla',
        title: 'SLA critico',
        message: 'Atendimento parado',
        severity: 'critical',
        status: 'active',
        triggeredBy: null,
        acknowledgedBy: null,
        acknowledgedAt: null,
        resolvedBy: null,
        resolvedAt: null,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: 'alert-2',
        conversationId: null,
        taskId: null,
        type: 'operational',
        title: 'Aguardando retorno',
        message: null,
        severity: 'warning',
        status: 'acknowledged',
        triggeredBy: null,
        acknowledgedBy: 'user-1',
        acknowledgedAt: createdAt,
        resolvedBy: null,
        resolvedAt: null,
        createdAt,
        updatedAt: createdAt,
      },
    ]);
    mocks.alertAcknowledge.mockResolvedValue({});
    mocks.alertResolve.mockResolvedValue({});

    renderPage(<Alerts />);

    expect(await screen.findByText('SLA critico')).toBeTruthy();
    fireEvent.click(screen.getByText('Reconhecer', { exact: false }));
    fireEvent.click(screen.getAllByText('Resolver', { exact: false })[0]);
    fireEvent.click(screen.getAllByText('Ativos')[1]);
    fireEvent.click(screen.getByText('Crítico'));

    await waitFor(() => {
      expect(mocks.alertAcknowledge).toHaveBeenCalledWith('alert-1', 'user-1');
      expect(mocks.alertResolve).toHaveBeenCalled();
      expect(mocks.alertList).toHaveBeenCalledWith({ status: 'active', severity: 'critical' });
    });
  });

  it('renders audit logs and refetches with filters', async () => {
    mocks.apiGet.mockResolvedValue([
      {
        id: 'audit-1',
        actorType: 'user',
        actorUserId: '123456789',
        action: 'task.created',
        entityType: 'task',
        entityId: 'entity-123456789',
        contextJson: JSON.stringify({ title: 'Retorno', priority: 'high', extra: true }),
        createdAt,
      },
      {
        id: 'audit-2',
        actorType: 'system',
        actorUserId: null,
        action: 'message.deleted',
        entityType: 'message',
        entityId: 'message-123456',
        contextJson: 'raw-context',
        createdAt,
      },
    ]);

    renderPage(<Audit />);

    expect(await screen.findByText('task.created')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Filtrar por ação (ex: task.created)'), { target: { value: 'task.created' } });
    fireEvent.change(screen.getByPlaceholderText('Filtrar por entidade (ex: conversation)'), { target: { value: 'task' } });
    fireEvent.click(screen.getByText('Filtrar'));

    await waitFor(() => {
      expect(mocks.apiGet).toHaveBeenLastCalledWith('/audit/logs?action=task.created&entityType=task');
    });
    expect(screen.getByText(/title: Retorno/)).toBeTruthy();
    expect(screen.getByText('raw-context')).toBeTruthy();
  });

  it('renders contact groups, creates a group, opens members and deletes', async () => {
    mocks.apiGet.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/contact-groups') {
        return [{ id: 'group-1', name: 'Tutores VIP', description: 'Prioritarios', groupType: 'custom', color: '#2563eb', icon: '👥', memberCount: 1 }];
      }
      if (endpoint === '/contact-groups/group-1/members') {
        return [{ id: 'member-1', contactId: 'contact-1', contactName: 'Maria Silva', contactPhone: '5511999999999' }];
      }
      return [];
    });
    mocks.apiPost.mockResolvedValue({});
    mocks.apiDelete.mockResolvedValue({});

    renderPage(<ContactGroups />);

    expect(await screen.findByText('Tutores VIP')).toBeTruthy();
    fireEvent.click(screen.getByText('Tutores VIP'));
    expect(await screen.findByText('Maria Silva')).toBeTruthy();
    fireEvent.click(screen.getByText('+ Novo Grupo'));
    fireEvent.change(screen.getByPlaceholderText('Nome do grupo'), { target: { value: 'Internos' } });
    fireEvent.change(screen.getByPlaceholderText('Descrição'), { target: { value: 'Equipe' } });
    fireEvent.click(screen.getByText('PR'));
    fireEvent.click(screen.getByText('Criar'));
    fireEvent.click(screen.getByText('DEL'));

    await waitFor(() => {
      expect(mocks.apiPost).toHaveBeenCalledWith('/contact-groups', expect.objectContaining({ name: 'Internos', icon: 'PR' }));
      expect(mocks.apiDelete).toHaveBeenCalledWith('/contact-groups/group-1');
    });
  });

  it('renders contacts, manages profile actions and creation', async () => {
    mocks.apiGet.mockImplementation(async (endpoint: string) => {
      if (endpoint.startsWith('/contacts?') || endpoint === '/contacts') {
        return [{ id: 'contact-1', name: 'Maria Silva', phone: '5511999999999', email: 'maria@example.test', createdAt }];
      }
      if (endpoint === '/contacts/contact-1') {
        return {
          id: 'contact-1',
          name: 'Maria Silva',
          phone: '5511999999999',
          email: 'maria@example.test',
          externalId: null,
          metadata: JSON.stringify({ notes: 'Preferencial' }),
          createdAt,
          conversations: [{ id: 'conversation-1', status: 'open', statusV2: 'novo', createdAt, lastMessage: 'Oi' }],
          notesCount: 1,
          tasksCount: 2,
          labels: [{ id: 'label-1', name: 'VIP', color: '#dc2626' }],
          groups: [{ id: 'group-1', name: 'Tutores', icon: '👥' }],
        };
      }
      if (endpoint.startsWith('/notes?')) {
        return [{ id: 'note-1', content: 'Observacao clinica', createdAt }];
      }
      return [];
    });
    mocks.apiPost.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/contacts') return { id: 'contact-1' };
      if (endpoint.endsWith('/start-conversation')) return { conversationId: 'conversation-1', isNew: false };
      return {};
    });
    mocks.apiPut.mockResolvedValue({});
    mocks.apiDelete.mockResolvedValue({});

    renderPage(<Contacts />);

    expect(await screen.findByText('Maria Silva')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Buscar por nome, telefone...'), { target: { value: 'maria' } });
    fireEvent.click(screen.getByText('Maria Silva'));
    expect(await screen.findByText((content) => content.includes('maria@example.test'))).toBeTruthy();
    fireEvent.click(screen.getAllByTitle('Iniciar conversa')[0]);
    fireEvent.click(screen.getByTitle('Notas'));
    expect(await screen.findByText('Observacao clinica')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Adicionar nota...'), { target: { value: 'Nova nota' } });
    fireEvent.click(screen.getByText('Adicionar'));
    fireEvent.click(screen.getByTitle('Editar'));
    fireEvent.change(screen.getByDisplayValue('Maria Silva'), { target: { value: 'Maria Atualizada' } });
    fireEvent.click(screen.getByText('Salvar'));
    fireEvent.click(screen.getByTitle('Excluir'));
    fireEvent.click(screen.getByText('＋'));
    fireEvent.change(screen.getByPlaceholderText('Nome completo'), { target: { value: 'Joao Tutor' } });
    fireEvent.change(screen.getByPlaceholderText('+55 11 99999-9999'), { target: { value: '5511888888888' } });
    fireEvent.click(screen.getByText('Criar Contato'));

    await waitFor(() => {
      expect(mocks.apiPost).toHaveBeenCalledWith('/notes', expect.objectContaining({ content: 'Nova nota' }));
      expect(mocks.apiPut).toHaveBeenCalledWith('/contacts/contact-1', expect.objectContaining({ name: 'Maria Atualizada' }));
      expect(mocks.apiDelete).toHaveBeenCalledWith('/contacts/contact-1');
      expect(mocks.apiPost).toHaveBeenCalledWith('/contacts', expect.objectContaining({ name: 'Joao Tutor' }));
    });
  });

  it('renders dashboard metrics', async () => {
    mocks.dashboardSummary.mockResolvedValue({
      conversations: { open: 3, pending: 2, closed: 4, archived: 1, total: 10 },
      tasks: { total: 8, pending: 2, inProgress: 3, completed: 2, cancelled: 1, overdue: 1 },
      alerts: { total: 5, active: 2, acknowledged: 1, resolved: 2, bySeverity: { info: 1, warning: 1, error: 1, critical: 2 } },
      generatedAt: createdAt,
    });

    renderPage(<Dashboard />);

    expect(await screen.findByText('Conversas Abertas')).toBeTruthy();
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
    expect(screen.getByText((content) => content.includes('Alertas por Severidade'))).toBeTruthy();
  });

  it('renders labels and executes create, edit and delete branches', async () => {
    mocks.apiGet.mockResolvedValue([
      { id: 'label-1', name: 'VIP', color: '#dc2626', description: 'Preferencial', category: 'triagem', isSystem: false },
      { id: 'label-2', name: 'Sistema', color: '#2563eb', description: null, category: null, isSystem: true },
    ]);
    mocks.apiPost.mockResolvedValue({});
    mocks.apiPut.mockResolvedValue({});
    mocks.apiDelete.mockResolvedValue({});

    renderPage(<Labels />);

    expect(await screen.findByText('VIP')).toBeTruthy();
    fireEvent.click(screen.getByText('+ Nova Label'));
    fireEvent.change(screen.getByPlaceholderText('Nome da label'), { target: { value: 'Retorno' } });
    fireEvent.click(screen.getByText('Criar'));
    fireEvent.click(screen.getAllByText('ED')[0]);
    fireEvent.change(screen.getByDisplayValue('VIP'), { target: { value: 'VIP Atualizado' } });
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => {
      expect(screen.getAllByText('DEL').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByText('DEL')[0]);

    await waitFor(() => {
      expect(mocks.apiPost).toHaveBeenCalledWith('/labels', expect.objectContaining({ name: 'Retorno' }));
      expect(mocks.apiPut).toHaveBeenCalledWith('/labels/label-1', expect.objectContaining({ name: 'VIP Atualizado' }));
      expect(mocks.apiDelete).toHaveBeenCalledWith('/labels/label-1');
    });
  });

  it('renders notes, filters by type and creates a note', async () => {
    mocks.apiGet.mockResolvedValue([
      { id: 'note-1', referenceType: 'conversation', referenceId: 'conversation-123456', content: 'Nota da conversa', authorUserId: 'user-123456', createdAt },
      { id: 'note-2', referenceType: 'task', referenceId: 'task-123456', content: 'Nota da tarefa', authorUserId: null, createdAt },
    ]);
    mocks.apiPost.mockResolvedValue({});

    renderPage(<Notes />);

    expect(await screen.findByText('Nota da conversa')).toBeTruthy();
    fireEvent.click(screen.getAllByText('TK Tarefa')[0]);
    expect(screen.queryByText('Nota da conversa')).toBeNull();
    fireEvent.click(screen.getByText('＋ Nova Nota'));
    fireEvent.change(screen.getByPlaceholderText('ID da referência'), { target: { value: 'conversation-1' } });
    fireEvent.change(screen.getByPlaceholderText('Escreva sua nota...'), { target: { value: 'Criada pelo teste' } });
    fireEvent.click(screen.getByText('Salvar Nota'));

    await waitFor(() => {
      expect(mocks.apiPost).toHaveBeenCalledWith('/notes', expect.objectContaining({ content: 'Criada pelo teste' }));
    });
  });

  it('renders sectors, creates a sector and toggles active state', async () => {
    mocks.apiGet.mockResolvedValue([
      { id: 'sector-1', name: 'Recepcao', code: 'recepcao', description: 'Entrada', color: '#2563eb', icon: '📞', isActive: true, autoAssign: true, maxConcurrent: 5 },
      { id: 'sector-2', name: 'Arquivo', code: 'arquivo', description: null, color: '#64748b', icon: '📋', isActive: false, autoAssign: false, maxConcurrent: 0 },
    ]);
    mocks.apiPost.mockResolvedValue({});
    mocks.apiPut.mockResolvedValue({});

    renderPage(<Sectors />);

    expect(await screen.findByText('Recepcao')).toBeTruthy();
    fireEvent.click(screen.getByText('+ Novo Setor'));
    fireEvent.change(screen.getByPlaceholderText('Nome do setor'), { target: { value: 'Clinica Geral' } });
    fireEvent.change(screen.getByPlaceholderText('Código (ex: recepcao)'), { target: { value: 'Clinica Geral' } });
    fireEvent.click(screen.getByText('AT'));
    fireEvent.click(screen.getByText('Criar Setor'));
    fireEvent.click(screen.getByText('ON'));

    await waitFor(() => {
      expect(mocks.apiPost).toHaveBeenCalledWith('/sectors', expect.objectContaining({ name: 'Clinica Geral', code: 'clinica-geral', icon: 'AT' }));
      expect(mocks.apiPut).toHaveBeenCalledWith('/sectors/sector-1', { isActive: false });
    });
  });

  it('renders settings and validates password change states', async () => {
    mocks.apiGet.mockResolvedValue({
      id: 'user-1',
      name: 'Agente CVG',
      email: 'agente@example.test',
      isActive: true,
      createdAt,
      roles: ['Agent'],
      permissions: ['chat:read'],
    });
    mocks.apiPost.mockResolvedValue({});

    renderPage(<Settings />);

    expect(await screen.findByText('Agente CVG')).toBeTruthy();
    fireEvent.click(screen.getByText('Alterar Senha'));
    fireEvent.change(screen.getByPlaceholderText('Senha atual'), { target: { value: 'atual' } });
    fireEvent.change(screen.getByPlaceholderText('Nova senha'), { target: { value: '123456' } });
    fireEvent.change(screen.getByPlaceholderText('Confirmar nova senha'), { target: { value: '654321' } });
    fireEvent.click(screen.getByText('Salvar Nova Senha'));
    expect(await screen.findByText('As senhas não coincidem.')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Senha atual'), { target: { value: 'atual' } });
    fireEvent.change(screen.getByPlaceholderText('Nova senha'), { target: { value: '123456' } });
    fireEvent.change(screen.getByPlaceholderText('Confirmar nova senha'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Salvar Nova Senha'));

    await waitFor(() => {
      expect(mocks.apiPost).toHaveBeenCalledWith('/auth/change-password', {
        currentPassword: 'atual',
        newPassword: '123456',
      });
    });
    expect(await screen.findByText('Senha alterada com sucesso!')).toBeTruthy();
  });

  it('renders tasks and executes create and status transitions', async () => {
    mocks.taskList.mockResolvedValue([
      {
        id: 'task-1',
        conversationId: null,
        title: 'Retornar tutor',
        description: 'Confirmar exame',
        status: 'pending',
        priority: 'urgent',
        assignedTo: 'user-123456',
        createdBy: 'user-1',
        dueAt: '2026-04-27T12:00:00.000Z',
        completedAt: null,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: 'task-2',
        conversationId: null,
        title: 'Enviar receita',
        description: null,
        status: 'in_progress',
        priority: 'low',
        assignedTo: null,
        createdBy: 'user-1',
        dueAt: null,
        completedAt: null,
        createdAt,
        updatedAt: createdAt,
      },
    ]);
    mocks.taskCreate.mockResolvedValue({});
    mocks.taskUpdateStatus.mockResolvedValue({});

    renderPage(<Tasks />);

    expect(await screen.findByText('Retornar tutor')).toBeTruthy();
    fireEvent.click(screen.getByText('＋ Nova Tarefa'));
    fireEvent.change(screen.getByPlaceholderText('Título da tarefa'), { target: { value: 'Nova tarefa' } });
    fireEvent.click(screen.getByText('Criar'));
    fireEvent.click(screen.getByText('▶ Iniciar'));
    fireEvent.click(screen.getByText('Concluir'));
    fireEvent.click(screen.getAllByText('Cancelar')[0]);
    fireEvent.click(screen.getByText('Pendente'));
    fireEvent.click(screen.getAllByText('Urgente')[1]);

    await waitFor(() => {
      expect(mocks.taskCreate).toHaveBeenCalledWith(expect.objectContaining({ title: 'Nova tarefa' }));
      expect(mocks.taskUpdateStatus).toHaveBeenCalledWith('task-1', { status: 'in_progress' });
      expect(mocks.taskUpdateStatus).toHaveBeenCalledWith('task-2', { status: 'completed' });
      expect(mocks.taskList).toHaveBeenCalledWith({ status: 'pending', priority: 'urgent' });
    });
  });

  it('shows fallback settings profile when auth/me fails', async () => {
    mocks.apiGet.mockRejectedValue(new Error('offline'));

    renderPage(<Settings />);

    expect(await screen.findByText('Agente CVG')).toBeTruthy();
    expect(screen.getByText('Permissões serão exibidas quando disponíveis via API')).toBeTruthy();
  });
});
