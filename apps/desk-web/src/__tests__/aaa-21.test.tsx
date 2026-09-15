import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Inbox } from '../pages/Inbox';
import { Dashboard } from '../pages/Dashboard';
import { Login } from '../pages/Login';
import { useAuthStore } from '../store/auth';

const mocks = vi.hoisted(() => {
  const subscribeHandlers = new Map<string, Array<(event: unknown) => unknown>>();
  return {
    apiGetMock: vi.fn(),
    apiPostMock: vi.fn(),
    conversationListMock: vi.fn(),
    conversationMessagesMock: vi.fn(),
    markReadMock: vi.fn(),
    sendMessageMock: vi.fn(),
    uploadMediaMock: vi.fn(),
    sectorListMock: vi.fn(),
    dashboardSummaryMock: vi.fn(),
    dashboardPremiumMock: vi.fn(),
    realtimeConnectMock: vi.fn(),
    realtimeDisconnectMock: vi.fn(),
    realtimeSubscribeMock: vi.fn((event: string, handler: (payload: unknown) => unknown) => {
      const list = subscribeHandlers.get(event) ?? [];
      list.push(handler);
      subscribeHandlers.set(event, list);
    }),
    realtimeUnsubscribeMock: vi.fn(),
    realtimeGetStateMock: vi.fn((): Record<string, unknown> => ({ status: 'idle', connected: false, attempt: 0, changedAt: 0 })),
    realtimeSubscribeStateMock: vi.fn(() => () => {}),
    subscribeHandlers,
  };
});

vi.mock('../lib/api', () => ({
  api: {
    get: mocks.apiGetMock,
    post: mocks.apiPostMock,
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
  conversationApi: {
    list: mocks.conversationListMock,
    getMessages: mocks.conversationMessagesMock,
    markRead: mocks.markReadMock,
    sendMessage: mocks.sendMessageMock,
    uploadMedia: mocks.uploadMediaMock,
  },
  sectorApi: {
    list: mocks.sectorListMock,
  },
  taskApi: { list: vi.fn().mockResolvedValue([]) },
  alertApi: { list: vi.fn().mockResolvedValue([]) },
  noteApi: { list: vi.fn().mockResolvedValue([]) },
  dashboardApi: {
    getSummary: mocks.dashboardSummaryMock,
    getPremium: mocks.dashboardPremiumMock,
    getConversations: vi.fn(),
    getOpenConversationsCount: vi.fn(),
    getTasks: vi.fn(),
    getOverdueTasksCount: vi.fn(),
    getAlerts: vi.fn(),
    getActiveAlertsCount: vi.fn(),
  },
}));

vi.mock('../lib/realtime', () => ({
  realtimeClient: {
    connect: mocks.realtimeConnectMock,
    disconnect: mocks.realtimeDisconnectMock,
    subscribe: mocks.realtimeSubscribeMock,
    unsubscribe: mocks.realtimeUnsubscribeMock,
    getConnectionState: mocks.realtimeGetStateMock,
    subscribeConnectionState: mocks.realtimeSubscribeStateMock,
  },
}));

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  value: vi.fn(),
  configurable: true,
});

const scrollIntoViewMock = HTMLElement.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>;

const user = { id: 'u-1', name: 'Ana Souza', email: 'ana@cvg.test', roles: ['admin'] };

function apiError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function makeConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv_1',
    contactId: 'contact_1',
    status: 'open',
    interactionType: null,
    queueId: null,
    teamId: null,
    isActive: true,
    externalChannelId: null,
    externalConversationId: null,
    metadata: null,
    unreadCount: 0,
    createdAt: '2026-09-12T10:00:00.000Z',
    updatedAt: '2026-09-13T12:00:00.000Z',
    closedAt: null,
    lastMessage: {
      id: 'm-last-1',
      conversationId: 'conv_1',
      direction: 'inbound',
      content: 'Preciso de ajuda',
      sender: '5511999990001',
      senderType: 'contact',
      recipient: null,
      status: 'delivered',
      externalMessageId: null,
      metadata: null,
      sentAt: null,
      deliveredAt: null,
      createdAt: '2026-09-13T12:00:00.000Z',
    },
    contactName: 'Maria Silva',
    contactPhone: '5511999990001',
    sectorId: 'sector_1',
    statusV2: 'open',
    ...overrides,
  };
}

