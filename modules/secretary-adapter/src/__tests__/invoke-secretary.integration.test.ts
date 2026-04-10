import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { initializeSecretaryClient } from '@cvg/integrations';
import { invokeSecretary } from '../application/use-cases/invoke-secretary.use-case';
import { publishSecretaryInvocation } from '../application/use-cases/secretary-publisher';

vi.mock('../application/use-cases/secretary-publisher', () => ({
  publishSecretaryInvocation: vi.fn().mockResolvedValue(undefined),
}));

type SecretaryMockRequest = {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  body: unknown;
  rawBody: string;
};

type SecretaryMockResponse = {
  statusCode: number;
  body?: unknown;
  delayMs?: number;
};

type SecretaryResponder = (request: SecretaryMockRequest) => SecretaryMockResponse | Promise<SecretaryMockResponse>;

async function createSecretaryMockServer(responder: SecretaryResponder) {
  const requests: SecretaryMockRequest[] = [];

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const rawBody = Buffer.concat(chunks).toString('utf8');
    const body = rawBody ? JSON.parse(rawBody) : undefined;
    const request: SecretaryMockRequest = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body,
      rawBody,
    };
    requests.push(request);

    const response = await responder(request);

    if (response.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, response.delayMs));
    }

    res.statusCode = response.statusCode;
    res.setHeader('content-type', 'application/json');
    res.end(response.body === undefined ? '' : JSON.stringify(response.body));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;

  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

describe('Secretary adapter integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds the request payload and parses a successful Secretary response', async () => {
    const mock = await createSecretaryMockServer(async (request) => {
      expect(request.method).toBe('POST');
      expect(request.url).toBe('/invoke');
      expect(request.headers.authorization).toBe('Bearer secretary-test-key');
      expect(request.body).toMatchObject({
        action: 'classify',
        conversation_id: 'conv-001',
        message_id: 'msg-001',
        context: {
          content: 'Cliente pediu retorno sobre exame',
          sender: '+5511988887777',
          conversationHistory: [
            { role: 'user', content: 'Olá' },
            { role: 'assistant', content: 'Posso ajudar' },
          ],
          contactInfo: {
            name: 'Ana',
            phone: '+5511988887777',
            tutorId: 'tutor-123',
            patientId: 'patient-456',
          },
        },
      });

      return {
        statusCode: 200,
        body: {
          success: true,
          response: 'Classificação concluída',
          action: 'respond',
          classification: {
            category: 'commercial',
            priority: 'medium',
            confidence: 0.86,
          },
          metadata: {
            model: 'secretary-v1',
          },
        },
      };
    });

    initializeSecretaryClient({
      baseUrl: mock.url,
      apiKey: 'secretary-test-key',
      timeout: 1000,
    });

    const result = await invokeSecretary({
      conversationId: 'conv-001',
      messageId: 'msg-001',
      action: 'classify',
      content: 'Cliente pediu retorno sobre exame',
      sender: '+5511988887777',
      conversationHistory: [
        { role: 'user', content: 'Olá' },
        { role: 'assistant', content: 'Posso ajudar' },
      ],
      contactName: 'Ana',
      contactPhone: '+5511988887777',
      tutorId: 'tutor-123',
      patientId: 'patient-456',
    });

    await mock.close();

    expect(result.isOk()).toBe(true);
    expect(result.value).toMatchObject({
      success: true,
      response: 'Classificação concluída',
      shouldHandoff: false,
      classification: {
        category: 'commercial',
        priority: 'medium',
        confidence: 0.86,
      },
      metadata: {
        model: 'secretary-v1',
      },
    });
    expect(publishSecretaryInvocation).toHaveBeenCalledTimes(2);
    expect(vi.mocked(publishSecretaryInvocation)).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        conversationId: 'conv-001',
        messageId: 'msg-001',
        action: 'classify',
        status: 'requested',
      })
    );
    expect(vi.mocked(publishSecretaryInvocation)).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        conversationId: 'conv-001',
        messageId: 'msg-001',
        action: 'classify',
        status: 'success',
        metadata: {
          model: 'secretary-v1',
        },
      })
    );
  });

  it('returns an error when the Secretary responds with an invalid payload', async () => {
    const mock = await createSecretaryMockServer(async () => ({
      statusCode: 200,
      body: {
        success: true,
        response: 42,
      },
    }));

    initializeSecretaryClient({
      baseUrl: mock.url,
      apiKey: 'secretary-test-key',
      timeout: 1000,
    });

    const result = await invokeSecretary({
      conversationId: 'conv-002',
      action: 'classify',
      content: 'Mensagem inválida',
      sender: '+5511999999999',
    });

    await mock.close();

    expect(result.isErr()).toBe(true);
    expect(result.error.message).toBe('Invalid response format from Secretary');
    expect(result.error.code).toBe('SECRETARY_INVALID_RESPONSE');
    expect(publishSecretaryInvocation).toHaveBeenCalledTimes(2);
    expect(vi.mocked(publishSecretaryInvocation)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        conversationId: 'conv-002',
        status: 'failed',
        errorMessage: 'Invalid response format',
      })
    );
  });

  it('returns an error when the Secretary API times out', async () => {
    const mock = await createSecretaryMockServer(async () => ({
      statusCode: 200,
      delayMs: 200,
      body: {
        success: true,
        response: 'vai demorar',
      },
    }));

    initializeSecretaryClient({
      baseUrl: mock.url,
      apiKey: 'secretary-test-key',
      timeout: 25,
    });

    const result = await invokeSecretary({
      conversationId: 'conv-003',
      action: 'classify',
      content: 'Mensagem lenta',
      sender: '+5511888888888',
    });

    await mock.close();

    expect(result.isErr()).toBe(true);
    expect(result.error.message).toBe('Secretary request timed out');
    expect(result.error.code).toBe('SECRETARY_TIMEOUT');
    expect(publishSecretaryInvocation).toHaveBeenCalledTimes(2);
    expect(vi.mocked(publishSecretaryInvocation)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        conversationId: 'conv-003',
        status: 'failed',
        errorMessage: 'Secretary request timed out',
      })
    );
  });

  it('returns an error when the Secretary API responds with HTTP failure', async () => {
    const mock = await createSecretaryMockServer(async () => ({
      statusCode: 500,
      body: {
        error: 'internal error',
      },
    }));

    initializeSecretaryClient({
      baseUrl: mock.url,
      apiKey: 'secretary-test-key',
      timeout: 1000,
    });

    const result = await invokeSecretary({
      conversationId: 'conv-004',
      action: 'classify',
      content: 'Mensagem com erro HTTP',
      sender: '+5511777777777',
    });

    await mock.close();

    expect(result.isErr()).toBe(true);
    expect(result.error.message).toBe('Secretary API error: 500');
    expect(result.error.code).toBe('SECRETARY_ERROR');
    expect(publishSecretaryInvocation).toHaveBeenCalledTimes(2);
    expect(vi.mocked(publishSecretaryInvocation)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        conversationId: 'conv-004',
        status: 'failed',
        errorMessage: 'Secretary API error: 500',
      })
    );
  });
});
