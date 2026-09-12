import http from 'k6/http';
import { check, sleep } from 'k6';
import crypto from 'k6/crypto';

/**
 * Phase 11 — carga básica (smoke load).
 * Cenários: health/readiness/metrics, login inválido (rate-limit/auth path),
 * burst de webhook inbound assinado (idempotência sob concorrência).
 *
 * Uso:
 *   BASE_URL=http://localhost:4331 WEBHOOK_SECRET=... k6 run e2e/load/smoke-load.js
 *
 * Limites: VUs baixos para smoke local/CI. Para 50/100 VUs, ver docs/PERFORMANCE.
 */
export const options = {
  scenarios: {
    baseline: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS_BASELINE || 10),
      duration: __ENV.DURATION || '30s',
      exec: 'baseline',
    },
    webhook_burst: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS_BURST || 10),
      duration: __ENV.DURATION || '30s',
      exec: 'webhookBurst',
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
    'http_req_failed{kind:health}': ['rate<0.01'],
    'http_req_failed{kind:readiness}': ['rate<0.01'],
    'http_req_failed{kind:metrics}': ['rate<0.01'],
    'http_req_failed{kind:webhook}': ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4331';
const WEBHOOK_SECRET = __ENV.WEBHOOK_SECRET || 'load-test-secret';

export function baseline() {
  const health = http.get(`${BASE_URL}/health`, { tags: { kind: 'health' } });
  check(health, { 'health 200': (r) => r.status === 200 });

  const readiness = http.get(`${BASE_URL}/readiness`, { tags: { kind: 'readiness' } });
  check(readiness, { 'readiness 200': (r) => r.status === 200 });

  const metrics = http.get(`${BASE_URL}/metrics`, { tags: { kind: 'metrics' } });
  check(metrics, { 'metrics 200': (r) => r.status === 200 });

  // 401 esperado: exercita auth path + rate-limit sem contar como falha.
  const login = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: 'nope@example.com', password: 'wrong' }),
    { headers: { 'Content-Type': 'application/json' }, tags: { kind: 'login-invalid' } },
  );
  check(login, { 'invalid login 401': (r) => r.status === 401 });

  sleep(0.5);
}

export function webhookBurst() {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const eventId = `load-${__VU}-${__ITER}-${Date.now()}`;
  const body = JSON.stringify({
    messageId: `load-msg-${__VU}-${__ITER}`,
    from: '+5511999000000',
    content: 'Load test inbound',
  });
  const signature = crypto.hmac('sha256', WEBHOOK_SECRET, `${timestamp}.${body}`, 'hex');

  const res = http.post(`${BASE_URL}/webhook/inbound`, body, {
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': `sha256=${signature}`,
      'X-Webhook-Timestamp': timestamp,
      'X-Webhook-Event-Id': eventId,
    },
    tags: { kind: 'webhook' },
  });
  check(res, { 'webhook accepted': (r) => r.status === 200 });
  sleep(0.2);
}
