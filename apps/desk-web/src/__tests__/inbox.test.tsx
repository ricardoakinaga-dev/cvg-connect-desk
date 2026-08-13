import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Inbox } from '../pages/Inbox';

const mocks = vi.hoisted(() => ({
  authStoreMock: vi.fn(),
  realtimeConnectMock: vi.fn(),
  realtimeDisconnectMock: vi.fn(),
  realtimeSubscribeMock: vi.fn(),
  realtimeUnsubscribeMock: vi.fn(),
  apiGetMock: vi.fn(),
  apiPostMock: vi.fn(),
  sectorListMock: vi.fn(),
  conversationListMock: vi.fn(),
  conversationMessagesMock: vi.fn(),
  sendMessageMock: vi.fn(),
  transferCreateMock: vi.fn(),
}));

vi.mock('../store/auth', () => ({
  useAuthStore: () => mocks.authStoreMock(),
}));

vi.mock('../lib/realtime', () => ({
  realtimeClient: {
    connect: mocks.realtimeConnectMock,
    disconnect: mocks.realtimeDisconnectMock,
    subscribe: mocks.realtimeSubscribeMock,
    unsubscribe: mocks.realtimeUnsubscribeMock,
  },
}));

vi.mock('../lib/api', () => ({
  api: {
    get: mocks.apiGetMock,
    post: mocks.apiPostMock,
  },
  conversationApi: {
    list: mocks.conversationListMock,
    getMessages: mocks.conversationMessagesMock,
    sendMessage: mocks.sendMessageMock,
  },
  sectorApi: {
    list: mocks.sectorListMock,
  },
  transferApi: {
    create: mocks.transferCreateMock,
  },
  getErrorMessage: (error: unknown, fallback = 'Erro inesperado') => error instanceof Error ? error.message : fallback,
}));

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  value: vi.fn(),
  configurable: true,
});

