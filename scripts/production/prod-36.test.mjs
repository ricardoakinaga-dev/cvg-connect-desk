import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readinessScript = resolve(root, 'scripts/production-readiness.mjs');

const validProductionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://desk:secret@postgres:5432/connect_desk_db',
  REDIS_URL: 'redis://redis:6379',
  CORS_ORIGIN: 'https://desk.example',
  WEBHOOK_SECRET: 'webhook-secret-for-production',
  INTERNAL_EVENTS_SECRET: 'internal-secret-for-production',
  MEDIA_STORAGE_DRIVER: 's3',
  S3_BUCKET: 'private-media',
  S3_ACCESS_KEY_ID: 's3-access',
  S3_SECRET_ACCESS_KEY: 's3-secret',
  MALWARE_SCANNER: 'clamav',
  CLAMAV_HOST: 'clamav',
  CLAMAV_PORT: '3310',
  METRICS_TOKEN: 'metrics-secret',
  OTEL_ENABLED: 'false',
};

function runReadiness(overrides = {}) {
  const env = { ...process.env, ...validProductionEnv };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) delete env[name];
    else env[name] = value;
  }
  return spawnSync(process.execPath, [readinessScript], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
}

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

test('production preflight accepts the complete effective contract', () => {
  const result = runReadiness();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /=== READY ===/);
});

test('production preflight fails closed without critical configuration', () => {
  const result = runReadiness({
    NODE_ENV: null,
    CORS_ORIGIN: '*',
    INTERNAL_EVENTS_SECRET: null,
    MALWARE_SCANNER: null,
    METRICS_TOKEN: null,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /NODE_ENV/);
  assert.match(result.stdout, /CORS_ORIGIN/);
  assert.match(result.stdout, /INTERNAL_EVENTS_SECRET/);
  assert.match(result.stdout, /MALWARE_SCANNER/);
  assert.match(result.stdout, /METRICS_TOKEN/);
  assert.match(result.stdout, /NOT READY \(fail fast\)/);
});

test('production preflight normalizes OTEL and JWT placeholder values', () => {
  const otel = runReadiness({
    OTEL_ENABLED: ' TRUE ',
    OTEL_EXPORTER_OTLP_ENDPOINT: null,
  });
  assert.notEqual(otel.status, 0);
  assert.match(otel.stdout, /OTEL_EXPORTER_OTLP_ENDPOINT/);

  const jwt = runReadiness({
    JWT_SECRET: ' CHANGE_ME_IN_PRODUCTION_USE_STRONG_RANDOM_KEY ',
  });
  assert.notEqual(jwt.status, 0);
  assert.match(jwt.stdout, /JWT_SECRET/);
});

test('production configuration uses process health, readiness and restricted containers', () => {
  const apiDockerfile = read('apps/desk-api/Dockerfile');
  const workerDockerfile = read('apps/message-worker/Dockerfile');
  const realtimeDockerfile = read('apps/realtime-service/Dockerfile');
  const compose = read('docker-compose.yml');
  const staging = read('docker-compose.staging.yml');
  const workerHealth = read('apps/message-worker/src/health.ts');
  const workerHealthcheck = read('apps/message-worker/src/healthcheck.ts');
  const realtime = read('apps/realtime-service/src/index.ts');

  assert.match(apiDockerfile, /localhost:3000\/readiness/);
  assert.match(workerDockerfile, /src\/healthcheck\.ts/);
  assert.match(workerHealthcheck, /127\.0\.0\.1:\$\{port\}\/readiness/);
  assert.match(workerHealth, /\/readiness/);
  assert.match(realtime, /createServer/);
  assert.match(realtimeDockerfile, /localhost:8080\/readiness/);
  assert.match(compose, /REDIS_REQUIRED: "true"/);
  assert.match(compose, /OTEL_EXPORTER_OTLP_ENDPOINT/);
  assert.match(compose, /S3_BUCKET: \$\{S3_BUCKET:\?/);
  assert.match(compose, /CLAMAV_HOST: \$\{CLAMAV_HOST:\?/);
  assert.match(compose, /localhost:3000\/readiness/);
  assert.match(compose, /localhost:8080\/readiness/);
  assert.match(staging, /localhost:3000\/readiness/);
  assert.doesNotMatch(compose, /nc", "-z", "localhost", "8080/);
});

test('production examples retain proxy and private-media contracts', () => {
  const envExample = read('.env.production.example');
  const nginx = read('apps/desk-web/nginx.conf');

  for (const name of [
    'MEDIA_STORAGE_DRIVER',
    'S3_BUCKET',
    'MALWARE_SCANNER',
    'CLAMAV_HOST',
    'CLAMAV_PORT',
    'METRICS_TOKEN',
    'INTERNAL_EVENTS_SECRET',
  ]) {
    assert.match(envExample, new RegExp(`^${name}=`, 'm'));
  }
  assert.match(nginx, /proxy_set_header X-Forwarded-Proto \$scheme;/);
  assert.match(nginx, /location \/ws\//);
  assert.match(nginx, /proxy_read_timeout 86400s;/);
});
