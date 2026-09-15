import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiRequestError,
  MEDIA_MAX_BYTES,
  MESSAGES_MAX_LIMIT,
  conversationApi,
  mediaKindForFile,
} from '../lib/api';

type FetchCall = [string, RequestInit];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>): FetchCall {
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as FetchCall;
}

describe('aaa-13 — contrato de envio e anexos no cliente HTTP', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('envia Idempotency-Key no header e nunca no corpo JSON', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      messageId: 'msg_1',
      conversationId: 'conv_1',
      status: 'sent',
      outcome: 'accepted',
    }, 201));

    const payload: Record<string, unknown> = {
      conversationId: 'conv_1',
      content: 'Olá',
      recipient: '5511999999999',
    };
    Object.defineProperty(payload, 'idempotencyKey', {
      value: 'intent-key-1',
      enumerable: false,
      configurable: true,
    });

    const result = await conversationApi.sendMessage(payload as never);
    const [url, init] = lastCall(fetchMock);
    const headers = init.headers as Record<string, string>;

    expect(url).toBe('/messages');
    expect(init.method).toBe('POST');
    expect(headers['Idempotency-Key']).toBe('intent-key-1');
    expect(init.body).toBe(JSON.stringify({
      conversationId: 'conv_1',
      content: 'Olá',
      recipient: '5511999999999',
    }));
    expect(String(init.body)).not.toContain('intent-key-1');
    expect(result).toMatchObject({ messageId: 'msg_1', outcome: 'accepted' });
  });

  it('faz upload binário dedicado (octet-stream) com metadados e sem base64/data-URL', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      assetId: 'asset_9',
      mediaType: 'image',
      mimetype: 'image/png',
      filename: 'foto.png',
      sizeBytes: 3,
      scanStatus: 'CLEAN',
      storageStatus: 'stored',
    }, 201));

    const file = new File([new Uint8Array([1, 2, 3])], 'foto.png', { type: 'image/png' });
    const result = await conversationApi.uploadMedia('conv_9', file);
    const [url, init] = lastCall(fetchMock);
    const headers = init.headers as Record<string, string>;

    expect(url).toBe('/conversations/conv_9/media');
    expect(init.method).toBe('POST');
    expect(headers['Content-Type']).toBe('application/octet-stream');
    expect(headers['X-Media-Type']).toBe('image');
    expect(headers['X-Media-Mimetype']).toBe('image/png');
    expect(headers['X-Media-Filename']).toBe('foto.png');
    expect(init.body).toBe(file);
    expect(result).toMatchObject({ assetId: 'asset_9', scanStatus: 'CLEAN' });
  });

  it('recusa anexo acima de 16 MiB antes de qualquer requisição', async () => {
    const tooBig = new File(
      [new ArrayBuffer(MEDIA_MAX_BYTES + 1)],
      'grande.png',
      { type: 'image/png' },
    );

    await expect(conversationApi.uploadMedia('conv_1', tooBig)).rejects.toMatchObject({
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propaga 413 recuperável do servidor como ApiRequestError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: 'PAYLOAD_TOO_LARGE',
      message: 'Conteúdo excede o limite de 16777216 bytes',
      statusCode: 413,
      recoverable: true,
    }, 413));

    const file = new File([new Uint8Array([1])], 'ok.png', { type: 'image/png' });
    const error = await conversationApi.uploadMedia('conv_1', file).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      recoverable: true,
      retryable: false,
    });
  });

  it('classifica erro 5xx como ambíguo e 400 como definitivo', () => {
    expect(new ApiRequestError('falhou', { status: 500 }).ambiguous).toBe(true);
    expect(new ApiRequestError('falhou', { status: 503 }).ambiguous).toBe(true);
    expect(new ApiRequestError('falhou', { status: 0 }).ambiguous).toBe(true);
    expect(new ApiRequestError('falhou', { status: 409 }).ambiguous).toBe(false);
    expect(new ApiRequestError('falhou', { status: 413 }).recoverable).toBe(true);
  });

  it('pagina o histórico com cursor opaco preservando o limite', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      messages: [{ id: 'msg_1' }],
      nextCursor: 'cursor-next',
    }));

    const page = await conversationApi.getMessages('conv_1', { limit: 50, cursor: 'cursor-atual' });
    const [url] = lastCall(fetchMock);

    expect(url).toBe('/conversations/conv_1/messages?limit=50&cursor=cursor-atual');
    expect(page.nextCursor).toBe('cursor-next');
  });

  it('limita o page size do histórico ao máximo aceito (100) mesmo pedindo mais', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ messages: [], nextCursor: null }));

    await conversationApi.getMessages('conv_1', { limit: 150 });
    const [url] = lastCall(fetchMock);

    expect(url).toBe(`/conversations/conv_1/messages?limit=${MESSAGES_MAX_LIMIT}`);
  });

  it('pagina a lista de conversas com cursor e preserva o DTO legado', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      items: [{ id: 'conv_1' }],
      conversations: [{ id: 'conv_1' }],
      nextCursor: 'conv-cursor',
    }));

    const page = await conversationApi.list({ sectorId: 'sector-1', status: 'open', limit: 50, cursor: 'conv-cursor' });
    const [url] = lastCall(fetchMock);

    expect(url).toContain('sectorId=sector-1');
    expect(url).toContain('status=open');
    expect(url).toContain('limit=50');
    expect(url).toContain('cursor=conv-cursor');
    expect(page.conversations).toEqual([{ id: 'conv_1' }]);
    expect(page.nextCursor).toBe('conv-cursor');
  });

  it('mapeia o tipo de mídia a partir do mimetype', () => {
    expect(mediaKindForFile('image/png')).toBe('image');
    expect(mediaKindForFile('audio/ogg')).toBe('audio');
    expect(mediaKindForFile('video/mp4')).toBe('video');
    expect(mediaKindForFile('application/pdf')).toBe('document');
  });
});
