import './integration-mocks';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Writable } from 'node:stream';
import { Counter, Gauge, Histogram, httpRequestsTotal } from '@cvg/shared';
import { buildDeskApiApp } from '../app.ts';

/**
 * AAA-18 — Limitar cardinalidade e proteger métricas (achado A15; C08; QA13).
 *
 * Prova, em HTTP real via `app.inject` e no registry de métricas:
 *   - rota não registrada usa label fixo `route="unmatched"`; 10k URLs distintas
 *     não criam série por URL (medido no próprio registry);
 *   - /metrics em produção exige token e/ou rede autorizada, negando por padrão
 *     quando não há nenhum dos dois (fail-closed); token nunca vai para logs;
 *   - labels são saneados/limitados e a coleção tem teto de séries, sem vazar
 *     payload, query string ou PII;
 *   - configuração de implantação (Compose + Prometheus) entrega o token ao
 *     scrape sem literal no repositório.
 */

const REPO_ROOT = resolve(process.cwd(), '..', '..');
const UNMATCHED = 'unmatched';
const TOKEN = 'aaa18-metrics-token-super-secret';
const WRONG_TOKEN = 'aaa18-token-errado';
const MAX_LABEL_VALUE_LENGTH = 120;
const MAX_SERIES_PER_COLLECTOR = 1000;

const ENV_KEYS = [
  'METRICS_TOKEN',
  'METRICS_ALLOWED_CIDRS',
  'NODE_ENV',
  'DESK_ENV',
  'CORS_ORIGIN',
  'TRUST_PROXY',
  'LOG_LEVEL',
  'RATE_LIMIT_MAX',
] as const;

function repoFile(relativeFromRepoRoot: string): string {
  const candidates = [
    resolve(process.cwd(), '..', '..', relativeFromRepoRoot),
    resolve(REPO_ROOT, relativeFromRepoRoot),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`Arquivo não encontrado para verificação: ${relativeFromRepoRoot}`);
  return readFileSync(found, 'utf8');
}

function routeKeysFromExposition(body: string): Set<string> {
  const routes = new Set<string>();
  const linePattern = /^http_requests_total\{([^}]*)\} /gm;
  let match: RegExpExecArray | null;
  while ((match = linePattern.exec(body)) !== null) {
    const route = /(?:^|,)route="((?:[^"\\]|\\.)*)"/.exec(match[1])?.[1];
    routes.add(route ?? '');
  }
  return routes;
}

function labelValuesFromExposition(body: string): string[] {
  const values: string[] = [];
  const labelPattern = /[a-zA-Z_][a-zA-Z0-9_]*="((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = labelPattern.exec(body)) !== null) values.push(match[1]);
  return values;
}

