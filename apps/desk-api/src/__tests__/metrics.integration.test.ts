import './integration-mocks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDeskApiApp } from '../app.ts';

describe('Metrics endpoint integration', () => {
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;

  beforeAll(async () => {
    delete process.env.METRICS_TOKEN;
    app = await buildDeskApiApp();
    await app.ready();
  });

  afterAll(async () => {
    delete process.env.METRICS_TOKEN;
    await app.close();
  });

  it('expõe métricas Prometheus após requests', async () => {
    await app.inject({ method: 'GET', url: '/health' });

    const response = await app.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    const body = response.body;
    expect(body.startsWith('# HELP')).toBe(true);
    expect(body).toContain('# HELP http_requests_total');
    expect(body).toContain('http_requests_total{');
    expect(body).toContain('http_request_duration_seconds_bucket{');
  });

  it('exige token quando METRICS_TOKEN configurado', async () => {
    process.env.METRICS_TOKEN = 'metrics-secret-test';
    try {
      const anon = await app.inject({ method: 'GET', url: '/metrics' });
      expect(anon.statusCode).toBe(401);

      const authed = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: { authorization: 'Bearer metrics-secret-test' },
      });
      expect(authed.statusCode).toBe(200);
      expect(authed.body).toContain('http_requests_total');
    } finally {
      delete process.env.METRICS_TOKEN;
    }
  });
});