function makeMessage(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `msg_${index}`,
    conversationId: 'conv_1',
    direction: index % 2 === 0 ? 'inbound' : 'outbound',
    content: `Histórico item ${index}`,
    sender: index % 2 === 0 ? '5511999990001' : null,
    senderType: index % 2 === 0 ? 'contact' : null,
    recipient: index % 2 === 0 ? null : '5511999990001',
    status: 'delivered',
    externalMessageId: null,
    metadata: null,
    sentAt: null,
    deliveredAt: null,
    createdAt: new Date(Date.parse('2026-09-13T08:00:00.000Z') + index * 60000).toISOString(),
    ...overrides,
  };
}

const summaryFixture = {
  conversations: { open: 12, pending: 3, closed: 40, archived: 2, total: 57 },
  tasks: { total: 18, pending: 7, inProgress: 4, completed: 6, cancelled: 1, overdue: 2 },
  alerts: { total: 9, active: 3, acknowledged: 2, resolved: 4, bySeverity: { info: 2, warning: 3, error: 2, critical: 2 } },
  generatedAt: '2026-09-13T12:34:56.000Z',
};

const premiumFixture = {
  ...summaryFixture,
  responseTime: { avgFirstResponseTime: 42, avgResponseTime: 65, totalConversationsWithResponse: 30 },
  handoff: { totalHandoffs: 4, totalConversations: 57, handoffRate: 0.07 },
  sectorBacklog: [],
  agingConversations: [],
  alertsByCriticality: { critical: 2, error: 2, warning: 3, info: 2 },
};

function setupInboxMocks() {
  mocks.apiGetMock.mockImplementation(async (endpoint: string) => {
    if (endpoint === '/contacts') return [{ id: 'contact_1', name: 'Cliente Um', phone: '5511988887777' }];
    return [];
  });
  mocks.sectorListMock.mockResolvedValue([
    { id: 'sector_1', name: 'Recepção', code: 'REC', description: null, color: '#0284c7', icon: 'sectors', isActive: true, autoAssign: false, maxConcurrent: 5 },
  ]);
  mocks.conversationListMock.mockResolvedValue({ conversations: [makeConversation()] });
  mocks.conversationMessagesMock.mockResolvedValue({ messages: [makeMessage(1)] });
  mocks.markReadMock.mockResolvedValue({ conversationId: 'conv_1', unreadCount: 0 });
  mocks.sendMessageMock.mockResolvedValue({ messageId: 'msg_sent', conversationId: 'conv_1', status: 'sent' });
}

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
    sessionNotice: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
  mocks.realtimeGetStateMock.mockReturnValue({ status: 'idle', connected: false, attempt: 0, changedAt: 0 });
});

