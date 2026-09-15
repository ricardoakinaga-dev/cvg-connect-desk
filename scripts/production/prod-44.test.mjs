// PROD-44 — prova do bootstrap nativo do realtime fora do Vitest.
// O processo filho usa somente uma API sintética e uma porta escolhida para
// esta execução; nenhuma credencial é gravada nos artefatos.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const PROGRAM_DIR = resolve(
  process.env.CVG_PROGRAM_DIR || join(REPO_ROOT, 'docs', 'melhorias-2026-09-13-r3'),
);
const RUN_ID = process.env.AAA_RUN_ID || process.env.R3_RUN_ID || `r3-prod44-${Date.now().toString(36)}`;
const ATTEMPT = Number(process.env.AAA_ATTEMPT || process.env.R3_ATTEMPT || 1);
const SEGMENT = process.env.CVG_EVIDENCE_SEGMENT?.trim() || `${RUN_ID}-a${ATTEMPT}`;
const EVIDENCE_DIR = resolve(
  process.env.CVG_EVIDENCE_DIR || join(PROGRAM_DIR, 'evidencias', 'prod-44', SEGMENT),
);
const METRICS_TOKEN = 'r3-prod44-metrics-secret';
const INTERNAL_SECRET = 'r3-prod44-internal-secret';

function sha256File(relativePath) {
  return createHash('sha256').update(readFileSync(join(REPO_ROOT, relativePath))).digest('hex');
}

function commandVersion(command, args) {
  try {
    return execFileSync(command, args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch (error) {
    return `UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function freePort() {
  const server = createServer();
  return await new Promise((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function startSyntheticApi() {
  const api = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ events: [], serverTime: new Date().toISOString() }));
  });
  const port = await new Promise((resolvePort, reject) => {
    api.once('error', reject);
    api.listen(0, '127.0.0.1', () => resolvePort(api.address().port));
  });
  return { api, url: `http://127.0.0.1:${port}` };
}

function safeOutput(value) {
  return String(value)
    .replaceAll(METRICS_TOKEN, '[REDACTED]')
    .replaceAll(INTERNAL_SECRET, '[REDACTED]');
}

function waitForExit(child) {
  if (child.exitCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolveExit({ code, signal }));
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) {
    return child ? { code: child.exitCode, signal: child.signalCode } : null;
  }
  child.kill('SIGTERM');
  try {
    return await Promise.race([
      waitForExit(child),
      delay(5_000).then(() => null),
    ]).then(async (result) => {
      if (result) return result;
      if (child.exitCode === null) child.kill('SIGKILL');
      return await waitForExit(child);
    });
  } catch (error) {
    if (child.exitCode === null) child.kill('SIGKILL');
    throw error;
  }
}

async function request(url, options = {}) {
  return await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(options.timeoutMs ?? 2_000),
  });
}

async function waitForStatus(url, expectedStatus, timeoutMs = 5_000) {
  const startedAt = Date.now();
  let lastStatus = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await request(url);
      lastStatus = response.status;
      if (response.status === expectedStatus) return response;
      await response.arrayBuffer();
    } catch {
      // The child can still be binding its HTTP listener.
    }
    await delay(50);
  }
  throw new Error(`timeout waiting for ${url} status ${expectedStatus}; last=${lastStatus}`);
}

async function waitForPortClosed(port, timeoutMs = 2_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await request(`http://127.0.0.1:${port}/health`, { timeoutMs: 250 });
      await response.arrayBuffer();
    } catch {
      return true;
    }
    await delay(50);
  }
  return false;
}

async function runChildCase(apiUrl, token) {
  const port = await freePort();
  const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const args = ['--filter', '@cvg/realtime-service', 'exec', 'tsx', 'src/index.ts'];
  const stdout = [];
  const stderr = [];
  const child = spawn(executable, args, {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      OTEL_ENABLED: 'false',
      USE_DATABASE_OUTBOX: 'false',
      REALTIME_INTERNAL_SECRET: INTERNAL_SECRET,
      REALTIME_PORT: String(port),
      REALTIME_POLL_INTERVAL_MS: '25',
      DESK_API_URL: apiUrl,
      REDIS_URL: '',
      ...(token ? { METRICS_TOKEN: token } : { METRICS_TOKEN: '' }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => stdout.push(String(chunk)));
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));

  const result = {
    port,
    pid: child.pid,
    startedAt: new Date().toISOString(),
    tokenConfigured: Boolean(token),
    health: null,
    readiness: null,
    portClosed: false,
    metrics: {},
    exit: null,
    stdout: null,
    stderr: null,
  };

  try {
    const healthResponse = await waitForStatus(`http://127.0.0.1:${port}/health`, 200);
    result.health = { status: healthResponse.status };
    result.healthBody = await healthResponse.json();
    const readinessResponse = await waitForStatus(`http://127.0.0.1:${port}/readiness`, 200);
    result.readiness = { status: readinessResponse.status };
    result.readinessBody = await readinessResponse.json();

    if (!token) {
      const unavailable = await request(`http://127.0.0.1:${port}/metrics`);
      result.metrics.unavailable = { status: unavailable.status, body: await unavailable.json() };
    } else {
      const anonymous = await request(`http://127.0.0.1:${port}/metrics`);
      result.metrics.anonymous = { status: anonymous.status, body: await anonymous.json() };
      const wrong = await request(`http://127.0.0.1:${port}/metrics`, {
        headers: { authorization: 'Bearer wrong-secret' },
      });
      result.metrics.wrong = { status: wrong.status, body: await wrong.json() };
      const authorized = await request(`http://127.0.0.1:${port}/metrics?probe=1`, {
        headers: { authorization: `Bearer ${token}` },
      });
      result.metrics.authorized = {
        status: authorized.status,
        contentType: authorized.headers.get('content-type'),
        body: await authorized.text(),
      };
    }
  } finally {
    result.exit = await stopChild(child);
    result.portClosed = await waitForPortClosed(port);
    result.stdout = safeOutput(stdout.join(''));
    result.stderr = safeOutput(stderr.join(''));
  }

  return result;
}

