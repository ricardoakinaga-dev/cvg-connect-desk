import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Inbox } from '../pages/Inbox';

const mocks = vi.hoisted(() => {
  const subscribeHandlers = new Map<string, Array<(event: unknown) => unknown>>();
  return {
    authStoreMock: vi.fn(),
    realtimeConnectMock: vi.fn(),
    realtimeDisconnectMock: vi.fn(),
    realtimeSubscribeMock: vi.fn((event: string, handler: (payload: unknown) => unknown) => {
      const list = subscribeHandlers.get(event) ?? [];
      list.push(handler);
      subscribeHandlers.set(event, list);
    }),
    realtimeUnsubscribeMock: vi.fn(),
    subscribeHandlers,
    apiGetMock: vi.fn(),
    apiPostMock: vi.fn(),
    sectorListMock: vi.fn(),
    conversationListMock: vi.fn(),
    conversationMessagesMock: vi.fn(),
    markReadMock: vi.fn(),
    sendMessageMock: vi.fn(),
    uploadMediaMock: vi.fn(),
  };
});

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
  MEDIA_MAX_BYTES: 16 * 1024 * 1024,
  mediaKindForFile: (mimetype: string) => {
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('audio/')) return 'audio';
    if (mimetype.startsWith('video/')) return 'video';
    return 'document';
  },
}));

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  value: vi.fn(),
  configurable: true,
});

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
    createdAt: '2026-04-10T12:00:00.000Z',
    updatedAt: '2026-04-10T12:00:00.000Z',
    closedAt: null,
    lastMessage: null,
    lastInboundMessage: null,
    contactName: 'Maria Silva',
    contactPhone: '5511999999999',
    sectorId: 'sector_1',
    statusV2: 'open',
    ...overrides,
  };
}

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_1',
    conversationId: 'conv_1',
    direction: 'inbound',
    content: 'olá',
    sender: '5511999999999',
    senderType: null,
    recipient: null,
    status: 'sent',
    externalMessageId: null,
    metadata: null,
    sentAt: null,
    deliveredAt: null,
    createdAt: '2026-04-10T12:00:00.000Z',
    ...overrides,
  };
}

function renderInbox() {
  return render(
    <MemoryRouter>
      <Inbox />
    </MemoryRouter>
  );
}

async function openConversation(name = 'Maria Silva') {
  fireEvent.click(await screen.findByText(name));
  return screen.findByLabelText('Mensagem');
}

function attachFile(file: File) {
  fireEvent.change(screen.getByLabelText('Selecionar anexo'), { target: { files: [file] } });
}

function sendWith(text: string) {
  fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
}

function idempotencyKeyOf(callIndex: number): string {
  const payload = mocks.sendMessageMock.mock.calls[callIndex][0] as { idempotencyKey?: string };
  return payload.idempotencyKey as string;
}

