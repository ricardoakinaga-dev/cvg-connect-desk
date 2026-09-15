import type { Err, Ok, Result } from '@cvg/shared';
import { AppError } from '@cvg/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { initializeSecretaryClient } from '@cvg/integrations';
import { invokeSecretary } from '../application/use-cases/invoke-secretary.use-case';
import { publishSecretaryInvocation } from '../application/use-cases/secretary-publisher';

vi.mock('../application/use-cases/secretary-publisher', () => ({
  publishSecretaryInvocation: vi.fn().mockResolvedValue(undefined),
}));

const countConversationInvocationsMock = vi.hoisted(() => vi.fn());

vi.mock('../infrastructure/repositories/secretary-invocation.repository', () => ({
  countConversationInvocations: countConversationInvocationsMock,
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

function assertOk<T, E>(result: Result<T, E>): asserts result is Ok<T, E> {
  expect(result.isOk()).toBe(true);
}

function assertErr<T>(result: Result<T, AppError>): asserts result is Err<T, AppError> {
  expect(result.isErr()).toBe(true);
}

describe('Secretary adapter integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    countConversationInvocationsMock.mockImplementation(async (conversationId: string) => {
      if (conversationId === 'nao-e-uuid') {
        throw new Error('invalid conversation id');
      }
      return 0;
    });
    vi.mocked(publishSecretaryInvocation).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds the request payload and parses a successful Secretary response', async () => {
    const conversationId = randomUUID();
    const mock = await createSecretaryMockServer(async (request) => {
      expect(request.method).toBe('POST');
      expect(request.url).toBe('/invoke');
      expect(request.headers.authorization).toBe('Bearer secretary-test-key');
      expect(request.headers['idempotency-key']).toBe('inbound:msg-001');
      expect(request.body).toMatchObject({
        action: 'classify',
        conversation_id: conversationId,
        message_id: 'msg-001',
        invocation_id: 'inbound:msg-001',
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
      conversationId,
      messageId: 'msg-001',
      action: 'classify',
      invocationId: 'inbound:msg-001',
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

    assertOk(result);
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
        conversationId,
        messageId: 'msg-001',
        action: 'classify',
        status: 'requested',
      })
    );
    expect(vi.mocked(publishSecretaryInvocation)).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        conversationId,
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
    const conversationId = randomUUID();
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
      conversationId,
      action: 'classify',
      content: 'Mensagem inválida',
      sender: '+5511999999999',
    });

    await mock.close();

    assertErr(result);
    expect(result.error.message).toBe('Invalid response format from Secretary');
    expect(result.error.code).toBe('SECRETARY_INVALID_RESPONSE');
    expect(publishSecretaryInvocation).toHaveBeenCalledTimes(2);
    expect(vi.mocked(publishSecretaryInvocation)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        conversationId,
        status: 'failed',
        errorMessage: 'Invalid response format',
      })
    );
  });

  it('returns an error when the Secretary API times out', async () => {
    const conversationId = randomUUID();
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
      conversationId,
      action: 'classify',
      content: 'Mensagem lenta',
      sender: '+5511888888888',
    });

    await mock.close();

    assertErr(result);
    expect(result.error.message).toBe('Secretary request timed out');
    expect(result.error.code).toBe('SECRETARY_TIMEOUT');
    expect(publishSecretaryInvocation).toHaveBeenCalledTimes(2);
    expect(vi.mocked(publishSecretaryInvocation)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        conversationId,
        status: 'failed',
        errorMessage: 'Secretary request timed out',
      })
    );
  });

  it('returns an error when the Secretary API responds with HTTP failure', async () => {
    const conversationId = randomUUID();
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
      conversationId,
      action: 'classify',
      content: 'Mensagem com erro HTTP',
      sender: '+5511777777777',
    });

    await mock.close();

    assertErr(result);
    expect(result.error.message).toBe('Secretary API error: 500');
    expect(result.error.code).toBe('SECRETARY_ERROR');
    expect(publishSecretaryInvocation).toHaveBeenCalledTimes(2);
    expect(vi.mocked(publishSecretaryInvocation)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        conversationId,
        status: 'failed',
        errorMessage: 'Secretary API error: 500',
      })
    );
  });

  it('embrulha erro desconhecido no catch como SECRETARY_ERROR 500', async () => {
    const mock = await createSecretaryMockServer(async () => ({
      statusCode: 200,
      body: { success: true, response: 'ok', action: 'respond' },
    }));

    initializeSecretaryClient({
      baseUrl: mock.url,
      apiKey: 'secretary-test-key',
      timeout: 1000,
    });

    vi.mocked(publishSecretaryInvocation)
      .mockResolvedValueOnce(undefined) // status 'requested' (antes do try)
      .mockImplementationOnce(() => {
        throw new Error('broker down'); // status 'success' (dentro do try)
      })
      .mockResolvedValueOnce(undefined); // status 'failed' (catch)

    const result = await invokeSecretary({
      conversationId: randomUUID(),
      action: 'classify',
      content: 'Mensagem que publica com falha inesperada',
      sender: '+5511666666666',
    });

    await mock.close();

    assertErr(result);
    expect(result.error).toBeInstanceOf(AppError);
    expect(result.error.statusCode).toBe(500);
    expect(result.error.code).toBe('SECRETARY_ERROR');
    expect(result.error.message).toBe('broker down');
  });

  it('preserva AppError lançado dentro do try (passthrough do catch)', async () => {
    const mock = await createSecretaryMockServer(async () => ({
      statusCode: 200,
      body: { success: true, response: 'ok', action: 'respond' },
    }));

    initializeSecretaryClient({
      baseUrl: mock.url,
      apiKey: 'secretary-test-key',
      timeout: 1000,
    });

    const brokerError = new AppError('broker down', 503, 'BROKER_DOWN');
    vi.mocked(publishSecretaryInvocation)
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => {
        throw brokerError;
      })
      .mockResolvedValueOnce(undefined);

    const result = await invokeSecretary({
      conversationId: randomUUID(),
      action: 'classify',
      content: 'Mensagem que publica AppError',
      sender: '+5511555555555',
    });

    await mock.close();

    assertErr(result);
    expect(result.error).toBe(brokerError);
  });

  it('nega por policy (conteúdo acima do budget) com AI_POLICY_DENIED 403', async () => {
    initializeSecretaryClient({
      baseUrl: 'http://127.0.0.1:9/never-called',
      apiKey: 'secretary-test-key',
      timeout: 1000,
    });

    const result = await invokeSecretary({
      conversationId: randomUUID(),
      action: 'classify',
      content: 'x'.repeat(4001),
      sender: '+5511444444444',
    });

    assertErr(result);
    expect(result.error.statusCode).toBe(403);
    expect(result.error.code).toBe('AI_POLICY_DENIED');
    expect(result.error.message).toMatch(/content exceeds/);
    expect(vi.mocked(publishSecretaryInvocation)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'failed',
        metadata: expect.objectContaining({ policyDenied: true }),
      })
    );
  });

  it('resposta success=false vira Err(SECRETARY_ERROR) e publica status failed', async () => {
    const conversationId = randomUUID();
    const mock = await createSecretaryMockServer(async () => ({
      statusCode: 200,
      body: { success: false, error: 'resposta recusada pelo secretary' },
    }));

    initializeSecretaryClient({
      baseUrl: mock.url,
      apiKey: 'secretary-test-key',
      timeout: 1000,
    });

    const result = await invokeSecretary({
      conversationId,
      action: 'classify',
      content: 'Conteúdo recusado',
      sender: '+5511333333333',
    });

    await mock.close();

    assertErr(result);
    expect(result.error.statusCode).toBe(500);
    expect(result.error.code).toBe('SECRETARY_ERROR');
    expect(result.error.message).toBe('resposta recusada pelo secretary');
    expect(vi.mocked(publishSecretaryInvocation)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        conversationId,
        status: 'failed',
        errorMessage: 'resposta recusada pelo secretary',
      })
    );
  });

  it('nega por budget indisponível (DB) SEM chamar a Secretary — fail-closed', async () => {
    const mock = await createSecretaryMockServer(async () => ({
      statusCode: 200,
      body: { success: true, response: 'não deveria ser chamada' },
    }));

    initializeSecretaryClient({
      baseUrl: mock.url,
      apiKey: 'secretary-test-key',
      timeout: 1000,
    });

    // Conversa inválida ⇒ o contador durável (uuid) falha no PG; a policy NÃO
    // pode liberar a chamada sem contador confiável.
    const result = await invokeSecretary({
      conversationId: 'nao-e-uuid',
      action: 'classify',
      content: 'conteudo',
      sender: '+5511000000000',
    });

    await mock.close();

    assertErr(result);
    expect(result.error.statusCode).toBe(403);
    expect(result.error.code).toBe('AI_POLICY_DENIED');
    expect(result.error.message).toMatch(/budget store unavailable/);
    expect(mock.requests).toHaveLength(0);
    expect(vi.mocked(publishSecretaryInvocation)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'failed',
        metadata: expect.objectContaining({ policyDenied: true }),
      })
    );
  });
});
