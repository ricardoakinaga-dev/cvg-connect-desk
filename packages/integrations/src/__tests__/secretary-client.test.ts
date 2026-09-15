import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecretaryClient } from '../secretary-client';

describe('SecretaryClient idempotency contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SECRETARY_MAX_RETRIES;
  });

  it('sends the stable invocation key in header and body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, response: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new SecretaryClient({
      baseUrl: 'http://secretary.test/',
      apiKey: 'secret',
    }).invoke({
      action: 'classify',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      invocationId: ' inbound:message-1 ',
      context: { content: 'hello' },
    });

    expect(result.isOk()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.headers).toMatchObject({ 'Idempotency-Key': 'inbound:message-1' });
    expect(JSON.parse(String(options.body))).toMatchObject({
      conversation_id: 'conversation-1',
      message_id: 'message-1',
      invocation_id: 'inbound:message-1',
    });
  });

  it('does not retry an ambiguous response when the key is absent', async () => {
    process.env.SECRETARY_MAX_RETRIES = '3';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('unavailable', { status: 503 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new SecretaryClient({
      baseUrl: 'http://secretary.test',
      apiKey: 'secret',
    }).invoke({
      action: 'classify',
      conversationId: 'conversation-1',
      context: { content: 'hello' },
    });

    expect(result.isErr()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
