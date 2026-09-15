import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Tasks } from '../pages/Tasks';
import { Alerts } from '../pages/Alerts';
import { Sectors } from '../pages/Sectors';
import { Labels } from '../pages/Labels';
import { ContactGroups } from '../pages/ContactGroups';
import { Kanban } from '../pages/Kanban';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  taskList: vi.fn(),
  taskCreate: vi.fn(),
  taskUpdateStatus: vi.fn(),
  alertList: vi.fn(),
  alertAck: vi.fn(),
  alertResolve: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: {
    get: mocks.apiGet,
    post: mocks.apiPost,
    patch: mocks.apiPatch,
    put: mocks.apiPut,
    delete: mocks.apiDelete,
    upload: vi.fn(),
  },
  taskApi: {
    list: mocks.taskList,
    create: mocks.taskCreate,
    updateStatus: mocks.taskUpdateStatus,
    get: vi.fn(),
  },
  alertApi: {
    list: mocks.alertList,
    acknowledge: mocks.alertAck,
    resolve: mocks.alertResolve,
    get: vi.fn(),
  },
}));

vi.mock('../store/auth', () => ({
  useAuthStore: () => ({ user: { id: 'user_1', name: 'Ana Souza', email: 'ana@cvg.test', roles: ['admin'] } }),
}));

function apiError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const taskBase = {
  conversationId: null,
  description: null,
  assignedTo: null,
  createdBy: null,
  completedAt: null,
  createdAt: '2026-09-12T09:00:00.000Z',
  updatedAt: '2026-09-12T09:00:00.000Z',
};

const tasks = [
  { ...taskBase, id: 'task_1', title: 'Confirmar retorno', status: 'pending', priority: 'urgent', dueAt: '2026-09-20T10:00:00.000Z' },
  { ...taskBase, id: 'task_2', title: 'Emitir receita', status: 'in_progress', priority: 'medium', dueAt: null },
  { ...taskBase, id: 'task_3', title: 'Arquivar prontuário', status: 'completed', priority: 'low', dueAt: null },
];

const alerts = [
  { id: 'alert_1', conversationId: null, taskId: null, type: 'sla', title: 'SLA estourado', message: 'Atendimento aguardando há 40min', severity: 'critical', status: 'active', triggeredBy: null, acknowledgedBy: null, acknowledgedAt: null, resolvedBy: null, resolvedAt: null, createdAt: '2026-09-12T09:00:00.000Z', updatedAt: '2026-09-12T09:00:00.000Z' },
  { id: 'alert_2', conversationId: null, taskId: null, type: 'system', title: 'Fila elevada', message: null, severity: 'warning', status: 'acknowledged', triggeredBy: null, acknowledgedBy: 'user_1', acknowledgedAt: '2026-09-12T09:30:00.000Z', resolvedBy: null, resolvedAt: null, createdAt: '2026-09-12T08:00:00.000Z', updatedAt: '2026-09-12T09:30:00.000Z' },
  { id: 'alert_3', conversationId: null, taskId: null, type: 'system', title: 'Integração normalizada', message: null, severity: 'info', status: 'resolved', triggeredBy: null, acknowledgedBy: null, acknowledgedAt: null, resolvedBy: 'user_1', resolvedAt: '2026-09-12T08:30:00.000Z', createdAt: '2026-09-12T07:00:00.000Z', updatedAt: '2026-09-12T08:30:00.000Z' },
];

const sectors = [
  { id: 'sector_1', name: 'Recepção', code: 'recepcao', description: 'Primeiro atendimento', color: '#0284c7', icon: '📋', isActive: true, autoAssign: true, maxConcurrent: 5 },
  { id: 'sector_2', name: 'Clínica', code: 'clinica', description: null, color: '#0f766e', icon: '🏥', isActive: false, autoAssign: false, maxConcurrent: 0 },
];

const labels = [
  { id: 'label_1', name: 'Retorno', color: '#0284c7', description: 'Retornos agendados', category: 'Fluxo', isSystem: false },
  { id: 'label_2', name: 'Urgente', color: '#b42334', description: null, category: null, isSystem: true },
];