describe('AAA-18 — cardinalidade, exposição e labels de métricas', () => {
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  const logChunks: string[] = [];
  const envSnapshot = new Map<string, string | undefined>();

  function metricsBody(): Promise<string> {
    return app.inject({ method: 'GET', url: '/metrics' }).then((response) => response.body);
  }

  function logsSince(mark: number): string {
    return logChunks.slice(mark).join('');
  }

  function restoreEnv(): void {
    for (const key of ENV_KEYS) {
      const value = envSnapshot.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  beforeAll(async () => {
    const logStream = new Writable({
      write(chunk, _encoding, callback) {
        logChunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
        callback();
      },
    });
    for (const key of ENV_KEYS) envSnapshot.set(key, process.env[key]);
    process.env.LOG_LEVEL = 'warn';
    process.env.RATE_LIMIT_MAX = '100000';
    delete process.env.METRICS_TOKEN;
    delete process.env.METRICS_ALLOWED_CIDRS;
    app = await buildDeskApiApp({ loggerStream: logStream });
    await app.ready();
  });

  afterEach(() => {
    restoreEnv();
  });

  afterAll(async () => {
    restoreEnv();
    await app.close();
  });

  it('10 mil URLs não registradas produzem cardinalidade limitada com label fixo', async () => {
    // O hook onResponse fecha depois do corpo: aquece a série de /metrics
    // antes de medir o estado inicial.
    await metricsBody();
    const seriesBefore = httpRequestsTotal.seriesCount;
    const routesBefore = routeKeysFromExposition(await metricsBody());

    const total = 10_000;
    const batchSize = 200;
    for (let start = 0; start < total; start += batchSize) {
      const size = Math.min(batchSize, total - start);
      await Promise.all(
        Array.from({ length: size }, (_, offset) =>
          app.inject({
            method: 'GET',
            url: `/sem-rota/${start + offset}?pii=${start + offset}`,
          }),
        ),
      );
    }

    const body = await metricsBody();
    const seriesAfter = httpRequestsTotal.seriesCount;
    const routesAfter = routeKeysFromExposition(body);
    const newRoutes = [...routesAfter].filter((route) => !routesBefore.has(route));

    // Medição bruta para a evidência: teto de cardinalidade observado no registry.
    console.log(
      `[AAA-18] 10k URLs => http_requests_total series before=${seriesBefore} after=${seriesAfter} delta=${seriesAfter - seriesBefore}; novas rotas=${JSON.stringify(newRoutes)}`,
    );

    expect({ newRoutes, seriesDelta: seriesAfter - seriesBefore }).toEqual({
      newRoutes: [UNMATCHED],
      seriesDelta: expect.any(Number),
    });
    expect(seriesAfter - seriesBefore).toBeLessThanOrEqual(2);
    expect(body).not.toContain('/sem-rota/');
    expect(body).toMatch(/http_requests_total\{[^}]*route="unmatched"[^}]*\} \d+/);
    expect(body).toMatch(/http_request_duration_seconds_bucket\{[^}]*route="unmatched"[^}]*\}/);
    for (const value of labelValuesFromExposition(body)) {
      expect(value.length).toBeLessThanOrEqual(MAX_LABEL_VALUE_LENGTH);
    }
  }, 180_000);

  it('rotas não registradas não expõem PII de path, query ou payload', async () => {
    const phone = '5511999998888';
    const email = 'maria.silva@example.com';
    const secretPayload = 'nao-pode-vazar-no-metric';

    await app.inject({ method: 'GET', url: `/contatos/${phone}?email=${encodeURIComponent(email)}` });
    await app.inject({
      method: 'POST',
      url: '/sem-rota/payload',
      payload: { phone, secret: secretPayload },
    });
    await app.inject({
      method: 'PUT',
      url: `/notas/${encodeURIComponent(email)}/editar?telefone=${phone}`,
      payload: { conteudo: secretPayload },
    });

    const body = await metricsBody();
    expect(body).not.toContain(phone);
    expect(body).not.toContain(email);
    expect(body).not.toContain(secretPayload);
    expect(body).not.toContain('/contatos/');
    expect(body).not.toContain('/notas/');
    expect(body).toContain(`route="${UNMATCHED}"`);
  });

  describe('exposição do /metrics', () => {
    it('produção sem token e sem rede autorizada nega a exposição (fail-closed)', async () => {
      delete process.env.METRICS_TOKEN;
      delete process.env.METRICS_ALLOWED_CIDRS;
      process.env.NODE_ENV = 'production';

      const response = await app.inject({ method: 'GET', url: '/metrics' });
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toContain('http_requests_total');
    });

    it('produção com token: 401 sem Authorization e com token errado; 200 com Bearer correto', async () => {
      process.env.NODE_ENV = 'production';
      process.env.METRICS_TOKEN = TOKEN;

      const anonymous = await app.inject({ method: 'GET', url: '/metrics' });
      expect(anonymous.statusCode).toBe(401);

      const wrong = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: `Bearer ${WRONG_TOKEN}` },
      });
      expect(wrong.statusCode).toBe(401);

      const authorized = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(authorized.statusCode).toBe(200);
      expect(authorized.body).toContain('http_requests_total');
    });

    it('rede autorizada restringe o acesso e exige token quando ambos existem', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.METRICS_TOKEN;
      process.env.METRICS_ALLOWED_CIDRS = '10.0.0.0/8';

      const outside = await app.inject({ method: 'GET', url: '/metrics' });
      expect(outside.statusCode).toBe(403);

      process.env.METRICS_ALLOWED_CIDRS = '127.0.0.0/8';
      const inside = await app.inject({ method: 'GET', url: '/metrics' });
      expect(inside.statusCode).toBe(200);

      process.env.METRICS_TOKEN = TOKEN;
      process.env.METRICS_ALLOWED_CIDRS = '10.0.0.0/8';
      const tokenButOutside = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(tokenButOutside.statusCode).toBe(403);

      process.env.METRICS_ALLOWED_CIDRS = '127.0.0.1/32';
      const tokenAndInside = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(tokenAndInside.statusCode).toBe(200);
    });

    it('CIDR IPv6 e IPv4 mapeado em IPv6 são avaliados na allowlist', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.METRICS_TOKEN;

      process.env.METRICS_ALLOWED_CIDRS = '::1/128';
      const loopbackV6 = await app.inject({ method: 'GET', url: '/metrics', remoteAddress: '::1' });
      expect(loopbackV6.statusCode).toBe(200);
      const ipv4Outside = await app.inject({ method: 'GET', url: '/metrics', remoteAddress: '127.0.0.1' });
      expect(ipv4Outside.statusCode).toBe(403);

      process.env.METRICS_ALLOWED_CIDRS = '2001:db8::/32';
      const docV6 = await app.inject({ method: 'GET', url: '/metrics', remoteAddress: '2001:db8::5' });
      expect(docV6.statusCode).toBe(200);
      const otherV6 = await app.inject({ method: 'GET', url: '/metrics', remoteAddress: '2001:db9::5' });
      expect(otherV6.statusCode).toBe(403);

      process.env.METRICS_ALLOWED_CIDRS = '127.0.0.0/8';
      const mappedInside = await app.inject({ method: 'GET', url: '/metrics', remoteAddress: '::ffff:127.0.0.1' });
      expect(mappedInside.statusCode).toBe(200);
      const mappedOutside = await app.inject({ method: 'GET', url: '/metrics', remoteAddress: '::ffff:10.1.2.3' });
      expect(mappedOutside.statusCode).toBe(403);
    });

    it('token por query string não autentica e não aparece na exposição', async () => {
      process.env.NODE_ENV = 'production';
      process.env.METRICS_TOKEN = TOKEN;

      const response = await app.inject({ method: 'GET', url: `/metrics?token=${TOKEN}` });
      expect(response.statusCode).toBe(401);
      expect(response.body).not.toContain('http_requests_total');
      expect(response.body).not.toContain(TOKEN);
    });

    it('fora de produção o default sem token continua permitido (coleta local)', async () => {
      process.env.NODE_ENV = 'test';
      delete process.env.METRICS_TOKEN;
      delete process.env.METRICS_ALLOWED_CIDRS;

      const response = await app.inject({ method: 'GET', url: '/metrics' });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('http_requests_total');
    });

    it('token nunca aparece em logs nem na exposição', async () => {
      process.env.NODE_ENV = 'production';
      process.env.METRICS_TOKEN = TOKEN;
      const mark = logChunks.length;

      await app.inject({ method: 'GET', url: '/metrics' });
      await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: `Bearer ${WRONG_TOKEN}` },
      });
      const authorized = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: `Bearer ${TOKEN}` },
      });

      const captured = logsSince(mark);
      expect(captured).not.toContain(TOKEN);
      expect(captured).not.toContain(WRONG_TOKEN);
      expect(captured).not.toContain('Bearer');
      expect(authorized.body).not.toContain(TOKEN);
    });

    it('produção sem token falha fechado também com CIDR inválido configurado', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.METRICS_TOKEN;
      process.env.METRICS_ALLOWED_CIDRS = 'nao-e-cidr';

      const response = await app.inject({ method: 'GET', url: '/metrics' });
      expect(response.statusCode).toBe(403);
      expect(response.body).not.toContain('http_requests_total');
    });
  });

  describe('saneamento e teto de séries no registry', () => {
    it('valores de label são saneados, truncados e não injetam linhas', () => {
      const counter = new Counter('aaa18_probe_counter', 'probe de saneamento');
      counter.inc({ route: `/x\nINJECT ${'a'.repeat(500)}\r` });

      const rendered = counter.render();
      const lines = rendered.split('\n');
      const seriesLines = lines.filter((line) => line.startsWith('aaa18_probe_counter{'));
      expect(lines).toHaveLength(3);
      expect(seriesLines).toHaveLength(1);
      expect(rendered).not.toMatch(/\nINJECT/);
      for (const value of labelValuesFromExposition(rendered)) {
        expect(value.length).toBeLessThanOrEqual(MAX_LABEL_VALUE_LENGTH);
      }
    });

    it('counter limita a quantidade de séries distintas (10k labels → teto)', () => {
      const counter = new Counter('aaa18_cardinality_counter', 'probe de cardinalidade');
      for (let index = 0; index < 10_000; index += 1) {
        counter.inc({ route: `/rota/${index}` });
      }

      expect(counter.seriesCount).toBeLessThanOrEqual(MAX_SERIES_PER_COLLECTOR + 1);
      expect(counter.render()).toContain('__other__');
    });

    it('gauge limita a quantidade de séries distintas (10k labels → teto)', () => {
      const gauge = new Gauge('aaa18_cardinality_gauge', 'probe de cardinalidade');
      for (let index = 0; index < 10_000; index += 1) {
        gauge.inc({ route: `/rota/${index}` });
      }

      expect(gauge.seriesCount).toBeLessThanOrEqual(MAX_SERIES_PER_COLLECTOR + 1);
      expect(gauge.render()).toContain('__other__');
    });

    it('histogram limita a quantidade de séries distintas (10k labels → teto)', () => {
      const histogram = new Histogram('aaa18_cardinality_histogram', 'probe de cardinalidade');
      for (let index = 0; index < 10_000; index += 1) {
        histogram.observe(0.05, { route: `/rota/${index}` });
      }

      expect(histogram.seriesCount).toBeLessThanOrEqual(MAX_SERIES_PER_COLLECTOR + 1);
      expect(histogram.render()).toContain('__other__');
    });
  });

  describe('configuração de implantação (Compose + Prometheus)', () => {
    it('Compose entrega METRICS_TOKEN ao container sem literal no repositório', () => {
      const compose = repoFile('docker-compose.yml');
      expect(compose).toMatch(/METRICS_TOKEN: \$\{METRICS_TOKEN:\?/);
      expect(compose).not.toMatch(/METRICS_TOKEN: (?!\$\{)[^\s]+/);
      expect(compose).toContain('prometheus:');
      expect(compose).toContain('tmpfs:');
    });

    it('Prometheus envia Bearer via arquivo de credencial, sem token literal', () => {
      const prometheus = repoFile('infra/prometheus/prometheus.yml');
      expect(prometheus).toContain('authorization:');
      expect(prometheus).toMatch(/credentials_file: \/tmp\/metrics_token/);
      expect(prometheus).not.toMatch(/credentials:\s*"?[A-Za-z0-9]/);
      expect(prometheus).toContain('desk-api:3000');
      expect(prometheus).toContain('realtime-service:8080');
      expect(prometheus).toContain('message-worker:9090');
    });
  });
});
