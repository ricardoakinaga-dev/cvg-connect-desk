import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Admin } from '../pages/Admin';
import { Audit } from '../pages/Audit';
import { Settings } from '../pages/Settings';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  dlList: vi.fn(),
  dlStats: vi.fn(),
  dlRetry: vi.fn(),
  dlResolve: vi.fn(),
  webhookStats: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: {
    get: mocks.apiGet,
    post: mocks.apiPost,
    patch: vi.fn(),
    put: mocks.apiPut,
    delete: mocks.apiDelete,
    upload: vi.fn(),
  },
  deadLetterApi: {
    list: mocks.dlList,
    stats: mocks.dlStats,
    retry: mocks.dlRetry,
    resolve: mocks.dlResolve,
  },
  webhookSecurityApi: {
    stats: mocks.webhookStats,
  },
}));

vi.mock('../store/auth', () => ({
  useAuthStore: () => ({
    token: 'fixture-token',
    user: { id: 'u-1', name: 'Ana Souza', email: 'ana@cvg.test', roles: ['admin'] },
    isAuthenticated: true,
  }),
}));

function apiError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

const users = [
  { id: 'user_1', name: 'Ana Souza', email: 'ana@cvg.test', isActive: true, createdAt: '2026-09-01T12:00:00.000Z' },
  { id: 'user_2', name: 'Bruno Lima', email: 'bruno@cvg.test', isActive: false, createdAt: '2026-09-02T12:00:00.000Z' },
];
const roles = [
  { id: 'role_1', name: 'Admin', description: 'Acesso total' },
  { id: 'role_2', name: 'Recepção', description: null },
];
const queues = [{ id: 'queue_1', name: 'Recepção', description: 'Fila de entrada', isActive: true }];
const teams = [{ id: 'team_1', name: 'Equipe Clínica', description: 'Veterinários', isActive: true }];
const sectors = [
  { id: 'sector_1', name: 'Clínica', code: 'CLI', icon: 'C', color: '#0284c7' },
  { id: 'sector_2', name: 'Recepção', code: 'REC', icon: 'R', color: '#0ea5e9' },
];
const userSectors = [
  { sectorId: 'sector_1', sectorName: 'Clínica', sectorIcon: 'C', sectorColor: '#0284c7', accessLevel: 'write' },
];
const deadLetter = {
  id: 'dlq_1',
  eventType: 'message.persisted',
  eventId: 'evt_1',
  payload: { messageId: 'msg_1' },
  error: 'Timeout',
  failedAt: '2026-09-12T12:00:00.000Z',
  retryCount: 2,
  handlerName: 'worker.processMessage',
  resolved: false,
  sourceEvent: {
    event_id: 'evt_1',
    event_type: 'message.persisted',
    aggregate_type: 'Message',
    aggregate_id: 'msg_1',
    occurred_at: '2026-09-11T12:00:00.000Z',
    payload: { messageId: 'msg_1' },
    version: 1,
  },
  failureContext: {
    stage: 'worker-terminal',
    decision: 'dead-letter',
    handlerName: 'worker.processMessage',
    eventType: 'message.persisted',
    eventId: 'evt_1',
    retryCount: 2,
    retryable: true,
    reason: 'Timeout',
    eventVersion: 1,
    correlationId: 'corr_1',
  },
};
const deadLetterList = { data: [deadLetter], stats: { total: 1, unresolved: 1, resolved: 0 } };
const deadLetterSummary = {
  total: 1,
  unresolved: 1,
  resolved: 0,
  replayable: 1,
  manualOnly: 0,
  byHandler: [{ handlerName: 'worker.processMessage', total: 1, unresolved: 1, resolved: 0, replayable: 1, manualOnly: 0 }],
  byReason: [{ reason: 'Timeout', total: 1, unresolved: 1, resolved: 0, replayable: 1, manualOnly: 0 }],
  lastFailedAt: '2026-09-12T12:00:00.000Z',
};
const webhookStats = {
  total: 2,
  allowed: 1,
  denied: 1,
  byReason: { missing_secret: 0, missing_signature: 1, invalid_signature_format: 0, invalid_signature: 0, signature_valid: 1 },
  lastDecisionAt: '2026-09-12T12:00:00.000Z',
  lastDecision: { reason: 'signature_valid', allowed: true, webhookMode: 'hmac', hasSecret: true, signaturePresent: true, timestamp: '2026-09-12T12:00:00.000Z' },
};
const auditLogs = [
  { id: 'audit_1', actorType: 'user', actorUserId: 'user_1abcdef', action: 'task.created', entityType: 'task', entityId: 'task_abcdef123456', contextJson: '{"status":"open"}', createdAt: '2026-09-12T12:00:00.000Z' },
  { id: 'audit_2', actorType: 'system', actorUserId: null, action: 'message.sent', entityType: 'conversation', entityId: 'conv_1234567890', contextJson: null, createdAt: '2026-09-12T11:00:00.000Z' },
];
const profile = {
  id: 'user_1',
  name: 'Ana Souza',
  email: 'ana@cvg.test',
  isActive: true,
  createdAt: '2026-09-01T12:00:00.000Z',
  roles: ['admin'],
  permissions: ['admin:read', 'admin:write'],
};