describe('Inbox — contrato de envio e anexos (AAA-13)', () => {
  beforeEach(() => {
    mocks.authStoreMock.mockReturnValue({ token: 'token-123' });
    mocks.apiGetMock.mockResolvedValue([]);
    mocks.sectorListMock.mockResolvedValue([]);
    mocks.conversationListMock.mockResolvedValue({
      conversations: [makeConversation()],
      nextCursor: null,
    });
    mocks.conversationMessagesMock.mockResolvedValue({ messages: [], nextCursor: null });
    mocks.markReadMock.mockResolvedValue({ conversationId: 'conv_1', unreadCount: 0 });
    mocks.uploadMediaMock.mockResolvedValue({
      assetId: 'asset_1',
      mediaType: 'image',
      mimetype: 'image/png',
      filename: 'foto.png',
      sizeBytes: 3,
      scanStatus: 'CLEAN',
      storageStatus: 'stored',
    });
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    vi.clearAllMocks();
    mocks.subscribeHandlers.clear();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('duplo clique envia uma única vez e mantém a mesma Idempotency-Key', async () => {
    let resolveSend: (value: unknown) => void = () => {};
    mocks.sendMessageMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveSend = resolve; })
    );

    renderInbox();
    await openConversation();
    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'Olá, tudo bem?' } });

    const sendButton = screen.getByRole('button', { name: 'Enviar mensagem' });
    fireEvent.click(sendButton);
    fireEvent.click(sendButton);

    await waitFor(() => expect(mocks.sendMessageMock).toHaveBeenCalledTimes(1));
    expect(typeof idempotencyKeyOf(0)).toBe('string');
    expect(idempotencyKeyOf(0).length).toBeGreaterThan(8);
    expect(mocks.sendMessageMock.mock.calls[0][0]).toMatchObject({
      conversationId: 'conv_1',
      content: 'Olá, tudo bem?',
      recipient: '5511999999999',
    });

    await act(async () => {
      resolveSend({ messageId: 'msg_1', conversationId: 'conv_1', status: 'sent', outcome: 'accepted' });
    });
    expect(await screen.findByText(/Aceita pelo provedor/)).toBeTruthy();
  });

  it('falha preserva rascunho e o retry reutiliza a mesma chave', async () => {
    mocks.sendMessageMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ messageId: 'msg_2', conversationId: 'conv_1', status: 'sent', outcome: 'accepted' });

    renderInbox();
    await openConversation();
    sendWith('mensagem importante');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/conexão|enviar/i);
    expect((screen.getByLabelText('Mensagem') as HTMLInputElement).value).toBe('mensagem importante');

    const firstKey = idempotencyKeyOf(0);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    await waitFor(() => expect(mocks.sendMessageMock).toHaveBeenCalledTimes(2));
    expect(idempotencyKeyOf(1)).toBe(firstKey);
    expect(await screen.findByText(/Aceita pelo provedor/)).toBeTruthy();
  });

  it('falha definitiva do provedor não oferece retry e orienta nova intenção', async () => {
    mocks.sendMessageMock.mockResolvedValue({
      messageId: 'msg_failed',
      conversationId: 'conv_1',
      status: 'failed',
      outcome: 'failed',
    });

    renderInbox();
    await openConversation();
    sendWith('falha terminal');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/edite a mensagem/i);
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
    expect((screen.getByLabelText('Mensagem') as HTMLInputElement).value).toBe('falha terminal');
    expect(screen.getByRole('status', { name: 'Estado do envio' }).textContent).toMatch(/Falha no envio/);
  });

  it('conflito de chave (409) não oferece retry cego e preserva o rascunho', async () => {
    mocks.sendMessageMock.mockRejectedValue(Object.assign(
      new Error('Idempotency-Key reutilizada com payload incompatível'),
      { status: 409, code: 'IDEMPOTENCY_KEY_CONFLICT' }
    ));

    renderInbox();
    await openConversation();
    sendWith('conflito de chave');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/conflita|nova intenção/i);
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
    expect((screen.getByLabelText('Mensagem') as HTMLInputElement).value).toBe('conflito de chave');
  });

  it('MEDIA_ASSET_REQUIRED tem alerta específico e recuperação reenviando a mesma intenção', async () => {
    mocks.sendMessageMock
      .mockRejectedValueOnce(Object.assign(
        new Error('Envio de mídia exige mediaAssetId obtido no upload dedicado'),
        { status: 400, code: 'MEDIA_ASSET_REQUIRED' }
      ))
      .mockResolvedValueOnce({ messageId: 'msg_asset', conversationId: 'conv_1', status: 'sent', outcome: 'accepted' });

    renderInbox();
    await openConversation();
    attachFile(new File([new Uint8Array([1, 2, 3])], 'foto.png', { type: 'image/png' }));
    sendWith('com anexo');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/referência do upload/i);
    expect(mocks.uploadMediaMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    await waitFor(() => expect(mocks.sendMessageMock).toHaveBeenCalledTimes(2));
    expect(idempotencyKeyOf(1)).toBe(idempotencyKeyOf(0));
    expect(mocks.uploadMediaMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Aceita pelo provedor/)).toBeTruthy();
  });

  it('anexa por upload binário dedicado e referencia o asset no envio, nunca data-URL', async () => {
    const readAsDataURL = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    mocks.sendMessageMock.mockResolvedValue({
      messageId: 'msg_3',
      conversationId: 'conv_1',
      status: 'sent',
      outcome: 'accepted',
    });

    renderInbox();
    await openConversation();
    const file = new File([new Uint8Array([1, 2, 3])], 'foto.png', { type: 'image/png' });
    attachFile(file);
    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'segue foto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    await waitFor(() => expect(mocks.uploadMediaMock).toHaveBeenCalledTimes(1));
    expect(mocks.uploadMediaMock.mock.calls[0][0]).toBe('conv_1');
    expect((mocks.uploadMediaMock.mock.calls[0][1] as File).name).toBe('foto.png');

    await waitFor(() => expect(mocks.sendMessageMock).toHaveBeenCalledTimes(1));
    const payload = mocks.sendMessageMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.mediaAssetId).toBe('asset_1');
    expect(payload.mediaUrl).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('data:');
    expect(readAsDataURL).not.toHaveBeenCalled();

    await screen.findByText(/Aceita pelo provedor/);
    expect(screen.queryByText(/foto\.png/)).toBeNull();
  });

  it('413 preserva anexo, mostra erro acessível e não permite retry cego', async () => {
    mocks.uploadMediaMock.mockRejectedValue(Object.assign(
      new Error('Conteúdo excede o limite de 16777216 bytes'),
      { status: 413, code: 'PAYLOAD_TOO_LARGE', recoverable: true }
    ));

    renderInbox();
    await openConversation();
    attachFile(new File([new Uint8Array([1, 2, 3])], 'foto.png', { type: 'image/png' }));
    sendWith('legenda');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/16 MiB/);
    expect(screen.getByText(/foto\.png/)).toBeTruthy();
    expect(mocks.sendMessageMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
  });

  it('recusa na seleção arquivo acima de 16 MiB e aceita exatamente o limite', async () => {
    renderInbox();
    await openConversation();

    const tooBig = new File(
      [new ArrayBuffer(16 * 1024 * 1024 + 1)],
      'grande.png',
      { type: 'image/png' }
    );
    attachFile(tooBig);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/16 MiB/);
    expect(document.querySelector('.file-bar')).toBeNull();

    const exact = new File([new ArrayBuffer(16 * 1024 * 1024)], 'limite.png', { type: 'image/png' });
    attachFile(exact);
    expect(await screen.findByText(/limite\.png/)).toBeTruthy();
  });

  it('troca de conversa durante a resposta não corrompe o compositor', async () => {
    mocks.conversationListMock.mockResolvedValue({
      conversations: [
        makeConversation(),
        makeConversation({ id: 'conv_2', contactId: 'contact_2', contactName: 'João Souza', contactPhone: '5511988887777' }),
      ],
      nextCursor: null,
    });
    let resolveSend: (value: unknown) => void = () => {};
    mocks.sendMessageMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveSend = resolve; })
    );

    renderInbox();
    await openConversation('Maria Silva');
    sendWith('para Maria');
    await waitFor(() => expect(mocks.sendMessageMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('João Souza'));
    fireEvent.change(await screen.findByLabelText('Mensagem'), { target: { value: 'rascunho do João' } });

    await act(async () => {
      resolveSend({ messageId: 'msg_4', conversationId: 'conv_1', status: 'sent', outcome: 'accepted' });
    });

    await waitFor(() => {
      expect((screen.getByLabelText('Mensagem') as HTMLInputElement).value).toBe('rascunho do João');
    });
    expect(screen.queryByText(/Aceita pelo provedor/)).toBeNull();

    fireEvent.click(screen.getByText('Maria Silva'));
    await waitFor(() => {
      expect((screen.getByLabelText('Mensagem') as HTMLInputElement).value).toBe('');
    });
    expect(await screen.findByText(/Aceita pelo provedor/)).toBeTruthy();
  });

  it('carrega histórico anterior pelo cursor sem controle fictício', async () => {
    const newest = makeMessage({ id: 'msg_3', content: 'recente', direction: 'outbound', createdAt: '2026-04-10T12:10:00.000Z' });
    const older = makeMessage({ id: 'msg_2', content: 'anterior', createdAt: '2026-04-10T11:00:00.000Z' });
    mocks.conversationMessagesMock
      .mockResolvedValueOnce({ messages: [newest], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ messages: [older], nextCursor: null });

    renderInbox();
    await openConversation();
    expect(await screen.findByText('recente')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'Carregar mensagens anteriores' }));
    expect(await screen.findByText('anterior')).toBeTruthy();

    await waitFor(() => expect(mocks.conversationMessagesMock).toHaveBeenCalledTimes(2));
    expect(mocks.conversationMessagesMock.mock.calls[1][0]).toBe('conv_1');
    expect(mocks.conversationMessagesMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({ cursor: 'cursor-1' })
    );
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Carregar mensagens anteriores' })).toBeNull();
    });
  });

  it('não pede limit acima de 100 e encerra a janela com explicação ao bater o teto', async () => {
    const initial = Array.from({ length: 50 }, (_, index) => makeMessage({
      id: `page1-${index}`,
      content: `recente ${index}`,
      direction: index % 2 === 0 ? 'inbound' : 'outbound',
      createdAt: new Date(Date.UTC(2026, 3, 10, 12, 0, index)).toISOString(),
    }));
    const older = Array.from({ length: 100 }, (_, index) => makeMessage({
      id: `page2-${index}`,
      content: `antiga ${index}`,
      direction: 'inbound',
      createdAt: new Date(Date.UTC(2026, 3, 9, 12, 0, index)).toISOString(),
    }));
    mocks.conversationMessagesMock
      .mockResolvedValueOnce({ messages: initial, nextCursor: null })
      .mockResolvedValueOnce({ messages: older, nextCursor: null });

    renderInbox();
    await openConversation();
    expect(await screen.findByText('recente 0')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'Carregar mensagens anteriores' }));
    expect(await screen.findByText('antiga 0')).toBeTruthy();

    await waitFor(() => expect(mocks.conversationMessagesMock).toHaveBeenCalledTimes(2));
    const requestedLimits = mocks.conversationMessagesMock.mock.calls.map(([, options]) => (
      (options as { limit?: number } | undefined)?.limit ?? 50
    ));
    expect(Math.max(...requestedLimits)).toBeLessThanOrEqual(100);
    expect(requestedLimits[1]).toBe(100);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Carregar mensagens anteriores' })).toBeNull();
    });
    expect(screen.getByText(/limite de 100 mensagens por requisição/)).toBeTruthy();
    expect(mocks.conversationMessagesMock).toHaveBeenCalledTimes(2);
  });

  it('recupera envio offline com a mesma chave quando a conexão volta', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    mocks.sendMessageMock.mockResolvedValue({
      messageId: 'msg_5',
      conversationId: 'conv_1',
      status: 'sent',
      outcome: 'accepted',
    });

    renderInbox();
    await openConversation();
    sendWith('voltei');

    expect(mocks.sendMessageMock).not.toHaveBeenCalled();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Sem conexão/i);

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    fireEvent(window, new Event('online'));

    await waitFor(() => expect(mocks.sendMessageMock).toHaveBeenCalledTimes(1));
    expect(typeof idempotencyKeyOf(0)).toBe('string');
    expect(await screen.findByText(/Aceita pelo provedor/)).toBeTruthy();
  });

  it('mostra pendente e reconcilia para aceita quando o histórico confirma', async () => {
    mocks.sendMessageMock.mockResolvedValue({
      messageId: 'msg_6',
      conversationId: 'conv_1',
      status: 'pending',
      outcome: 'pending',
    });

    renderInbox();
    await openConversation();
    sendWith('pendente');

    expect(await screen.findByText(/Pendente/)).toBeTruthy();

    mocks.conversationMessagesMock.mockResolvedValue({
      messages: [makeMessage({
        id: 'msg_6',
        content: 'pendente',
        direction: 'outbound',
        status: 'sent',
        createdAt: '2026-04-10T12:15:00.000Z',
      })],
      nextCursor: null,
    });

    const handlers = mocks.subscribeHandlers.get('message.persisted') ?? [];
    await act(async () => {
      for (const handler of handlers) {
        await handler({ payload: { conversationId: 'conv_1' } });
      }
    });

    expect(await screen.findByText(/Aceita pelo provedor|Entregue/)).toBeTruthy();
  });

  it('reconciliação de falha definitiva no histórico não oferece retry e edição cria nova chave', async () => {
    mocks.sendMessageMock
      .mockResolvedValueOnce({ messageId: 'msg_recon', conversationId: 'conv_1', status: 'pending', outcome: 'pending' })
      .mockResolvedValueOnce({ messageId: 'msg_edited', conversationId: 'conv_1', status: 'sent', outcome: 'accepted' });

    renderInbox();
    await openConversation();
    sendWith('pendente que falha');
    expect(await screen.findByText(/Pendente/)).toBeTruthy();

    mocks.conversationMessagesMock.mockResolvedValue({
      messages: [makeMessage({
        id: 'msg_recon',
        content: 'pendente que falha',
        direction: 'outbound',
        status: 'failed',
        createdAt: '2026-04-10T12:20:00.000Z',
      })],
      nextCursor: null,
    });

    const handlers = mocks.subscribeHandlers.get('message.persisted') ?? [];
    await act(async () => {
      for (const handler of handlers) {
        await handler({ payload: { conversationId: 'conv_1' } });
      }
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/edite a mensagem/i);
    expect(screen.getByRole('status', { name: 'Estado do envio' }).textContent).toMatch(/Falha no envio/);
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
    expect((screen.getByLabelText('Mensagem') as HTMLInputElement).value).toBe('pendente que falha');

    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'pendente que falha (editada)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    await waitFor(() => expect(mocks.sendMessageMock).toHaveBeenCalledTimes(2));
    expect(idempotencyKeyOf(1)).not.toBe(idempotencyKeyOf(0));
    expect(await screen.findByText(/Aceita pelo provedor/)).toBeTruthy();
  });

  it('rascunho por conversa sobrevive à troca de conversa', async () => {
    mocks.conversationListMock.mockResolvedValue({
      conversations: [
        makeConversation(),
        makeConversation({ id: 'conv_2', contactId: 'contact_2', contactName: 'João Souza', contactPhone: '5511988887777' }),
      ],
      nextCursor: null,
    });

    renderInbox();
    await openConversation('Maria Silva');
    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'rascunho Maria' } });

    fireEvent.click(screen.getByText('João Souza'));
    await screen.findByLabelText('Mensagem');
    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'rascunho João' } });

    fireEvent.click(screen.getByText('Maria Silva'));
    await waitFor(() => {
      expect((screen.getByLabelText('Mensagem') as HTMLInputElement).value).toBe('rascunho Maria');
    });
  });
});
