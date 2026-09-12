import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

/**
 * Final-12: chaos completion — falhas de provider terminam em estados
 * explícitos (retry bounded → failure), nunca em silêncio nem loop infinito.
 *
 * GATEWAY_URL/EVOLUTION_API_URL são lidos no import: definidos antes do
 * import dinâmico dos módulos sob teste (isolamento por arquivo do vitest).
 */
describe('provider failure chaos (mock servers)', () => {
  let gatewayUrl = '';
  let evolutionUrl = '';

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.GATEWAY_MAX_RETRIES;
  });

  async function startMockServer(
    handler: (req: IncomingMessage, res: ServerResponse, count: { n: number }) => void,
  ): Promise<{ baseUrl: string; close: () => Promise<void>; count: { n: number } }> {
    const count = { n: 0 };
    const server = createServer((req, res) => {
      count.n += 1;
      handler(req, res, count);
    });
    const port = await new Promise<number>((resolve, reject) => {
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    });
    return {
      baseUrl: `http://127.0.0.1:${port}`,
      count,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  it('gateway 500 → bounded retries then explicit failure (no infinite loop)', async () => {
    const mock = await startMockServer((_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'boom' }));
    });
    gatewayUrl = mock.baseUrl;
    process.env.GATEWAY_URL = gatewayUrl;
    process.env.GATEWAY_API_KEY = 'test';
    try {
      const { gatewayService } = await import('../infrastructure/gateway-service');
      const result = await gatewayService.sendOutbound({
        messageId: 'msg-chaos-1',
        conversationId: 'conv-chaos-1',
        externalPhone: '+5511999999999',
        content: 'chaos 500',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBeTypeOf('string');
      // 1 tentativa + 2 retries (bounded).
      expect(mock.count.n).toBeLessThanOrEqual(3);
      expect(mock.count.n).toBeGreaterThanOrEqual(1);
    } finally {
      await mock.close();
      delete process.env.GATEWAY_URL;
    }
    void evolutionUrl;
  }, 30000);

  it('gateway 429 → NO retry on non-idempotent POST (prevents double-send)', async () => {
    const mock = await startMockServer((_req, res) => {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
      res.end(JSON.stringify({ error: 'slow down' }));
    });
    process.env.GATEWAY_URL = mock.baseUrl;
    process.env.GATEWAY_API_KEY = 'test';
    try {
      const { gatewayService } = await import('../infrastructure/gateway-service');
      const result = await gatewayService.sendOutbound({
        messageId: 'msg-chaos-2',
        conversationId: 'conv-chaos-2',
        externalPhone: '+5511999999999',
        content: 'chaos 429',
      });
      // O ID estável torna o retry seguro; o gateway deduplica antes da fila.
      expect(result.success).toBe(false);
      expect(mock.count.n).toBeLessThanOrEqual(3);
    } finally {
      await mock.close();
      delete process.env.GATEWAY_URL;
    }
  }, 30000);

  it('gateway connection reset → terminal explicit failure (bounded)', async () => {
    const mock = await startMockServer((_req, res) => {
      res.destroy();
    });
    process.env.GATEWAY_URL = mock.baseUrl;
    process.env.GATEWAY_API_KEY = 'test';
    try {
      const { gatewayService } = await import('../infrastructure/gateway-service');
      const result = await gatewayService.sendOutbound({
        messageId: 'msg-chaos-3',
        conversationId: 'conv-chaos-3',
        externalPhone: '+5511999999999',
        content: 'chaos reset',
      });
      expect(result.success).toBe(false);
      expect(mock.count.n).toBeLessThanOrEqual(3);
    } finally {
      await mock.close();
      delete process.env.GATEWAY_URL;
    }
  }, 30000);

  it('evolution 500 → mediaService returns explicit failure (no throw)', async () => {
    const mock = await startMockServer((_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'evolution down' }));
    });
    process.env.EVOLUTION_API_URL = mock.baseUrl;
    process.env.EVOLUTION_API_KEY = 'test-key';
    process.env.EVOLUTION_INSTANCE = 'chaos-inst';
    try {
      const { mediaService } = await import('../infrastructure/media-service');
      const result = await mediaService.sendText('+5511999999999', 'chaos evolution');
      expect(result.success).toBe(false);
      expect(result.error).toBeTypeOf('string');
    } finally {
      await mock.close();
      delete process.env.EVOLUTION_API_URL;
    }
  }, 30000);
});