function setupAdminApi(overrides: Record<string, unknown> = {}) {
  const statuses = overrides as {
    userSectorsStatus?: number;
    rolesStatus?: number;
    emptyUsers?: boolean;
    emptyRoles?: boolean;
  };
  mocks.apiGet.mockImplementation((endpoint: string) => {
    if (overrideStatus(statuses, endpoint)) return Promise.reject(apiError('Falha simulada no admin', overrideStatus(statuses, endpoint)!));
    if (endpoint === '/admin/users') return Promise.resolve(statuses.emptyUsers ? [] : users);
    if (endpoint === '/admin/roles') return Promise.resolve(statuses.emptyRoles ? [] : roles);
    if (endpoint === '/admin/queues') return Promise.resolve(queues);
    if (endpoint === '/admin/teams') return Promise.resolve(teams);
    if (endpoint === '/sectors?all=true') return Promise.resolve(sectors);
    if (endpoint === '/admin/users/user_1/sectors') return Promise.resolve(userSectors);
    return Promise.resolve([]);
  });
  mocks.dlList.mockResolvedValue(deadLetterList);
  mocks.dlStats.mockResolvedValue(deadLetterSummary);
  mocks.webhookStats.mockResolvedValue(webhookStats);
}

function overrideStatus(overrides: { userSectorsStatus?: number; rolesStatus?: number }, endpoint: string): number | null {
  if (overrides.userSectorsStatus && endpoint === '/admin/users/user_1/sectors') return overrides.userSectorsStatus;
  if (overrides.rolesStatus && endpoint === '/admin/roles') return overrides.rolesStatus;
  return null;
}

function renderAdmin() {
  return render(<Admin />);
}

function renderAudit() {
  return render(<Audit />);
}

