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
}));

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  value: vi.fn(),
  configurable: true,
});

describe('Inbox page', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('renders conversations, opens a thread, and sends a message', async () => {
    mocks.authStoreMock.mockReturnValue({ token: 'token-123' });

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
      expect(mocks.realtimeConnectMock).toHaveBeenCalledWith('token-123');
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
    mocks.authStoreMock.mockReturnValue({ token: 'token-123' });
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
});
