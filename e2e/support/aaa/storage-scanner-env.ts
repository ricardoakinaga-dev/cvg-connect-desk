// Storage/scanner efêmeros e EXCLUSIVOS do run isolado (SA-003/AC1).
//
// Regras de isolamento:
//  - projeto compose exclusivo `cvg-aaa-<runId>`; nunca nomes fixos;
//  - portas verificadas livres antes de subir e registradas no marcador;
//  - credenciais sintéticas derivadas do runId (nunca de produção);
//  - teardown apenas `-p <projeto> down -v` (não usa fuser/Docker genérico);
//  - aborta se o alvo não pertencer a este run (marcador ausente/divergente).
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { ensureRunDirs, type RunContext } from './run-context.ts';

export interface StorageScannerEnv {
  project: string;
  composeFile: string;
  s3Endpoint: string;
  s3ConsoleUrl: string;
  s3Bucket: string;
  s3AccessKey: string;
  s3SecretKey: string;
  clamavHost: string;
  clamavPort: number;
  ports: { s3: number; s3Console: number; clamav: number };
  markerPath: string;
}

export class StorageScannerIsolationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'StorageScannerIsolationError';
    this.code = code;
  }
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new StorageScannerIsolationError('PORT_INVALID', `${name} invalido: "${raw}".`);
  }
  return value;
}

async function assertPortFree(name: string, port: number): Promise<void> {
  const free = await new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port }, () => {
      server.close(() => resolve(true));
    });
  });
  if (!free) {
    throw new StorageScannerIsolationError('PORT_BUSY', `${name}: porta ${port} ja ocupada por outro alvo; abortando sem tocar no recurso.`);
  }
}

export function storageScannerContext(ctx: RunContext): StorageScannerEnv {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(ctx.runId)) {
    throw new StorageScannerIsolationError('RUN_ID_INVALID', `runId "${ctx.runId}" nao e seguro para nome de projeto.`);
  }
  const ports = {
    s3: envInt('AAA_S3_PORT', 57100 + ctx.workerIndex * 10),
    s3Console: envInt('AAA_S3_CONSOLE_PORT', 57101 + ctx.workerIndex * 10),
    clamav: envInt('AAA_CLAMAV_PORT', 57110 + ctx.workerIndex * 10),
  };
  return {
    project: `cvg-aaa-${ctx.runId}`,
    composeFile: join(ctx.repoRoot, 'docker-compose.aaa-storage.yml'),
    s3Endpoint: `http://127.0.0.1:${ports.s3}`,
    s3ConsoleUrl: `http://127.0.0.1:${ports.s3Console}`,
    s3Bucket: `cvg-aaa-${ctx.runId.replace(/-/g, '_')}`,
    s3AccessKey: 'aaa_synthetic',
    s3SecretKey: createHash('sha256').update(`aaa-synthetic:${ctx.runId}`).digest('hex').slice(0, 32),
    clamavHost: '127.0.0.1',
    clamavPort: ports.clamav,
    ports,
    markerPath: join(ctx.runRoot, 'storage-scanner.marker.json'),
  };
}

function compose(env: StorageScannerEnv, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(
    'docker',
    ['compose', '-p', env.project, '-f', env.composeFile, ...args],
    {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      env: {
        ...process.env,
        AAA_S3_PORT: String(env.ports.s3),
        AAA_S3_CONSOLE_PORT: String(env.ports.s3Console),
        AAA_CLAMAV_PORT: String(env.ports.clamav),
        AAA_S3_ACCESS_KEY: env.s3AccessKey,
        AAA_S3_SECRET_KEY: env.s3SecretKey,
      },
    },
  );
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export async function provisionStorageScanner(
  ctx: RunContext,
  options: { services?: Array<'minio' | 'clamav'> } = {},
): Promise<StorageScannerEnv> {
  const env = storageScannerContext(ctx);
  const services = options.services ?? ['minio', 'clamav'];

  if (!existsSync(env.composeFile)) {
    throw new StorageScannerIsolationError('COMPOSE_MISSING', `compose ausente: ${env.composeFile}`);
  }
  if (existsSync(env.markerPath)) {
    const marker = JSON.parse(readFileSync(env.markerPath, 'utf8')) as { project: string };
    if (marker.project !== env.project) {
      throw new StorageScannerIsolationError('MARKER_CONFLICT', `marcador de outro projeto: ${marker.project}`);
    }
    // Já provisionado por este run: reutiliza.
    return env;
  }

  await assertPortFree('minio', env.ports.s3);
  await assertPortFree('minio-console', env.ports.s3Console);
  if (services.includes('clamav')) {
    await assertPortFree('clamav', env.ports.clamav);
  }

  const up = compose(env, ['up', '-d', ...services]);
  if (up.status !== 0) {
    compose(env, ['down', '-v', '--remove-orphans']);
    throw new StorageScannerIsolationError('COMPOSE_UP_FAILED', `docker compose up falhou: ${up.stderr.trim().slice(0, 500)}`);
  }

  mkdirSync(ctx.runRoot, { recursive: true });
  writeFileSync(
    env.markerPath,
    `${JSON.stringify({ project: env.project, runId: ctx.runId, ports: env.ports, services, createdAt: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o600 },
  );
  chmodSync(env.markerPath, 0o600);
  return env;
}

export async function waitForStorageScanner(env: StorageScannerEnv, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const checks: Array<[string, string]> = [[env.s3Endpoint + '/minio/health/live', 'minio']];
  if (env.clamavPort) {
    checks.push([`tcp://127.0.0.1:${env.clamavPort}`, 'clamav']);
  }
  for (const [target, label] of checks) {
    let ok = false;
    while (Date.now() < deadline) {
      if (target.startsWith('tcp://')) {
        const [, rest] = target.split('://');
        const [host, port] = rest.split(':');
        ok = await new Promise<boolean>((resolve) => {
          const socket = net.createConnection({ host, port: Number(port) });
          socket.once('connect', () => { socket.destroy(); resolve(true); });
          socket.once('error', () => resolve(false));
        });
      } else {
        try {
          const response = await fetch(target);
          ok = response.ok;
        } catch {
          ok = false;
        }
      }
      if (ok) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!ok) {
      throw new StorageScannerIsolationError('SERVICE_NOT_READY', `${label} nao ficou pronto em ${timeoutMs}ms`);
    }
  }
}

export function teardownStorageScanner(ctx: RunContext): Record<string, unknown> {
  const env = storageScannerContext(ctx);
  if (!existsSync(env.markerPath)) {
    return { project: env.project, skipped: 'sem marcador deste run (nada proprio a derrubar)' };
  }
  const marker = JSON.parse(readFileSync(env.markerPath, 'utf8')) as { project: string };
  if (marker.project !== env.project) {
    throw new StorageScannerIsolationError('MARKER_CONFLICT', `recusando derrubar ${marker.project} a partir do run ${env.project}`);
  }
  const down = compose(env, ['down', '-v', '--remove-orphans']);
  return { project: env.project, status: down.status, stderr: down.stderr.trim().slice(0, 300) };
}

void randomBytes;