function renderSettings() {
  return render(<Settings />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('AAA-31 Admin — estados reais e feedback', () => {
  it('anuncia o carregamento com role=status, não com spinner anônimo', () => {
    mocks.apiGet.mockImplementation(() => new Promise(() => {}));
    mocks.dlList.mockImplementation(() => new Promise(() => {}));
    mocks.dlStats.mockImplementation(() => new Promise(() => {}));
    mocks.webhookStats.mockImplementation(() => new Promise(() => {}));

    renderAdmin();

    const loading = screen.getByText('Carregando dados administrativos…');
    expect(loading.closest('[role="status"]')).toBeTruthy();
  });

  it('falha total vira role=alert com retry real e nunca vazio falso', async () => {
    mocks.apiGet.mockRejectedValue(apiError('Falha simulada no admin', 500));
    mocks.dlList.mockRejectedValue(apiError('Falha simulada no admin', 500));
    mocks.dlStats.mockRejectedValue(apiError('Falha simulada no admin', 500));
    mocks.webhookStats.mockRejectedValue(apiError('Falha simulada no admin', 500));

    renderAdmin();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada no admin');
    expect(screen.queryByText('Nenhum usuário cadastrado')).toBeNull();

    setupAdminApi();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Ana Souza')).toBeTruthy();
  });

  it('403 mostra acesso negado sem retry cego', async () => {
    mocks.apiGet.mockRejectedValue(apiError('Sem permissão', 403));
    mocks.dlList.mockRejectedValue(apiError('Sem permissão', 403));
    mocks.dlStats.mockRejectedValue(apiError('Sem permissão', 403));
    mocks.webhookStats.mockRejectedValue(apiError('Sem permissão', 403));

    renderAdmin();

    expect(await screen.findByText('Acesso negado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
    expect(screen.queryByText('Nenhum usuário cadastrado')).toBeNull();
  });

  it('lista vazia real usa estado vazio, sem alerta', async () => {
    setupAdminApi({ emptyUsers: true });

    renderAdmin();

    expect(await screen.findByText('Nenhum usuário cadastrado')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falha parcial em papéis não vira tabela vazia silenciosa e o retry recupera', async () => {
    setupAdminApi({ rolesStatus: 500 });

    renderAdmin();
    await screen.findByText('Ana Souza');

    fireEvent.click(screen.getByRole('button', { name: 'Papéis' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada no admin');
    expect(screen.queryByText('Nenhum registro em papéis')).toBeNull();

    mocks.apiGet.mockImplementation((endpoint: string) => {
      if (endpoint === '/admin/roles') return Promise.resolve(roles);
      if (endpoint === '/admin/users') return Promise.resolve(users);
      if (endpoint === '/admin/users/user_1/sectors') return Promise.resolve(userSectors);
      return Promise.resolve([]);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Admin')).toBeTruthy();
  });

  it('validação do cadastro foca o primeiro campo inválido sem chamar a API', async () => {
    setupAdminApi();
    renderAdmin();
    await screen.findByText('Ana Souza');

    fireEvent.click(screen.getByRole('button', { name: 'Novo usuário' }));
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));

    const name = screen.getByLabelText('Nome do usuário *');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('E-mail do usuário *').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Senha inicial *').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name);
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it('falha ao criar anuncia role=alert, preserva os dados e nunca usa window.alert', async () => {
    setupAdminApi();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mocks.apiPost.mockRejectedValue(apiError('Falha simulada ao criar usuário', 500));

    renderAdmin();
    await screen.findByText('Ana Souza');
    fireEvent.click(screen.getByRole('button', { name: 'Novo usuário' }));
    fireEvent.change(screen.getByLabelText('Nome do usuário *'), { target: { value: 'Usuária Teste' } });
    fireEvent.change(screen.getByLabelText('E-mail do usuário *'), { target: { value: 'teste@cvg.test' } });
    fireEvent.change(screen.getByLabelText('Senha inicial *'), { target: { value: 'senha123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao criar usuário');
    expect((screen.getByLabelText('Nome do usuário *') as HTMLInputElement).value).toBe('Usuária Teste');
    expect((screen.getByLabelText('E-mail do usuário *') as HTMLInputElement).value).toBe('teste@cvg.test');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('criação bem-sucedida anuncia status, fecha o painel e recarrega', async () => {
    setupAdminApi();
    mocks.apiPost.mockResolvedValue({ id: 'user_new' });

    renderAdmin();
    await screen.findByText('Ana Souza');
    fireEvent.click(screen.getByRole('button', { name: 'Novo usuário' }));
    fireEvent.change(screen.getByLabelText('Nome do usuário *'), { target: { value: 'Usuária Teste' } });
    fireEvent.change(screen.getByLabelText('E-mail do usuário *'), { target: { value: 'teste@cvg.test' } });
    fireEvent.change(screen.getByLabelText('Senha inicial *'), { target: { value: 'senha123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));

    const feedback = await screen.findByText('Usuário criado.');
    expect(feedback.closest('[role="status"]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Criar' })).toBeNull();
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith('/admin/users', expect.objectContaining({ name: 'Usuária Teste' })));
  });

  it('exclusão pede confirmação em diálogo acessível, cancela sem chamar a API e restaura o foco', async () => {
    setupAdminApi();
    const confirmSpy = vi.spyOn(window, 'confirm');

    renderAdmin();
    await screen.findByText('Ana Souza');
    const deleteButton = screen.getByRole('button', { name: 'Excluir usuário Ana Souza' });
    fireEvent.click(deleteButton);

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Ana Souza/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(mocks.apiDelete).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(deleteButton));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('falha ao excluir mantém o diálogo aberto com role=alert e sem window.alert', async () => {
    setupAdminApi();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mocks.apiDelete.mockRejectedValue(apiError('Falha simulada ao excluir usuário', 500));

    renderAdmin();
    await screen.findByText('Ana Souza');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir usuário Ana Souza' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao excluir usuário');
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('exclusão confirmada anuncia status com o resultado real', async () => {
    setupAdminApi();
    mocks.apiDelete.mockResolvedValue({ deleted: true });

    renderAdmin();
    await screen.findByText('Ana Souza');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir usuário Ana Souza' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));

    const feedback = await screen.findByText('Usuário excluído.');
    expect(feedback.closest('[role="status"]')).toBeTruthy();
    expect(mocks.apiDelete).toHaveBeenCalledWith('/admin/users/user_1');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('erro ao carregar permissões aparece no diálogo com retry, sem grade vazia falsa', async () => {
    let failSectors = true;
    mocks.apiGet.mockImplementation((endpoint: string) => {
      if (endpoint === '/admin/users') return Promise.resolve(users);
      if (endpoint === '/admin/roles') return Promise.resolve(roles);
      if (endpoint === '/admin/queues') return Promise.resolve(queues);
      if (endpoint === '/admin/teams') return Promise.resolve(teams);
      if (endpoint === '/sectors?all=true') return Promise.resolve(sectors);
      if (endpoint === '/admin/users/user_1/sectors') {
        return failSectors
          ? Promise.reject(apiError('Falha simulada nas permissões', 500))
          : Promise.resolve(userSectors);
      }
      return Promise.resolve([]);
    });
    mocks.dlList.mockResolvedValue(deadLetterList);
    mocks.dlStats.mockResolvedValue(deadLetterSummary);
    mocks.webhookStats.mockResolvedValue(webhookStats);

    renderAdmin();
    await screen.findByText('Ana Souza');
    fireEvent.click(screen.getAllByRole('button', { name: 'Setores' })[0]);

    const dialog = await screen.findByRole('dialog');
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada nas permissões');
    expect(within(dialog).queryByRole('checkbox')).toBeNull();

    failSectors = false;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tentar novamente' }));
    expect(await within(dialog).findByRole('checkbox', { name: 'Permitir acesso ao setor Clínica' })).toBeTruthy();
  });

  it('salvar permissões anuncia status real e envia o DTO esperado', async () => {
    setupAdminApi();
    mocks.apiPut.mockResolvedValue({ success: true });

    renderAdmin();
    await screen.findByText('Ana Souza');
    fireEvent.click(screen.getAllByRole('button', { name: 'Setores' })[0]);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('checkbox', { name: 'Permitir acesso ao setor Clínica' });

    fireEvent.click(within(dialog).getByRole('button', { name: /Salvar permissões/ }));

    const feedback = await within(dialog).findByText(/Permissões salvas/);
    expect(feedback.closest('[role="status"]')).toBeTruthy();
    expect(mocks.apiPut).toHaveBeenCalledWith('/admin/users/user_1/sectors', {
      sectors: [{ sectorId: 'sector_1', accessLevel: 'write' }],
    });
  });

  it('falha ao salvar permissões anuncia role=alert e preserva a seleção', async () => {
    setupAdminApi();
    mocks.apiPut.mockRejectedValue(apiError('Falha simulada ao salvar permissões', 500));

    renderAdmin();
    await screen.findByText('Ana Souza');
    fireEvent.click(screen.getAllByRole('button', { name: 'Setores' })[0]);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('checkbox', { name: 'Permitir acesso ao setor Clínica' });

    fireEvent.click(within(dialog).getByRole('button', { name: /Salvar permissões/ }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao salvar permissões');
    expect((within(dialog).getByRole('checkbox', { name: 'Permitir acesso ao setor Clínica' }) as HTMLInputElement).checked).toBe(true);
  });

  it('revogação total exige confirmação explícita antes de enviar a API', async () => {
    setupAdminApi();
    mocks.apiPut.mockResolvedValue({ success: true });

    renderAdmin();
    await screen.findByText('Ana Souza');
    fireEvent.click(screen.getAllByRole('button', { name: 'Setores' })[0]);
    const dialog = await screen.findByRole('dialog');
    const checkbox = await within(dialog).findByRole('checkbox', { name: 'Permitir acesso ao setor Clínica' });
    fireEvent.click(checkbox);

    fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar revogação total/ }));
    expect(mocks.apiPut).not.toHaveBeenCalled();
    expect((await within(dialog).findByRole('alert')).textContent).toContain('removendo todos os acessos');

    fireEvent.click(within(dialog).getByRole('button', { name: /Confirmar revogação total/ }));
    const feedback = await within(dialog).findByText('Acessos revogados.');
    expect(feedback.closest('[role="status"]')).toBeTruthy();
    expect(mocks.apiPut).toHaveBeenCalledWith('/admin/users/user_1/sectors', { sectors: [] });
  });

  it('abas expõem aria-pressed e navegação por seta entre seções', async () => {
    setupAdminApi();
    renderAdmin();
    await screen.findByText('Ana Souza');

    expect(screen.getByRole('group', { name: 'Seções de administração' })).toBeTruthy();
    const usersTab = screen.getByRole('button', { name: 'Usuários' });
    expect(usersTab.getAttribute('aria-pressed')).toBe('true');

    fireEvent.keyDown(usersTab, { key: 'ArrowRight' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Papéis' }).getAttribute('aria-pressed')).toBe('true');
    });
    expect(screen.getByRole('button', { name: 'Usuários' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('falha nas dead-letters vira role=alert com retry, sem vazio falso', async () => {
    setupAdminApi();
    mocks.dlList.mockRejectedValue(apiError('Falha simulada ao listar dead-letters', 500));

    renderAdmin();
    await screen.findByText('Ana Souza');
    fireEvent.click(screen.getByRole('button', { name: /dead-letter/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao listar dead-letters');
    expect(screen.queryByText('Nenhuma dead-letter disponível')).toBeNull();

    mocks.dlList.mockResolvedValue(deadLetterList);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('message.persisted', { selector: 'strong' })).toBeTruthy();
  });

  it('retry de dead-letter anuncia erro real e sucesso em role=status', async () => {
    setupAdminApi();
    mocks.dlRetry.mockRejectedValueOnce(apiError('Falha simulada ao reprocessar', 500));

    renderAdmin();
    await screen.findByText('Ana Souza');
    fireEvent.click(screen.getByRole('button', { name: /dead-letter/i }));
    await screen.findByText('message.persisted', { selector: 'strong' });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao reprocessar');

    mocks.dlRetry.mockResolvedValueOnce({ success: true, replayed: true, entry: null });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    const notice = await screen.findByText(/Dead-letter reenviada para o outbox/);
    expect(notice.closest('[role="status"]')).toBeTruthy();
  });
});

describe('AAA-31 Audit — estados reais e feedback', () => {
  it('anuncia o carregamento com role=status', () => {
    mocks.apiGet.mockImplementation(() => new Promise(() => {}));

    renderAudit();

    const loading = screen.getByText('Carregando auditoria…');
    expect(loading.closest('[role="status"]')).toBeTruthy();
  });

  it('falha 500 vira role=alert com retry e nunca vazio falso', async () => {
    mocks.apiGet
      .mockRejectedValueOnce(apiError('Falha simulada na auditoria', 500))
      .mockResolvedValue(auditLogs);

    renderAudit();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada na auditoria');
    expect(screen.queryByText('Nenhum log de auditoria registrado')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('task.created')).toBeTruthy();
  });

  it('403 mostra acesso negado sem retry', async () => {
    mocks.apiGet.mockRejectedValue(apiError('Sem permissão', 403));

    renderAudit();

    expect(await screen.findByText('Acesso negado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
  });

  it('vazio real é distinto do vazio filtrado e o filtro preserva o que foi digitado', async () => {
    mocks.apiGet.mockResolvedValue(auditLogs);

    renderAudit();
    await screen.findByText('task.created');
    expect(screen.getByText('2 registros exibidos').closest('[role="status"]')).toBeTruthy();

    mocks.apiGet.mockImplementation((endpoint: string) => (
      endpoint.includes('action=') ? Promise.resolve([]) : Promise.resolve(auditLogs)
    ));
    const actionInput = screen.getByLabelText('Filtrar auditoria por ação') as HTMLInputElement;
    fireEvent.change(actionInput, { target: { value: 'nao.existe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar' }));

    expect(await screen.findByText('Nenhum log para os filtros aplicados')).toBeTruthy();
    expect(screen.queryByText('Nenhum log de auditoria registrado')).toBeNull();
    expect(actionInput.value).toBe('nao.existe');

    fireEvent.click(screen.getAllByRole('button', { name: 'Limpar filtros' })[0]);
    expect(await screen.findByText('task.created')).toBeTruthy();
    expect(actionInput.value).toBe('');
  });

  it('vazio real usa estado vazio, sem alerta', async () => {
    mocks.apiGet.mockResolvedValue([]);

    renderAudit();

    expect(await screen.findByText('Nenhum log de auditoria registrado')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falha no filtro mantém os valores digitados e anuncia role=alert', async () => {
    mocks.apiGet
      .mockResolvedValueOnce(auditLogs)
      .mockRejectedValueOnce(apiError('Falha simulada no filtro', 500));

    renderAudit();
    await screen.findByText('task.created');

    fireEvent.change(screen.getByLabelText('Filtrar auditoria por ação'), { target: { value: 'task.created' } });
    fireEvent.change(screen.getByLabelText('Filtrar auditoria por entidade'), { target: { value: 'task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada no filtro');
    expect((screen.getByLabelText('Filtrar auditoria por ação') as HTMLInputElement).value).toBe('task.created');
    expect((screen.getByLabelText('Filtrar auditoria por entidade') as HTMLInputElement).value).toBe('task');
  });
});

describe('AAA-31 Settings — estados reais e feedback', () => {
  it('anuncia o carregamento com role=status', () => {
    mocks.apiGet.mockImplementation(() => new Promise(() => {}));

    renderSettings();

    const loading = screen.getByText('Carregando configurações…');
    expect(loading.closest('[role="status"]')).toBeTruthy();
  });

  it('falha ao carregar o perfil vira role=alert com retry, sem perfil fictício', async () => {
    mocks.apiGet
      .mockRejectedValueOnce(apiError('Falha simulada no perfil', 500))
      .mockResolvedValue({ user: profile });

    renderSettings();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada no perfil');
    expect(screen.queryByText('Ana Souza')).toBeNull();
    expect(screen.queryByText('Membro desde hoje')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('ana@cvg.test')).toBeTruthy();
  });

  it('403 mostra acesso negado sem retry', async () => {
    mocks.apiGet.mockRejectedValue(apiError('Sem permissão', 403));

    renderSettings();

    expect(await screen.findByText('Acesso negado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
  });

  it('listas vazias de papéis e permissões têm texto real, sem promessa de API futura', async () => {
    mocks.apiGet.mockResolvedValue({ user: { ...profile, roles: [], permissions: [] } });

    renderSettings();

    expect(await screen.findByText('Nenhum papel atribuído.')).toBeTruthy();
    expect(screen.getByText('Nenhuma permissão atribuída a este usuário.')).toBeTruthy();
  });

  it('validação de senha foca o campo inválido e não chama a API', async () => {
    mocks.apiGet.mockResolvedValue({ user: profile });

    renderSettings();
    await screen.findByText('ana@cvg.test');
    fireEvent.click(screen.getByRole('button', { name: 'Alterar Senha' }));

    fireEvent.change(screen.getByLabelText('Senha atual'), { target: { value: 'atual123' } });
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'nova123' } });
    fireEvent.change(screen.getByLabelText('Confirmar nova senha'), { target: { value: 'diferente' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar Nova Senha' }));

    const confirm = screen.getByLabelText('Confirmar nova senha');
    expect(confirm.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(confirm);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('As senhas não coincidem.');
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it('falha da API anuncia role=alert, preserva os valores e nunca usa window.alert', async () => {
    mocks.apiGet.mockResolvedValue({ user: profile });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mocks.apiPost.mockRejectedValue(apiError('Senha atual incorreta', 400));

    renderSettings();
    await screen.findByText('ana@cvg.test');
    fireEvent.click(screen.getByRole('button', { name: 'Alterar Senha' }));
    fireEvent.change(screen.getByLabelText('Senha atual'), { target: { value: 'atual123' } });
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'nova123' } });
    fireEvent.change(screen.getByLabelText('Confirmar nova senha'), { target: { value: 'nova123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar Nova Senha' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Senha atual incorreta');
    expect((screen.getByLabelText('Senha atual') as HTMLInputElement).value).toBe('atual123');
    expect((screen.getByLabelText('Nova senha') as HTMLInputElement).value).toBe('nova123');
    expect(screen.getByRole('button', { name: 'Salvar Nova Senha' })).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('sucesso anuncia role=status, limpa os campos e fecha o formulário', async () => {
    mocks.apiGet.mockResolvedValue({ user: profile });
    mocks.apiPost.mockResolvedValue({ success: true });

    renderSettings();
    await screen.findByText('ana@cvg.test');
    fireEvent.click(screen.getByRole('button', { name: 'Alterar Senha' }));
    fireEvent.change(screen.getByLabelText('Senha atual'), { target: { value: 'atual123' } });
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'nova123' } });
    fireEvent.change(screen.getByLabelText('Confirmar nova senha'), { target: { value: 'nova123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar Nova Senha' }));

    const feedback = await screen.findByText('Senha alterada com sucesso!');
    expect(feedback.closest('[role="status"]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Salvar Nova Senha' })).toBeNull();
    expect(mocks.apiPost).toHaveBeenCalledWith('/auth/change-password', {
      currentPassword: 'atual123',
      newPassword: 'nova123',
    });
  });
});
