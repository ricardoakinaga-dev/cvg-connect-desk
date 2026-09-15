import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

/**
 * AAA-12 / C04 — provider sem idempotência exige reconciliação explícita.
 *
 *  - falha ambígua (timeout/reset/5xx) é classificada `unknown`; nunca é
 *    prometido exactly-once externo;
 *  - rejeição explícita 4xx é `definitive`;
 *  - com `GATEWAY_PROVIDER_IDEMPOTENCY=false` não existe retry automático;
 *  - com idempotência, o `event_id` é estável entre tentativas (o gateway
 *    reivindica a chave antes da fila).
 *
 * Servidores HTTP reais em loopback; env definido antes do import dinâmico.
 */
describe('gateway provider reconciliation (mock servers)', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.GATEWAY_MAX_RETRIES;
    delete process.env.GATEWAY_PROVIDER_IDEMPOTENCY;
  });

  async function startMockServer(
    handler: (req: IncomingMessage, res: ServerResponse, count: { n: number }, bodies: string[]) => void,
  ): Promise<{ baseUrl: string; close: () => Promise<void>; count: { n: number }; bodies: string[] }> {
    const count = { n: 0 };
    const bodies: string[] = [];
    const server = createServer((req, res) => {
      count.n += 1;
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        bodies.push(body);
        handler(req, res, count, bodies);
      });
    });
    const port = await new Promise<number>((resolve, reject) => {
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    });
    return {
      baseUrl: `http://127.0.0.1:${port}`,
      count,
      bodies,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  it('5xx persistente ⇒ failureKind unknown (pode ter aceitado; reconciliação)', async () => {
    const mock = await startMockServer((_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'boom' }));
    });
    process.env.GATEWAY_URL = mock.baseUrl;
    process.env.GATEWAY_API_KEY = 'test';
    try {
      const { gatewayService } = await import('../infrastructure/gateway-service');
      const result = await gatewayService.sendOutbound({
        messageId: 'msg-a12-500',
        conversationId: 'conv-a12-500',
        externalPhone: '+5511999999999',
        content: 'server down',
      });
      expect(result.success).toBe(false);
      expect(result.failureKind).toBe('unknown');
    } finally {
      await mock.close();
      delete process.env.GATEWAY_URL;
    }
  }, 30000);

  it('resposta 400 explícita ⇒ failureKind definitive', async () => {
    const mock = await startMockServer((_req, res) => {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad payload' }));
    });
    process.env.GATEWAY_URL = mock.baseUrl;
    process.env.GATEWAY_API_KEY = 'test';
    try {
      const { gatewayService } = await import('../infrastructure/gateway-service');
      const result = await gatewayService.sendOutbound({
        messageId: 'msg-a12-400',
        conversationId: 'conv-a12-400',
        externalPhone: '+5511999999999',
        content: 'bad payload',
      });
      expect(result.success).toBe(false);
      expect(result.failureKind).toBe('definitive');
      expect(mock.count.n).toBe(1);
    } finally {
      await mock.close();
      delete process.env.GATEWAY_URL;
    }
  }, 30000);

  it('reset de conexão ⇒ failureKind unknown (aceite desconhecido)', async () => {
    const mock = await startMockServer((_req, res) => {
      res.destroy();
    });
    process.env.GATEWAY_URL = mock.baseUrl;
    process.env.GATEWAY_API_KEY = 'test';
    try {
      const { gatewayService } = await import('../infrastructure/gateway-service');
      const result = await gatewayService.sendOutbound({
        messageId: 'msg-a12-reset',
        conversationId: 'conv-a12-reset',
        externalPhone: '+5511999999999',
        content: 'reset',
      });
      expect(result.success).toBe(false);
      expect(result.failureKind).toBe('unknown');
    } finally {
      await mock.close();
      delete process.env.GATEWAY_URL;
    }
  }, 30000);

  it('provider SEM idempotência ⇒ zero retry automático e capacidade declarada false', async () => {
    const mock = await startMockServer((_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'flaky' }));
    });
    process.env.GATEWAY_URL = mock.baseUrl;
    process.env.GATEWAY_API_KEY = 'test';
    process.env.GATEWAY_PROVIDER_IDEMPOTENCY = 'false';
    try {
      const { gatewayService } = await import('../infrastructure/gateway-service');
      expect(gatewayService.providerSupportsIdempotency()).toBe(false);
      const result = await gatewayService.sendOutbound({
        messageId: 'msg-a12-no-idem',
        conversationId: 'conv-a12-no-idem',
        externalPhone: '+5511999999999',
        content: 'no-idempotency',
      });
      expect(result.success).toBe(false);
      expect(result.failureKind).toBe('unknown');
      // Sem retry cego: exatamente UMA tentativa.
      expect(mock.count.n).toBe(1);
    } finally {
      await mock.close();
      delete process.env.GATEWAY_URL;
      delete process.env.GATEWAY_PROVIDER_IDEMPOTENCY;
    }
  }, 30000);

  it('provider COM idempotência ⇒ event_id estável entre tentativas', async () => {
    let seen = 0;
    const mock = await startMockServer((_req, res) => {
      seen += 1;
      if (seen < 3) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'warming' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'queued', operation_id: 'op-1' }));
    });
    process.env.GATEWAY_URL = mock.baseUrl;
    process.env.GATEWAY_API_KEY = 'test';
    process.env.GATEWAY_MAX_RETRIES = '2';
    try {
      const { gatewayService } = await import('../infrastructure/gateway-service');
      expect(gatewayService.providerSupportsIdempotency()).toBe(true);
      const result = await gatewayService.sendOutbound({
        messageId: 'msg-a12-idem',
        conversationId: 'conv-a12-idem',
        externalPhone: '+5511999999999',
        content: 'stable id',
      });
      expect(result.success).toBe(true);
      expect(mock.count.n).toBe(3);
      const eventIds = mock.bodies.map((body) => (JSON.parse(body) as { event_id: string }).event_id);
      expect(new Set(eventIds).size).toBe(1);
      expect(eventIds[0]).toBe('msg-a12-idem');
    } finally {
      await mock.close();
      delete process.env.GATEWAY_URL;
      delete process.env.GATEWAY_MAX_RETRIES;
    }
  }, 30000);
});