function assertCase(result) {
  if (!result.healthBody || result.healthBody.service !== 'realtime-service') {
    throw new Error(`health inválido: ${JSON.stringify(result.healthBody)}`);
  }
  if (!result.readinessBody?.ready || result.readinessBody.checks?.poller?.status !== 'ok') {
    throw new Error(`readiness inválido: ${JSON.stringify(result.readinessBody)}`);
  }
  const gracefulSignal = result.exit?.signal === 'SIGTERM'
    && result.stdout.includes('Received SIGTERM')
    && result.stdout.includes('Server stopped');
  if (!result.exit || (!((result.exit.code === 0 && result.exit.signal === null) || gracefulSignal))) {
    throw new Error(`shutdown inválido: ${JSON.stringify(result.exit)}`);
  }
  if (!result.portClosed) throw new Error(`porta ${result.port} permaneceu aberta após shutdown`);
  if (!result.tokenConfigured) {
    if (result.metrics.unavailable?.status !== 503
      || JSON.stringify(result.metrics.unavailable.body) !== JSON.stringify({ error: 'METRICS_UNAVAILABLE' })) {
      throw new Error(`metrics sem token inválido: ${JSON.stringify(result.metrics.unavailable)}`);
    }
    return;
  }
  if (result.metrics.anonymous?.status !== 401 || result.metrics.wrong?.status !== 401) {
    throw new Error(`metrics sem credencial/inválida: ${JSON.stringify(result.metrics)}`);
  }
  if (result.metrics.authorized?.status !== 200
    || !result.metrics.authorized.contentType?.includes('text/plain; version=0.0.4')
    || !result.metrics.authorized.body.includes('# TYPE http_requests_total counter')) {
    throw new Error(`metrics autorizada inválida: ${JSON.stringify(result.metrics.authorized)}`);
  }
}

async function main() {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const syntheticApi = await startSyntheticApi();
  const cases = [];
  let status = 'PASS';
  let error = null;

  try {
    cases.push(await runChildCase(syntheticApi.url, null));
    assertCase(cases.at(-1));
    cases.push(await runChildCase(syntheticApi.url, METRICS_TOKEN));
    assertCase(cases.at(-1));
  } catch (caught) {
    status = 'FAIL';
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    await new Promise((resolveClose, reject) => syntheticApi.api.close((closeError) => closeError ? reject(closeError) : resolveClose()));
  }

  const sourceFiles = [
    'apps/realtime-service/src/index.ts',
    'apps/realtime-service/src/authorization.ts',
    'apps/realtime-service/package.json',
    'apps/realtime-service/Dockerfile',
    'packages/shared/src/index.ts',
    'packages/shared/src/metrics.ts',
    'packages/shared/package.json',
    'pnpm-lock.yaml',
  ];
  const artifact = {
    task: 'PROD-44',
    status,
    error,
    startedAt,
    finishedAt: new Date().toISOString(),
    execution: { runId: RUN_ID, attempt: ATTEMPT, evidenceSegment: SEGMENT },
    candidate: {
      head: commandVersion('git', ['rev-parse', 'HEAD']),
      node: process.version,
      pnpm: commandVersion('pnpm', ['--version']),
      sourceSha256: Object.fromEntries(sourceFiles.map((file) => [file, sha256File(file)])),
    },
    command: {
      executable: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      args: ['--filter', '@cvg/realtime-service', 'exec', 'tsx', 'src/index.ts'],
      cwd: REPO_ROOT,
    },
    syntheticApi: { url: syntheticApi.url, host: '127.0.0.1', purpose: 'empty events response only' },
    cases,
  };
  writeFileSync(join(EVIDENCE_DIR, 'native-bootstrap.json'), `${JSON.stringify(artifact, null, 2)}\n`);
  writeFileSync(join(EVIDENCE_DIR, 'native-bootstrap.log'), cases.map((item) => [
    `case tokenConfigured=${item.tokenConfigured} pid=${item.pid} port=${item.port}`,
    `exit=${JSON.stringify(item.exit)}`,
    item.stdout,
    item.stderr,
  ].join('\n')).join('\n---\n'));

  console.log(JSON.stringify({ task: 'PROD-44', status, evidence: EVIDENCE_DIR, error }, null, 2));
  if (status !== 'PASS') process.exitCode = 1;
}

await main();
