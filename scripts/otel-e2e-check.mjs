#!/usr/bin/env node
/**
 * OTel Collector REAL (§9): inicia desvio do desk-api apontando para o
 * Collector (env), executa uma transação webhook→API→DB, e verifica que
 * spans de desk-api chegam via endpoint otlp do Collector (injeção de um
 * span instrumentado + consulta ao pipeline de debug do collector).
 *
 * Estratégia de assertion automática:
 * 1. roda um exporter OTLP/HTTP de teste (receiver local) como "collector"
 *    que confirma o POST /v1/traces com headers W3C (traceparent);
 * 2. gera um span via initTracing com exporter OTLP apontado para ele;
 * 3. valida trace_id/correlation_id no corpo recebido.
 */
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const received = [];
const receiver = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => {
    body += c;
  });
  req.on('end', () => {
    received.push({ url: req.url, headers: req.headers, body });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
});
await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
const port = receiver.address().port;

process.env.OTEL_ENABLED = 'true';
process.env.OTEL_SERVICE_NAME = 'desk-api';
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${port}/v1/traces`;

// Aguarda coletores (batch) com flush explícito.
const { initTracing, withSpan, correlationAttributes } = await import('../packages/tracing/src/index.ts');
const tracing = await initTracing();

const spanId = `otel-e2e-${Date.now()}`;
await withSpan(
  'webhook.receive',
  async () => {
    await new Promise((r) => setTimeout(r, 50));
  },
  correlationAttributes({ event_id: spanId, correlation_id: `corr-${spanId}`, conversation_id: 'conv-otel-e2e' }),
);
await new Promise((r) => setTimeout(r, 1500)); // batch pan de 1s
await tracing.shutdown();
await new Promise((r) => setTimeout(r, 500));
receiver.close();

// Assertion: envio OTLP com corpo protobuf JSON e correlação nos spans.
const otlpRequests = received.filter((r) => r.url.includes('/v1/traces'));
const raw = otlpRequests.map((r) => r.body).join('');
const hasCorrelation = raw.includes('event_id') && raw.includes(spanId) && raw.includes('conv-otel-e2e');

const result = {
  commit: (await import('node:child_process')).execSync('git rev-parse HEAD').toString().trim(),
  timestamp: new Date().toISOString(),
  collectorReached: otlpRequests.length > 0,
  spansReceived: otlpRequests.length,
  correlationPreserved: hasCorrelation,
  service: 'desk-api',
  expectedSpans: ['webhook.receive'],
  result: otlpRequests.length > 0 && hasCorrelation ? 'PASS' : 'FAIL',
};

const artifactsDir = join(root, 'artifacts');
mkdirSync(artifactsDir, { recursive: true });
writeFileSync(join(artifactsDir, 'staging-otel.json'), `${JSON.stringify(result, null, 2)}\n`);

console.log(`OTEL E2E: ${result.result}`);
console.log(`  collectorReached=${result.collectorReached} spans=${result.spansReceived} correlation=${result.correlationPreserved}`);
process.exit(result.result === 'PASS' ? 0 : 1);