describe('AAA-21 Login — estados e contrato real', () => {
  it('anuncia progresso com role=status e bloqueia a edição durante a autenticação', async () => {
    let resolveLogin: ((value: unknown) => void) | undefined;
    mocks.apiPostMock.mockImplementation(() => new Promise((resolve) => { resolveLogin = resolve; }));

    render(<MemoryRouter><Login /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'ana@cvg.test' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'senha' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    const progress = await screen.findByText('Autenticando…');
    expect(progress.closest('[role="status"]')).toBeTruthy();
    expect((screen.getByPlaceholderText('Email') as HTMLInputElement).disabled).toBe(true);

    await act(async () => {
      resolveLogin?.({ user, token: 'tok' });
    });
  });

  it('mostra erro de credenciais inválidas em role=alert com a mensagem real', async () => {
    mocks.apiPostMock.mockRejectedValue(apiError('Credenciais inválidas', 401));

    render(<MemoryRouter><Login /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'ana@cvg.test' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'errada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Credenciais inválidas');
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy();
  });

  it('falha de rede vira mensagem offline verdadeira, não erro genérico', async () => {
    mocks.apiPostMock.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<MemoryRouter><Login /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'ana@cvg.test' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'senha' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Sem conexão|Não foi possível alcançar o servidor/);
  });

  it('403 mostra acesso negado sem oferecer retry cego', async () => {
    mocks.apiPostMock.mockRejectedValue(apiError('Sem permissão', 403));

    render(<MemoryRouter><Login /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'ana@cvg.test' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'senha' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('Acesso negado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
  });

  it('exibe o aviso de sessão expirada vindo do estado global', () => {
    useAuthStore.setState({ sessionNotice: 'Sua sessão expirou. Entre novamente para continuar.' });
    render(<MemoryRouter><Login /></MemoryRouter>);
    expect(screen.getByText('Sua sessão expirou. Entre novamente para continuar.')).toBeTruthy();
  });
});

describe('AAA-21 Dashboard — loading, erro, forbidden e degradação parcial', () => {
  it('mostra loading com role=status enquanto o resumo não chega', async () => {
    let resolveSummary: ((value: unknown) => void) | undefined;
    mocks.dashboardSummaryMock.mockImplementation(() => new Promise((resolve) => { resolveSummary = resolve; }));
    mocks.dashboardPremiumMock.mockResolvedValue(premiumFixture);

    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const loading = screen.getByText('Carregando dashboard…');
    expect(loading.closest('[role="status"]')).toBeTruthy();

    await act(async () => {
      resolveSummary?.(summaryFixture);
    });
  });

  it('erro do resumo vira role=alert com retry que realmente refaz a chamada', async () => {
    mocks.dashboardSummaryMock
      .mockRejectedValueOnce(apiError('Falha no resumo', 500))
      .mockResolvedValueOnce(summaryFixture);
    mocks.dashboardPremiumMock.mockResolvedValue(premiumFixture);

    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Erro ao carregar dashboard');

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('57')).toBeTruthy();
    expect(mocks.dashboardSummaryMock).toHaveBeenCalledTimes(2);
  });

  it('403 mostra acesso negado sem retry', async () => {
    mocks.dashboardSummaryMock.mockRejectedValue(apiError('Sem permissão', 403));
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await screen.findByText('Acesso negado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
  });

  it('degradação do premium mantém o resumo e oferece recarga explícita', async () => {
    mocks.dashboardSummaryMock.mockResolvedValue(summaryFixture);
    mocks.dashboardPremiumMock
      .mockRejectedValueOnce(apiError('Premium indisponível', 500))
      .mockResolvedValueOnce(premiumFixture);

    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await screen.findByText('57')).toBeTruthy();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Premium indisponível/);

    fireEvent.click(screen.getByRole('button', { name: 'Recarregar indicadores' }));
    expect(await screen.findByText('Handoffs')).toBeTruthy();
    expect(mocks.dashboardPremiumMock).toHaveBeenCalledTimes(2);
  });

  it('não afirma "Atualizado agora": o selo deriva de generatedAt', async () => {
    mocks.dashboardSummaryMock.mockResolvedValue(summaryFixture);
    mocks.dashboardPremiumMock.mockResolvedValue(premiumFixture);

    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await screen.findByText('57');
    expect(screen.queryByText('Atualizado agora')).toBeNull();
    expect(screen.getByText(/^Atualizado /)).toBeTruthy();
  });
});