const groups = [
  { id: 'group_1', name: 'Equipe Clínica', description: null, groupType: 'internal', color: '#0284c7', icon: '👥', memberCount: 2 },
  { id: 'group_2', name: 'Tutores VIP', description: null, groupType: 'external', color: '#0f766e', icon: '⭐', memberCount: 1 },
];

const membersByGroup: Record<string, Array<{ id: string; contactId: string; contactName: string; contactPhone: string }>> = {
  group_1: [
    { id: 'member_1', contactId: 'contact_1', contactName: 'Marina Souza', contactPhone: '11999990001' },
    { id: 'member_2', contactId: 'contact_2', contactName: 'João Pereira', contactPhone: '11999990002' },
  ],
  group_2: [
    { id: 'member_3', contactId: 'contact_3', contactName: 'Carla Dias', contactPhone: '11999990003' },
  ],
};

const kanbanBoard = {
  columns: [
    { status: 'novo', label: 'Novo', icon: '🟢', color: '#22c55e', count: 1, cards: [{ id: 'card_1', contactName: 'Ana Costa', contactPhone: null, lastMessage: 'Preciso reagendar', assignedUserName: 'Dra. Sofia Lima', sectorName: 'Suporte', sectorColor: '#22c55e', sectorIcon: '🩺', labels: [{ name: 'Urgente', color: '#ef4444' }], priority: 'high', minutesSinceUpdate: 35 }] },
    { status: 'em_atendimento', label: 'Em Atendimento', icon: '🔵', color: '#3b82f6', count: 0, cards: [] },
    { status: 'pendente', label: 'Pendente', icon: '🟡', color: '#eab308', count: 0, cards: [] },
    { status: 'em_espera', label: 'Em Espera', icon: '⏳', color: '#f97316', count: 1, cards: [{ id: 'card_2', contactName: 'Bruno Lima', contactPhone: null, lastMessage: null, assignedUserName: null, sectorName: null, sectorColor: null, sectorIcon: null, labels: [], priority: 'normal', minutesSinceUpdate: 150 }] },
    { status: 'finalizado', label: 'Finalizado', icon: '✅', color: '#6b7280', count: 0, cards: [] },
    { status: 'arquivado', label: 'Arquivado', icon: '📁', color: '#9ca3af', count: 1, cards: [{ id: 'card_3', contactName: 'Dora Melo', contactPhone: null, lastMessage: null, assignedUserName: null, sectorName: null, sectorColor: null, sectorIcon: null, labels: [], priority: 'low', minutesSinceUpdate: 5000 }] },
  ],
  filters: { sectors: [{ id: 'sector_1', name: 'Suporte', icon: '🩺', color: '#22c55e' }], labels: [] },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('AAA-30 Tasks — estados reais e feedback', () => {
  it('anuncia o carregamento com role=status', () => {
    mocks.taskList.mockImplementation(() => new Promise(() => {}));
    render(<MemoryRouter><Tasks /></MemoryRouter>);

    const loading = screen.getByText('Carregando tarefas…');
    expect(loading.closest('[role="status"]')).toBeTruthy();
  });

  it('falha 500 vira role=alert com retry real e nunca vazio falso', async () => {
    mocks.taskList
      .mockRejectedValueOnce(apiError('Falha simulada ao listar tarefas', 500))
      .mockResolvedValue(tasks);

    render(<MemoryRouter><Tasks /></MemoryRouter>);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao listar tarefas');
    expect(screen.queryByText('Nenhuma tarefa encontrada')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Confirmar retorno')).toBeTruthy();
    expect(mocks.taskList).toHaveBeenCalledTimes(2);
  });

  it('403 mostra acesso negado sem retry cego', async () => {
    mocks.taskList.mockRejectedValue(apiError('Sem permissão', 403));

    render(<MemoryRouter><Tasks /></MemoryRouter>);

    expect(await screen.findByText('Acesso negado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
    expect(screen.queryByText('Nenhuma tarefa encontrada')).toBeNull();
  });

  it('lista vazia real usa EmptyState com ação', async () => {
    mocks.taskList.mockResolvedValue([]);

    render(<MemoryRouter><Tasks /></MemoryRouter>);

    expect(await screen.findByText('Nenhuma tarefa encontrada')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('filtro tem estado pressionado, vazio filtrado distinto e estatísticas reais do conjunto', async () => {
    mocks.taskList.mockResolvedValue(tasks);
    render(<MemoryRouter><Tasks /></MemoryRouter>);
    await screen.findByText('Confirmar retorno');

    const statusGroup = screen.getByRole('group', { name: 'Filtrar tarefas por status' });
    const allChip = within(statusGroup).getByRole('button', { name: 'Todas' });
    const completedChip = within(statusGroup).getByRole('button', { name: 'Concluída' });
    expect(allChip.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(completedChip);
    expect(completedChip.getAttribute('aria-pressed')).toBe('true');
    expect(await screen.findByText('Arquivar prontuário')).toBeTruthy();
    expect(screen.queryByText('Confirmar retorno')).toBeNull();

    const totalCard = screen.getByText('Total').closest('.stat-card');
    expect(totalCard?.textContent).toContain('3');

    fireEvent.click(screen.getByRole('button', { name: 'Urgente' }));
    expect(await screen.findByText('Nenhuma tarefa com estes filtros')).toBeTruthy();
    expect(screen.queryByText('Nenhuma tarefa encontrada')).toBeNull();
  });

  it('validação exige título e foca o campo sem chamar a API', async () => {
    mocks.taskList.mockResolvedValue(tasks);
    render(<MemoryRouter><Tasks /></MemoryRouter>);
    await screen.findByText('Confirmar retorno');

    fireEvent.click(screen.getByRole('button', { name: 'Nova tarefa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));

    const title = screen.getByLabelText('Título *');
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(title);
    expect(mocks.taskCreate).not.toHaveBeenCalled();
  });

  it('falha ao criar anuncia no formulário e preserva os dados digitados', async () => {
    mocks.taskList.mockResolvedValue(tasks);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mocks.taskCreate.mockRejectedValue(apiError('Falha simulada ao criar tarefa', 500));

    render(<MemoryRouter><Tasks /></MemoryRouter>);
    await screen.findByText('Confirmar retorno');
    fireEvent.click(screen.getByRole('button', { name: 'Nova tarefa' }));
    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Tarefa que não pode se perder' } });
    fireEvent.change(screen.getByLabelText('Descrição (opcional)'), { target: { value: 'Detalhe importante' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao criar tarefa');
    expect((screen.getByLabelText('Título *') as HTMLInputElement).value).toBe('Tarefa que não pode se perder');
    expect((screen.getByLabelText('Descrição (opcional)') as HTMLTextAreaElement).value).toBe('Detalhe importante');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('criação bem-sucedida anuncia status, fecha o formulário e recarrega', async () => {
    mocks.taskList.mockResolvedValue(tasks);
    mocks.taskCreate.mockResolvedValue({ ...tasks[0], id: 'task_new' });

    render(<MemoryRouter><Tasks /></MemoryRouter>);
    await screen.findByText('Confirmar retorno');
    fireEvent.click(screen.getByRole('button', { name: 'Nova tarefa' }));
    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Nova tarefa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));

    const feedback = await screen.findByText('Tarefa criada.');
    expect(feedback.closest('[role="status"]')).toBeTruthy();
    expect(screen.queryByLabelText('Título *')).toBeNull();
    await waitFor(() => expect(mocks.taskList).toHaveBeenCalledTimes(2));
  });

  it('falha na transição usa role=alert e mantém o card no status anterior', async () => {
    mocks.taskList.mockResolvedValue(tasks);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mocks.taskUpdateStatus.mockRejectedValue(apiError('Falha simulada ao atualizar a tarefa', 500));

    render(<MemoryRouter><Tasks /></MemoryRouter>);
    await screen.findByText('Confirmar retorno');
    fireEvent.click(screen.getAllByRole('button', { name: 'Iniciar' })[0]);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao atualizar a tarefa');
    expect(screen.getByText('Confirmar retorno')).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('transição bem-sucedida anuncia status e atualiza pelo endpoint real', async () => {
    mocks.taskList.mockResolvedValue(tasks);
    mocks.taskUpdateStatus.mockResolvedValue({ ...tasks[0], status: 'in_progress' });

    render(<MemoryRouter><Tasks /></MemoryRouter>);
    await screen.findByText('Confirmar retorno');
    fireEvent.click(screen.getAllByRole('button', { name: 'Iniciar' })[0]);

    const feedback = await screen.findByText(/movida para Em andamento/);
    expect(feedback.closest('[role="status"]')).toBeTruthy();
    expect(mocks.taskUpdateStatus).toHaveBeenCalledWith('task_1', expect.objectContaining({
      status: 'in_progress',
      expectedStatus: 'pending',
    }));
  });
});

describe('AAA-30 Alerts — estados reais e feedback', () => {
  it('anuncia o carregamento com role=status', () => {
    mocks.alertList.mockImplementation(() => new Promise(() => {}));
    render(<MemoryRouter><Alerts /></MemoryRouter>);

    const loading = screen.getByText('Carregando alertas…');
    expect(loading.closest('[role="status"]')).toBeTruthy();
  });

  it('falha 500 vira role=alert com retry e nunca vazio falso', async () => {
    mocks.alertList
      .mockRejectedValueOnce(apiError('Falha simulada ao listar alertas', 500))
      .mockResolvedValue(alerts);

    render(<MemoryRouter><Alerts /></MemoryRouter>);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao listar alertas');
    expect(screen.queryByText('Nenhum alerta encontrado')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('SLA estourado')).toBeTruthy();
  });

  it('403 mostra acesso negado sem retry', async () => {
    mocks.alertList.mockRejectedValue(apiError('Sem permissão', 403));

    render(<MemoryRouter><Alerts /></MemoryRouter>);

    expect(await screen.findByText('Acesso negado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
  });

  it('lista vazia real usa EmptyState, sem alerta', async () => {
    mocks.alertList.mockResolvedValue([]);

    render(<MemoryRouter><Alerts /></MemoryRouter>);

    expect(await screen.findByText('Nenhum alerta encontrado')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falha ao reconhecer usa role=alert e nunca window.alert', async () => {
    mocks.alertList.mockResolvedValue(alerts);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mocks.alertAck.mockRejectedValue(apiError('Falha simulada ao reconhecer alerta', 500));

    render(<MemoryRouter><Alerts /></MemoryRouter>);
    await screen.findByText('SLA estourado');
    fireEvent.click(screen.getAllByRole('button', { name: 'Reconhecer' })[0]);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao reconhecer alerta');
    expect(screen.getByText('SLA estourado')).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('reconhecimento bem-sucedido anuncia status e recarrega', async () => {
    mocks.alertList.mockResolvedValue(alerts);
    mocks.alertAck.mockResolvedValue({ ...alerts[0], status: 'acknowledged' });

    render(<MemoryRouter><Alerts /></MemoryRouter>);
    await screen.findByText('SLA estourado');
    fireEvent.click(screen.getAllByRole('button', { name: 'Reconhecer' })[0]);

    const feedback = await screen.findByText(/reconhecido/);
    expect(feedback.closest('[role="status"]')).toBeTruthy();
    expect(mocks.alertAck).toHaveBeenCalledWith('alert_1', 'user_1');
    await waitFor(() => expect(mocks.alertList).toHaveBeenCalledTimes(2));
  });

  it('filtro tem estado pressionado e vazio filtrado é distinto do vazio real', async () => {
    mocks.alertList.mockResolvedValue(alerts);
    render(<MemoryRouter><Alerts /></MemoryRouter>);
    await screen.findByText('SLA estourado');

    const allChip = screen.getByRole('button', { name: 'Todos' });
    const severityChip = screen.getByRole('button', { name: 'Crítico' });
    expect(allChip.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(severityChip);
    expect(severityChip.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('SLA estourado')).toBeTruthy();
    expect(screen.queryByText('Integração normalizada')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Erro' }));
    expect(await screen.findByText('Nenhum alerta com estes filtros')).toBeTruthy();
    expect(screen.queryByText('Nenhum alerta encontrado')).toBeNull();
  });
});

describe('AAA-30 Sectors — estados reais e feedback', () => {
  it('anuncia o carregamento com role=status', () => {
    mocks.apiGet.mockImplementation(() => new Promise(() => {}));
    render(<Sectors />);

    const loading = screen.getByText('Carregando setores…');
    expect(loading.closest('[role="status"]')).toBeTruthy();
  });

  it('falha 500 vira role=alert com retry e nunca vazio falso', async () => {
    mocks.apiGet
      .mockRejectedValueOnce(apiError('Falha simulada ao listar setores', 500))
      .mockResolvedValue(sectors);

    render(<Sectors />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao listar setores');
    expect(screen.queryByText('Nenhum setor cadastrado')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Recepção')).toBeTruthy();
  });

  it('403 mostra acesso negado sem retry', async () => {
    mocks.apiGet.mockRejectedValue(apiError('Sem permissão', 403));
    render(<Sectors />);

    expect(await screen.findByText('Acesso negado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
  });

  it('lista vazia real usa EmptyState', async () => {
    mocks.apiGet.mockResolvedValue([]);
    render(<Sectors />);

    expect(await screen.findByText('Nenhum setor cadastrado')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('validação exige nome e código, foca o primeiro inválido e não chama a API', async () => {
    mocks.apiGet.mockResolvedValue(sectors);
    render(<Sectors />);
    await screen.findByText('Recepção');

    fireEvent.click(screen.getByRole('button', { name: 'Novo setor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Criar Setor' }));

    const name = screen.getByLabelText('Nome *');
    const code = screen.getByLabelText('Código *');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(code.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name);
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it('falha ao criar anuncia e preserva os dados digitados', async () => {
    mocks.apiGet.mockResolvedValue(sectors);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mocks.apiPost.mockRejectedValue(apiError('Falha simulada ao criar setor', 500));

    render(<Sectors />);
    await screen.findByText('Recepção');
    fireEvent.click(screen.getByRole('button', { name: 'Novo setor' }));
    fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Cirurgia' } });
    fireEvent.change(screen.getByLabelText('Código *'), { target: { value: 'cirurgia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar Setor' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao criar setor');
    expect((screen.getByLabelText('Nome *') as HTMLInputElement).value).toBe('Cirurgia');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('criação bem-sucedida anuncia status e recarrega', async () => {
    mocks.apiGet.mockResolvedValue(sectors);
    mocks.apiPost.mockResolvedValue({ ...sectors[0], id: 'sector_new' });

    render(<Sectors />);
    await screen.findByText('Recepção');
    fireEvent.click(screen.getByRole('button', { name: 'Novo setor' }));
    fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Cirurgia' } });
    fireEvent.change(screen.getByLabelText('Código *'), { target: { value: 'cirurgia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar Setor' }));

    const feedback = await screen.findByText('Setor criado.');
    expect(feedback.closest('[role="status"]')).toBeTruthy();
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledTimes(2));
  });

  it('falha ao alternar status usa role=alert sem perder a lista', async () => {
    mocks.apiGet.mockResolvedValue(sectors);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mocks.apiPut.mockRejectedValue(apiError('Falha simulada ao atualizar setor', 500));

    render(<Sectors />);
    await screen.findByText('Recepção');
    fireEvent.click(screen.getByRole('button', { name: 'Desativar setor Recepção' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao atualizar setor');
    expect(screen.getByText('Recepção')).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('alternância bem-sucedida anuncia status', async () => {
    mocks.apiGet.mockResolvedValue(sectors);
    mocks.apiPut.mockResolvedValue({ ...sectors[0], isActive: false });

    render(<Sectors />);
    await screen.findByText('Recepção');
    fireEvent.click(screen.getByRole('button', { name: 'Desativar setor Recepção' }));

    const feedback = await screen.findByText(/desativado/);
    expect(feedback.closest('[role="status"]')).toBeTruthy();
    expect(mocks.apiPut).toHaveBeenCalledWith('/sectors/sector_1', { isActive: false });
  });

  it('seletor de ícone tem aria-pressed e o valor persistido é o exibido', async () => {
    mocks.apiGet.mockResolvedValue(sectors);
    render(<Sectors />);
    await screen.findByText('Recepção');
    fireEvent.click(screen.getByRole('button', { name: 'Novo setor' }));

    const clinic = screen.getByRole('button', { name: 'Ícone Clínica' });
    expect(clinic.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(clinic);
    expect(clinic.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('AAA-30 Labels — estados reais e feedback', () => {
  it('anuncia o carregamento com role=status', () => {
    mocks.apiGet.mockImplementation(() => new Promise(() => {}));
    render(<Labels />);

    const loading = screen.getByText('Carregando labels…');
    expect(loading.closest('[role="status"]')).toBeTruthy();
  });

  it('falha 500 vira role=alert com retry', async () => {
    mocks.apiGet
      .mockRejectedValueOnce(apiError('Falha simulada ao listar labels', 500))
      .mockResolvedValue(labels);

    render(<Labels />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao listar labels');
    expect(screen.queryByText('Nenhuma label cadastrada')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Retorno')).toBeTruthy();
  });

  it('403 mostra acesso negado sem retry', async () => {
    mocks.apiGet.mockRejectedValue(apiError('Sem permissão', 403));
    render(<Labels />);

    expect(await screen.findByText('Acesso negado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
  });

  it('lista vazia real usa EmptyState', async () => {
    mocks.apiGet.mockResolvedValue([]);
    render(<Labels />);

    expect(await screen.findByText('Nenhuma label cadastrada')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('labels de sistema não oferecem edição nem exclusão', async () => {
    mocks.apiGet.mockResolvedValue(labels);
    render(<Labels />);
    await screen.findByText('Retorno');

    expect(screen.getByText('Sistema')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Excluir label Urgente' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar label Urgente' })).toBeNull();
  });

  it('validação exige nome e foca o campo sem chamar a API', async () => {
    mocks.apiGet.mockResolvedValue(labels);
    render(<Labels />);
    await screen.findByText('Retorno');
    fireEvent.click(screen.getByRole('button', { name: 'Nova label' }));
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));

    const name = screen.getByLabelText('Nome *');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name);
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it('falha ao criar preserva os dados e anuncia com role=alert', async () => {
    mocks.apiGet.mockResolvedValue(labels);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mocks.apiPost.mockRejectedValue(apiError('Falha simulada ao criar label', 500));

    render(<Labels />);
    await screen.findByText('Retorno');
    fireEvent.click(screen.getByRole('button', { name: 'Nova label' }));
    fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Cirurgia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao criar label');
    expect((screen.getByLabelText('Nome *') as HTMLInputElement).value).toBe('Cirurgia');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('exclusão usa diálogo próprio (sem window.confirm) e cancelar não chama a API', async () => {
    mocks.apiGet.mockResolvedValue(labels);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<Labels />);
    await screen.findByText('Retorno');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir label Retorno' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Excluir label');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.apiDelete).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('exclusão confirmada anuncia status e recarrega', async () => {
    mocks.apiGet.mockResolvedValue(labels);
    mocks.apiDelete.mockResolvedValue({ deleted: true });

    render(<Labels />);
    await screen.findByText('Retorno');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir label Retorno' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));

    const feedback = await screen.findByText(/excluída/);
    expect(feedback.closest('[role="status"]')).toBeTruthy();
    expect(mocks.apiDelete).toHaveBeenCalledWith('/labels/label_1');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('falha ao excluir anuncia dentro do diálogo, que permanece aberto', async () => {
    mocks.apiGet.mockResolvedValue(labels);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mocks.apiDelete.mockRejectedValue(apiError('Falha simulada ao excluir label', 500));

    render(<Labels />);
    await screen.findByText('Retorno');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir label Retorno' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));

    const dialog = screen.getByRole('dialog');
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao excluir label');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('edição valida nome e preserva o modo de edição em caso de falha', async () => {
    mocks.apiGet.mockResolvedValue(labels);
    mocks.apiPut.mockRejectedValue(apiError('Falha simulada ao atualizar label', 500));

    render(<Labels />);
    await screen.findByText('Retorno');
    fireEvent.click(screen.getByRole('button', { name: 'Editar label Retorno' }));

    const name = screen.getByLabelText('Nome *');
    fireEvent.change(name, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name);
    expect(mocks.apiPut).not.toHaveBeenCalled();

    fireEvent.change(name, { target: { value: 'Retorno rápido' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao atualizar label');
    expect((screen.getByLabelText('Nome *') as HTMLInputElement).value).toBe('Retorno rápido');
  });
});

describe('AAA-30 ContactGroups — estados reais e feedback', () => {
  it('anuncia o carregamento com role=status', () => {
    mocks.apiGet.mockImplementation(() => new Promise(() => {}));
    render(<ContactGroups />);

    const loading = screen.getByText('Carregando grupos…');
    expect(loading.closest('[role="status"]')).toBeTruthy();
  });

  it('falha 500 vira role=alert com retry', async () => {
    mocks.apiGet
      .mockRejectedValueOnce(apiError('Falha simulada ao listar grupos', 500))
      .mockResolvedValue(groups);

    render(<ContactGroups />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao listar grupos');
    expect(screen.queryByText('Nenhum grupo criado')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Equipe Clínica')).toBeTruthy();
  });

  it('403 mostra acesso negado sem retry', async () => {
    mocks.apiGet.mockRejectedValue(apiError('Sem permissão', 403));
    render(<ContactGroups />);

    expect(await screen.findByText('Acesso negado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
  });

  it('lista vazia real usa EmptyState', async () => {
    mocks.apiGet.mockResolvedValue([]);
    render(<ContactGroups />);

    expect(await screen.findByText('Nenhum grupo criado')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('membros têm carregamento anunciado e erro real com retry', async () => {
    const firstMembers = deferred<typeof membersByGroup.group_1>();
    let memberCalls = 0;
    mocks.apiGet.mockImplementation((endpoint: string) => {
      if (endpoint === '/contact-groups') return Promise.resolve(groups);
      if (endpoint === '/contact-groups/group_1/members') {
        memberCalls += 1;
        return memberCalls === 1
          ? firstMembers.promise
          : Promise.resolve(membersByGroup.group_1);
      }
      return Promise.resolve([]);
    });

    render(<ContactGroups />);
    await screen.findByText('Equipe Clínica');
    fireEvent.click(screen.getByRole('button', { name: /^Equipe Clínica/ }));

    const loading = screen.getByText('Carregando membros…');
    expect(loading.closest('[role="status"]')).toBeTruthy();

    await act(async () => { firstMembers.reject(apiError('Falha simulada ao carregar membros', 500)); });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao carregar membros');
    expect(screen.queryByText('Nenhum membro neste grupo')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Marina Souza')).toBeTruthy();
  });

  it('grupo sem membros usa vazio real distinto de erro', async () => {
    mocks.apiGet.mockImplementation((endpoint: string) => {
      if (endpoint === '/contact-groups') return Promise.resolve(groups);
      return Promise.resolve([]);
    });

    render(<ContactGroups />);
    await screen.findByText('Equipe Clínica');
    fireEvent.click(screen.getByRole('button', { name: /^Equipe Clínica/ }));

    expect(await screen.findByText('Nenhum membro neste grupo')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('seleção antiga não sobrescreve a atual (guarda de corrida)', async () => {
    const first = deferred<typeof membersByGroup.group_1>();
    const second = deferred<typeof membersByGroup.group_2>();
    mocks.apiGet.mockImplementation((endpoint: string) => {
      if (endpoint === '/contact-groups') return Promise.resolve(groups);
      if (endpoint === '/contact-groups/group_1/members') return first.promise;
      if (endpoint === '/contact-groups/group_2/members') return second.promise;
      return Promise.resolve([]);
    });

    render(<ContactGroups />);
    await screen.findByText('Equipe Clínica');
    fireEvent.click(screen.getByRole('button', { name: /^Equipe Clínica/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Tutores VIP/ }));

    await act(async () => { second.resolve(membersByGroup.group_2); });
    expect(await screen.findByText('Carla Dias')).toBeTruthy();

    await act(async () => { first.resolve(membersByGroup.group_1); });
    await waitFor(() => expect(screen.queryByText('Marina Souza')).toBeNull());
    expect(screen.getByText('Carla Dias')).toBeTruthy();
  });

  it('validação exige nome e foca o campo sem chamar a API', async () => {
    mocks.apiGet.mockResolvedValue(groups);
    render(<ContactGroups />);
    await screen.findByText('Equipe Clínica');
    fireEvent.click(screen.getByRole('button', { name: 'Novo grupo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));

    const name = screen.getByLabelText('Nome *');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name);
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it('falha ao criar preserva os dados e anuncia com role=alert', async () => {
    mocks.apiGet.mockResolvedValue(groups);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mocks.apiPost.mockRejectedValue(apiError('Falha simulada ao criar grupo', 500));

    render(<ContactGroups />);
    await screen.findByText('Equipe Clínica');
    fireEvent.click(screen.getByRole('button', { name: 'Novo grupo' }));
    fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Plantão noturno' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao criar grupo');
    expect((screen.getByLabelText('Nome *') as HTMLInputElement).value).toBe('Plantão noturno');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('exclusão confirmada anuncia status; diálogo próprio substitui confirm nativo', async () => {
    mocks.apiGet.mockResolvedValue(groups);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.apiDelete.mockResolvedValue({ deleted: true });

    render(<ContactGroups />);
    await screen.findByText('Equipe Clínica');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir grupo Equipe Clínica' }));

    const dialog = screen.getByRole('dialog');
    expect(confirmSpy).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));

    const feedback = await screen.findByText(/excluído/);
    expect(feedback.closest('[role="status"]')).toBeTruthy();
    expect(mocks.apiDelete).toHaveBeenCalledWith('/contact-groups/group_1');
  });
});

describe('AAA-30 Kanban — estados reais e feedback', () => {
  it('anuncia o carregamento com role=status', () => {
    mocks.apiGet.mockImplementation(() => new Promise(() => {}));
    render(<Kanban />);

    const loading = screen.getByText('Carregando Kanban…');
    expect(loading.closest('[role="status"]')).toBeTruthy();
  });

  it('falha 500 vira role=alert com retry', async () => {
    mocks.apiGet
      .mockRejectedValueOnce(apiError('Falha simulada ao carregar Kanban', 500))
      .mockResolvedValue(kanbanBoard);

    render(<Kanban />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao carregar Kanban');

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Ana Costa')).toBeTruthy();
  });

  it('403 mostra acesso negado sem retry', async () => {
    mocks.apiGet.mockRejectedValue(apiError('Sem permissão', 403));
    render(<Kanban />);

    expect(await screen.findByText('Acesso negado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
  });

  it('board vazio real usa EmptyState', async () => {
    mocks.apiGet.mockResolvedValue({
      columns: kanbanBoard.columns.map(column => ({ ...column, count: 0, cards: [] })),
      filters: kanbanBoard.filters,
    });

    render(<Kanban />);

    expect(await screen.findByText('Nenhum atendimento no Kanban')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renderiza todos os status reais, inclusive arquivado', async () => {
    mocks.apiGet.mockResolvedValue(kanbanBoard);
    render(<Kanban />);

    expect(await screen.findByText('Ana Costa')).toBeTruthy();
    for (const label of ['Novo', 'Em Atendimento', 'Pendente', 'Em Espera', 'Finalizado', 'Arquivado']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('Dora Melo')).toBeTruthy();
  });

  it('movimento por teclado/toque anuncia status e usa o endpoint real', async () => {
    mocks.apiGet.mockResolvedValue(kanbanBoard);
    mocks.apiPatch.mockResolvedValue({ success: true });

    render(<Kanban />);
    await screen.findByText('Ana Costa');
    const select = screen.getByLabelText('Mover atendimento de Ana Costa para outro status');
    fireEvent.change(select, { target: { value: 'em_atendimento' } });

    expect(mocks.apiPatch).toHaveBeenCalledWith('/kanban/card/card_1/move', { status: 'em_atendimento' });
    const feedback = await screen.findByText(/movido para Em Atendimento/);
    expect(feedback.closest('[role="status"]')).toBeTruthy();
  });

  it('falha ao mover anuncia role=alert, mantém o card e permite retry', async () => {
    mocks.apiGet.mockResolvedValue(kanbanBoard);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mocks.apiPatch
      .mockRejectedValueOnce(apiError('Falha simulada ao mover card', 500))
      .mockResolvedValue({ success: true });

    render(<Kanban />);
    await screen.findByText('Ana Costa');
    const select = screen.getByLabelText('Mover atendimento de Ana Costa para outro status');
    fireEvent.change(select, { target: { value: 'em_atendimento' } });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao mover card');
    expect(screen.getByText('Ana Costa')).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(mocks.apiPatch).toHaveBeenCalledTimes(2));
  });
});