describe('Inbox page', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders conversations, opens a thread, and sends a message', async () => {
    mocks.authStoreMock.mockReturnValue({ isAuthenticated: true });

    mocks.apiGetMock.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/contacts') {
        return [];
      }
      throw new Error(`Unexpected endpoint ${endpoint}`);
    });

    mocks.sectorListMock.mockResolvedValue([
      { id: 'sector_1', name: 'Suporte', icon: '🩺', color: '#2563eb', isActive: true },
    ]);

    mocks.conversationListMock.mockResolvedValue({
      conversations: [
        {
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
          createdAt: '2026-04-10T12:00:00.000Z',
          updatedAt: '2026-04-10T12:00:00.000Z',
          closedAt: null,
          lastMessage: {
            id: 'msg_last',
            conversationId: 'conv_1',
            direction: 'outbound',
            content: 'Precisamos confirmar os dados',
            sender: null,
            senderType: null,
            recipient: null,
            status: 'sent',
            externalMessageId: null,
            metadata: null,
            sentAt: null,
            deliveredAt: null,
            createdAt: '2026-04-10T12:01:00.000Z',
          },
          contactName: 'Maria Silva',
          contactPhone: '5511999999999',
          sectorId: 'sector_1',
          statusV2: 'open',
        },
      ],
    });

    mocks.conversationMessagesMock.mockResolvedValue({
      messages: [
        {
          id: 'msg_1',
          conversationId: 'conv_1',
          direction: 'inbound',
          content: 'Olá, queria ajuda com a matrícula',
          sender: null,
          senderType: null,
          recipient: null,
          status: 'sent',
          externalMessageId: null,
          metadata: null,
          sentAt: null,
          deliveredAt: null,
          createdAt: '2026-04-10T12:02:00.000Z',
        },
      ],
    });

    mocks.sendMessageMock.mockResolvedValue({
      messageId: 'msg_sent',
      conversationId: 'conv_1',
      status: 'sent',
    });

    render(
      <MemoryRouter>
        <Inbox />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mocks.realtimeConnectMock).toHaveBeenCalledWith();
    });

    expect(await screen.findByText('Maria Silva')).toBeTruthy();
    expect(screen.getByText('Precisamos confirmar os dados')).toBeTruthy();

    fireEvent.click(screen.getByText('Maria Silva'));

    expect(await screen.findByText('Olá, queria ajuda com a matrícula')).toBeTruthy();
    expect(screen.getByPlaceholderText('Mensagem')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Mensagem'), { target: { value: 'Vamos seguir com o atendimento' } });
    fireEvent.click(screen.getByRole('button', { name: '➤' }));

    await waitFor(() => {
      expect(mocks.sendMessageMock).toHaveBeenCalledWith({
        conversationId: 'conv_1',
        content: 'Vamos seguir com o atendimento',
        recipient: 'contact_1',
      });
    });
  });

  it('shows the empty state when there are no conversations', async () => {
    mocks.authStoreMock.mockReturnValue({ isAuthenticated: true });
    mocks.apiGetMock.mockResolvedValue([]);
    mocks.sectorListMock.mockResolvedValue([]);
    mocks.conversationListMock.mockResolvedValue({ conversations: [] });
    mocks.conversationMessagesMock.mockResolvedValue({ messages: [] });
    mocks.sendMessageMock.mockResolvedValue({});

    render(
      <MemoryRouter>
        <Inbox />
      </MemoryRouter>
    );

    expect(await screen.findByText('Nenhuma conversa')).toBeTruthy();
  });

  it('covers search, realtime events, new conversations, media, transfer and contact info', async () => {
    mocks.authStoreMock.mockReturnValue({ isAuthenticated: true });
    mocks.apiGetMock.mockResolvedValue([
      { id: 'contact-1', name: 'João', phone: '5511999999999' },
      { id: 'contact-2', name: null, phone: '123' },
    ]);
    mocks.sectorListMock.mockResolvedValue([
      { id: 'sector-1', name: 'Clínica', icon: 'C', color: '#2563eb', isActive: true },
      { id: 'sector-2', name: 'Recepção', icon: 'R', color: '#16a34a', isActive: true },
      { id: 'sector-3', name: 'Inativo', icon: 'I', color: '#64748b', isActive: false },
    ]);

    const conversations = [
      {
        id: 'conv-1',
        contactId: 'contact-1',
        status: 'pending',
        statusV2: 'pending',
        interactionType: null,
        queueId: null,
        teamId: null,
        isActive: true,
        externalChannelId: null,
        externalConversationId: null,
        metadata: null,
        createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        updatedAt: '2026-04-10T12:00:00.000Z',
        closedAt: null,
        sectorId: 'sector-1',
        contactName: null,
        contactPhone: '5511999999999',
        lastMessage: {
          id: 'last-1',
          conversationId: 'conv-1',
          direction: 'inbound',
          content: 'Esta é uma mensagem longa para validar o recorte visual da lista de conversas.',
          sender: null,
          senderType: null,
          recipient: null,
          status: 'sent',
          externalMessageId: null,
          metadata: null,
          sentAt: null,
          deliveredAt: null,
          createdAt: '2026-04-10T12:01:00.000Z',
        },
      },
      {
        id: 'conv-2',
        contactId: null,
        status: 'open',
        statusV2: 'unknown',
        interactionType: null,
        queueId: null,
        teamId: null,
        isActive: true,
        externalChannelId: null,
        externalConversationId: null,
        metadata: null,
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: '2026-04-10T12:00:00.000Z',
        closedAt: null,
        sectorId: 'sector-2',
        contactName: 'Maria',
        contactPhone: '11988887777',
        lastMessage: null,
      },
    ];
    mocks.conversationListMock.mockResolvedValue({ conversations });
    mocks.conversationMessagesMock.mockResolvedValue({
      messages: [
        {
          id: 'msg-1', conversationId: 'conv-1', direction: 'inbound', content: 'Olá, preciso de ajuda',
          sender: null, senderType: null, recipient: null, status: 'sent', externalMessageId: null,
          metadata: null, sentAt: null, deliveredAt: null, createdAt: '2026-04-10T12:02:00.000Z',
          mediaType: 'image', mediaUrl: 'data:image/png;base64,abc',
        },
        {
          id: 'msg-2', conversationId: 'conv-1', direction: 'outbound', content: 'Resposta de áudio',
          sender: 'agent', senderType: null, recipient: null, status: 'sent', externalMessageId: null,
          metadata: null, sentAt: null, deliveredAt: null, createdAt: '2026-04-10T12:03:00.000Z',
          mediaType: 'audio', mediaUrl: 'data:audio/ogg;base64,abc',
        },
        {
          id: 'msg-3', conversationId: 'conv-1', direction: 'outbound', content: '',
          sender: 'agent', senderType: null, recipient: null, status: 'sent', externalMessageId: null,
          metadata: null, sentAt: null, deliveredAt: null, createdAt: '2026-04-10T12:04:00.000Z',
          mediaType: null, mediaUrl: null,
        },
      ],
    });
    mocks.sendMessageMock.mockResolvedValue({ messageId: 'msg-sent', conversationId: 'conv-1', status: 'sent' });
    mocks.apiPostMock.mockResolvedValue({ conversationId: 'conv-new', isNew: true });
    mocks.transferCreateMock.mockResolvedValue({ id: 'transfer-1' });

    const handlers = new Map<string, (event: unknown) => void>();
    mocks.realtimeSubscribeMock.mockImplementation((event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler);
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    render(
      <MemoryRouter>
        <Inbox />
      </MemoryRouter>
    );

    expect(await screen.findByText('+55 11 99999-9999')).toBeTruthy();
    expect(screen.getByText('Maria')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Pesquisar conversas...'), { target: { value: 'Maria' } });
    expect(screen.getByText('Maria')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Pesquisar conversas...'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Clínica/ }));
    await waitFor(() => expect(mocks.conversationListMock).toHaveBeenCalledWith({ sectorId: 'sector-1' }));

    fireEvent.click(screen.getByText('+55 11 99999-9999'));
    expect(await screen.findByText('Olá, preciso de ajuda')).toBeTruthy();
    expect(screen.getByText('Resposta de áudio')).toBeTruthy();

    handlers.get('message.persisted')?.({ payload: { conversationId: 'conv-1' } });
    handlers.get('message.persisted')?.({ payload: { conversationId: 'conv-other' } });
    handlers.get('conversation.created')?.({ payload: {} });
    handlers.get('conversation.status.changed')?.({ payload: {} });
    handlers.get('handoff.completed')?.({ payload: {} });

    fireEvent.click(screen.getByRole('button', { name: 'Buscar mensagens' }));
    fireEvent.change(screen.getByPlaceholderText('Buscar nesta conversa...'), { target: { value: 'olá' } });
    expect(screen.getByText('1 resultado')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Buscar nesta conversa...'), { target: { value: 'não existe' } });
    expect(screen.getByText('0 resultados')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar busca' }));

    fireEvent.click(screen.getByRole('button', { name: 'Informacoes da conversa' }));
    expect(screen.getByText('Copiar ID')).toBeTruthy();
    fireEvent.click(screen.getByText('Copiar ID'));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar informacoes' }));

    fireEvent.click(screen.getByRole('button', { name: 'Transferir conversa' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sector-2' } });
    fireEvent.change(screen.getByPlaceholderText('Opcional'), { target: { value: 'Encaminhar para recepção' } });
    fireEvent.click(screen.getByRole('button', { name: 'Transferir' }));
    await waitFor(() => expect(mocks.transferCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      contactId: 'contact-1',
      toSectorId: 'sector-2',
      reason: 'Encaminhar para recepção',
    })));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(['image'], 'foto.png', { type: 'image/png' })] } });
    fireEvent.change(screen.getByPlaceholderText('Legenda (opcional)...'), { target: { value: 'Imagem' } });
    fireEvent.click(screen.getByRole('button', { name: '➤' }));
    await waitFor(() => expect(mocks.apiPostMock).toHaveBeenCalledWith('/messages', expect.objectContaining({
      conversationId: 'conv-1',
      mediaType: 'image',
      mediaFilename: 'foto.png',
    })));

    fireEvent.click(screen.getByRole('button', { name: 'Novo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Colaboradores' }));
    fireEvent.change(screen.getByPlaceholderText('Buscar contato...'), { target: { value: 'sem resultado' } });
    expect(screen.getByText('Nenhum contato encontrado')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Buscar contato...'), { target: { value: '' } });
    fireEvent.click(screen.getByText('João'));
    await waitFor(() => expect(mocks.apiPostMock).toHaveBeenCalledWith('/contacts/contact-1/start-conversation', {
      sectorId: 'sector-1',
    }));

    fireEvent.click(screen.getByRole('button', { name: /Todos/ }));
    fireEvent.click(screen.getByText('Maria'));
    fireEvent.click(screen.getByRole('button', { name: 'Transferir conversa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Transferir' }));
    expect(alertSpy).toHaveBeenCalledWith('Esta conversa nao tem contato vinculado para transferencia.');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('does not connect realtime for an anonymous user and handles request failures', async () => {
    mocks.authStoreMock.mockReturnValue({ isAuthenticated: false });
    mocks.apiGetMock.mockRejectedValue(new Error('contacts unavailable'));
    mocks.sectorListMock.mockRejectedValue(new Error('sectors unavailable'));
    mocks.conversationListMock.mockRejectedValue(new Error('conversations unavailable'));

    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <MemoryRouter>
        <Inbox />
      </MemoryRouter>
    );

    expect(await screen.findByText('Nenhuma conversa')).toBeTruthy();
    expect(mocks.realtimeConnectMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