describe('AAA-21 Inbox — estados de rede e retry', () => {
  it('lista carrega com role=status, não com spinner anônimo', async () => {
    let resolveList: ((value: unknown) => void) | undefined;
    setupInboxMocks();
    mocks.conversationListMock.mockImplementation(() => new Promise((resolve) => { resolveList = resolve; }));

    render(<MemoryRouter><Inbox /></MemoryRouter>);
    const loading = screen.getByText('Carregando conversas…');
    expect(loading.closest('[role="status"]')).toBeTruthy();

    await act(async () => {
      resolveList?.({ conversations: [makeConversation()] });
    });
  });

  it('falha ao listar conversas nunca cai em vazio silencioso: role=alert + retry real', async () => {
    setupInboxMocks();
    mocks.conversationListMock.mockRejectedValue(apiError('Falha simulada ao listar conversas', 500));

    render(<MemoryRouter><Inbox /></MemoryRouter>);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Erro ao carregar conversas');
    expect(screen.queryByText('Nenhuma conversa')).toBeNull();

    mocks.conversationListMock.mockResolvedValue({ conversations: [makeConversation()] });
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Maria Silva')).toBeTruthy();
  });

  it('403 na lista mostra acesso negado sem retry', async () => {
    setupInboxMocks();
    mocks.conversationListMock.mockRejectedValue(apiError('Sem permissão', 403));

    render(<MemoryRouter><Inbox /></MemoryRouter>);
    expect(await screen.findByText('Acesso negado')).toBeTruthy();
    expect(screen.queryByText('Nenhuma conversa')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
  });

  it('lista vazia real usa estado vazio com título textual', async () => {
    setupInboxMocks();
    mocks.conversationListMock.mockResolvedValue({ conversations: [] });

    render(<MemoryRouter><Inbox /></MemoryRouter>);
    expect(await screen.findByText('Nenhuma conversa')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falha do histórico mostra role=alert no chat e o retry recarrega as mensagens', async () => {
    setupInboxMocks();
    mocks.conversationMessagesMock
      .mockRejectedValueOnce(apiError('Falha simulada no histórico', 500))
      .mockResolvedValue({ messages: [makeMessage(2)] });

    render(<MemoryRouter><Inbox /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Maria Silva'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Erro ao carregar histórico');
    expect(screen.queryByText('Histórico item 2')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Histórico item 2')).toBeTruthy();
  });

  it('polling não descarta a janela já lida, não salta o scroll e preserva o rascunho', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setupInboxMocks();
    const initial = Array.from({ length: 40 }, (_, index) => makeMessage(index));
    mocks.conversationMessagesMock
      .mockResolvedValueOnce({ messages: initial })
      .mockResolvedValue({ messages: initial.slice(-5) });

    render(<MemoryRouter><Inbox /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Maria Silva'));
    expect(await screen.findByText('Histórico item 0')).toBeTruthy();

    const scroller = document.querySelector('.chat-messages-v2') as HTMLElement;
    Object.defineProperty(scroller, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 400, configurable: true });
    scroller.scrollTop = 100;
    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'rascunho importante' } });
    // Deixa o scroll inicial da troca de conversa acontecer antes de medir o polling.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });
    scrollIntoViewMock.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5200);
    });

    await waitFor(() => expect(mocks.conversationMessagesMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Histórico item 0')).toBeTruthy();
    expect(screen.getByText('Histórico item 39')).toBeTruthy();
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Mensagem') as HTMLInputElement).value).toBe('rascunho importante');
    vi.useRealTimers();
  });

  it('scroll do histórico respeita prefers-reduced-motion', async () => {
    setupInboxMocks();
    const matchMediaSpy = vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList));

    render(<MemoryRouter><Inbox /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Maria Silva'));
    await screen.findByText('Histórico item 1');

    await waitFor(() => expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'auto' }));
    matchMediaSpy.mockRestore();
  });

  it('deep-link de conversa fora da primeira página continua acessível com detalhes pendentes', async () => {
    setupInboxMocks();
    mocks.conversationMessagesMock.mockResolvedValue({
      messages: [
        makeMessage(90, {
          id: 'deep_1',
          conversationId: 'deep-99',
          direction: 'inbound',
          content: 'Mensagem do deep-link',
          sender: '5511988887777',
        }),
      ],
    });

    render(
      <MemoryRouter initialEntries={['/inbox?conversation=deep-99']}>
        <Inbox />
      </MemoryRouter>
    );

    expect(await screen.findByText('Mensagem do deep-link')).toBeTruthy();
    expect(screen.getByText('Detalhes pendentes')).toBeTruthy();
  });

  it('estado offline real é anunciado sem afirmar conexão', async () => {
    setupInboxMocks();
    render(<MemoryRouter><Inbox /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Maria Silva'));
    await screen.findByText('Histórico item 1');

    await act(async () => {
      Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByText(/Sem conexão à internet/)).toBeTruthy();
  });

  it('tempo real offline tem aviso próprio, distinto do offline de rede', async () => {
    setupInboxMocks();
    mocks.realtimeGetStateMock.mockReturnValue({ status: 'offline', connected: false, attempt: 0, changedAt: 0, reason: 'connection-lost' });

    render(<MemoryRouter><Inbox /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Maria Silva'));
    expect(await screen.findByText(/Tempo real indisponível/)).toBeTruthy();
  });

  it('falha ao iniciar conversa aparece em role=alert, sem window.alert', async () => {
    setupInboxMocks();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mocks.apiPostMock.mockRejectedValue(apiError('Falha ao iniciar a conversa', 500));

    render(<MemoryRouter><Inbox /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar nova conversa' }));
    fireEvent.click(await screen.findByText('Cliente Um'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha ao iniciar a conversa');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('Escape fecha o painel de contexto e devolve o foco ao acionador', async () => {
    setupInboxMocks();
    render(<MemoryRouter><Inbox /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Maria Silva'));

    const infoButton = await screen.findByRole('button', { name: 'Abrir informações da conversa' });
    fireEvent.click(infoButton);
    expect(document.querySelector('.context-backdrop')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('.context-backdrop')).toBeNull());
    expect(document.activeElement).toBe(infoButton);
  });
});

describe('AAA-21 sessão expirada — evento, storage e store', () => {
  it('401 autenticado emite o evento global e limpa o storage de sessão', async () => {
    const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'SESSION_EXPIRED', message: 'Sessão expirada' }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'tok', isAuthenticated: true }, version: 0 }));
    const listener = vi.fn();
    window.addEventListener(actual.SESSION_EXPIRED_EVENT, listener);

    await expect(actual.api.get('/conversations')).rejects.toMatchObject({ status: 401 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('auth-storage')).toBeNull();
    window.removeEventListener(actual.SESSION_EXPIRED_EVENT, listener);
  });

  it('401 no login não é tratado como sessão expirada', async () => {
    const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'INVALID_CREDENTIALS', message: 'Credenciais inválidas' }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'tok' }, version: 0 }));
    const listener = vi.fn();
    window.addEventListener(actual.SESSION_EXPIRED_EVENT, listener);

    await expect(actual.api.post('/auth/login', { email: 'a', password: 'b' })).rejects.toMatchObject({ status: 401 });

    expect(listener).not.toHaveBeenCalled();
    expect(localStorage.getItem('auth-storage')).not.toBeNull();
    window.removeEventListener(actual.SESSION_EXPIRED_EVENT, listener);
  });

  it('expireSession limpa usuário, token e autenticação, e registra o aviso', () => {
    useAuthStore.setState({ user, token: 'tok', isAuthenticated: true, sessionNotice: null });
    useAuthStore.getState().expireSession('Sua sessão expirou. Entre novamente para continuar.');

    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      token: null,
      isAuthenticated: false,
      error: null,
      sessionNotice: 'Sua sessão expirou. Entre novamente para continuar.',
    });
  });
});
