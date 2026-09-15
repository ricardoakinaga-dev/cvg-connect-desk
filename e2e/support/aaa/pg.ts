import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { ensureRunDirs, type RunContext } from './run-context.ts';

export interface PgBinaries {
  binDir: string;
  initdb: string;
  pgCtl: string;
  postgres: string;
  createdb: string;
  psql: string;
  pgIsready: string;
}

export interface PostgresStatus {
  status: 'started' | 'reused' | 'already-ours';
  port: number;
  dataDir: string;
  pid: number | null;
}

// O runtime local (cvg-his-v4-runtime) carrega libpq/libssl de suas proprias
// bibliotecas. Sem LD_LIBRARY_PATH explicito, initdb/psql falham mesmo com
// binario presente. O harness precisa ser autossuficiente (PROD-00/AC2).
export function runtimeEnvFor(binDir: string): NodeJS.ProcessEnv {
  const marker = '/cvg-his-v4-runtime/root';
  if (!binDir.includes(marker)) {
    return { ...process.env };
  }
  const root = `${binDir.slice(0, binDir.indexOf(marker))}${marker}`;
  const libDirs = [
    join(root, 'usr', 'lib', 'x86_64-linux-gnu'),
    join(root, 'usr', 'lib'),
    join(root, 'lib', 'x86_64-linux-gnu'),
  ];
  return {
    ...process.env,
    LD_LIBRARY_PATH: [...libDirs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
  };
}

export class IsolationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'IsolationError';
    this.code = code;
  }
}

const MARKER_TABLE = 'aaa_environment_marker';
const DATABASE_NAME_PATTERN = /^cvg_aaa_[a-z0-9_]{1,60}$/;
const FORBIDDEN_DATABASE_NAMES = new Set([
  'postgres',
  'template0',
  'template1',
  'connect_desk_db',
  'cvg_suite',
  'evolution',
]);

function unique(candidates: Array<string | undefined>): string[] {
  return [...new Set(candidates.filter((value): value is string => Boolean(value)))];
}

export function findPgBinaries(): PgBinaries {
  const candidates = unique([
    process.env.AAA_PG_BIN,
    process.env.CVG_LOCAL_PG_BIN,
    join(process.env.HOME || '', '.local', 'share', 'cvg-his-v4-runtime', 'root', 'usr', 'lib', 'postgresql', '16', 'bin'),
    '/usr/lib/postgresql/16/bin',
    '/usr/lib/postgresql/15/bin',
  ]);

  for (const binDir of candidates) {
    const binaries: PgBinaries = {
      binDir,
      initdb: join(binDir, 'initdb'),
      pgCtl: join(binDir, 'pg_ctl'),
      postgres: join(binDir, 'postgres'),
      createdb: join(binDir, 'createdb'),
      psql: join(binDir, 'psql'),
      pgIsready: join(binDir, 'pg_isready'),
    };

    if (
      existsSync(binaries.initdb)
      && existsSync(binaries.pgCtl)
      && existsSync(binaries.postgres)
      && existsSync(binaries.createdb)
      && existsSync(binaries.psql)
    ) {
      return binaries;
    }
  }

  throw new IsolationError(
    'PG_BIN_NOT_FOUND',
    'Binarios do PostgreSQL nao encontrados. Defina AAA_PG_BIN apontando para um diretorio com initdb/pg_ctl/postgres.',
  );
}

function run(command: string, args: string[], options: SpawnSyncOptions = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });

  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  };
}

function runLogged(command: string, args: string[], logFile: string, options: SpawnSyncOptions = {}) {
  const result = run(command, args, options);
  const entry = [
    `$ ${command} ${args.join(' ')}`,
    `exit=${result.status}`,
    result.stdout.trim(),
    result.stderr.trim(),
    '',
  ].join('\n');
  mkdirSync(dirname(logFile), { recursive: true });
  writeFileSync(logFile, entry, { flag: 'a' });
  return result;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  // Um processo zumbi ainda aceita kill(pid,0). Em espera sincrona (Atomics.wait)
  // o event loop nao faz o reap e o zumbi pareceria vivo; consultamos /proc.
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rparen = stat.lastIndexOf(')');
    if (stat.slice(rparen + 2, rparen + 3) === 'Z') {
      return false;
    }
  } catch {
    // sem /proc legivel: mantem a resposta do kill(pid, 0)
  }
  return true;
}

export async function isTcpOpen(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (value: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

export function readPostmasterPid(dataDir: string): { pid: number; port: number } | null {
  const pidFile = join(dataDir, 'postmaster.pid');
  if (!existsSync(pidFile)) {
    return null;
  }

  try {
    const lines = readFileSync(pidFile, 'utf8').split('\n');
    const pid = Number(lines[0]);
    const port = Number(lines[3]);
    if (!Number.isInteger(pid) || !Number.isInteger(port)) {
      return null;
    }
    return { pid, port };
  } catch {
    return null;
  }
}

export function postgresPath(ctx: RunContext): { dataDir: string; socketDir: string; logFile: string } {
  const dataDir = join(ctx.runRoot, 'pg', 'data');
  const socketDir = join(ctx.runRoot, 'pg', 'run');
  return { dataDir, socketDir, logFile: join(ctx.runRoot, 'pg', 'postgres.log') };
}

export function assertIsolatedDatabaseUrl(
  raw: string,
  expected?: { port?: number; databaseName?: string; runId?: string },
): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new IsolationError('DB_URL_INVALID', `DATABASE_URL invalida: ${raw}`);
  }

  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) {
    throw new IsolationError('DB_URL_SCHEME', `DATABASE_URL deve usar postgres/postgresql, recebido "${parsed.protocol}".`);
  }

  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new IsolationError(
      'DB_URL_REMOTE_HOST',
      `DATABASE_URL aponta para host remoto "${parsed.hostname}". Somente loopback e aceito para dados sinteticos.`,
    );
  }

  const port = Number(parsed.port || '5432');
  if (expected?.port !== undefined && port !== expected.port) {
    throw new IsolationError(
      'DB_URL_WRONG_PORT',
      `DATABASE_URL usa porta ${port}, esperado ${expected.port} do run isolado.`,
    );
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new IsolationError(
      'DB_URL_NO_TEST_MARKER',
      `DATABASE_URL recusada: banco "${databaseName}" sem marcador de teste (esperado padrao cvg_aaa_*).`,
    );
  }

  if (FORBIDDEN_DATABASE_NAMES.has(databaseName)) {
    throw new IsolationError('DB_URL_FORBIDDEN', `DATABASE_URL aponta para banco proibido: "${databaseName}".`);
  }

  if (expected?.databaseName && databaseName !== expected.databaseName) {
    throw new IsolationError(
      'DB_URL_WRONG_DATABASE',
      `DATABASE_URL usa banco "${databaseName}", esperado "${expected.databaseName}".`,
    );
  }

  return parsed;
}

export function assertIsolatedRedisUrl(raw: string, expected?: { port?: number }): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new IsolationError('REDIS_URL_INVALID', `REDIS_URL invalida: ${raw}`);
  }

  if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
    throw new IsolationError('REDIS_URL_SCHEME', `REDIS_URL deve usar redis/rediss, recebido "${parsed.protocol}".`);
  }

  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new IsolationError('REDIS_URL_REMOTE_HOST', `REDIS_URL aponta para host remoto "${parsed.hostname}".`);
  }

  const port = Number(parsed.port || '6379');
  if (expected?.port !== undefined && port !== expected.port) {
    throw new IsolationError('REDIS_URL_WRONG_PORT', `REDIS_URL usa porta ${port}, esperado ${expected.port}.`);
  }

  return parsed;
}

function psqlEnv(ctx: RunContext): NodeJS.ProcessEnv {
  return {
    ...runtimeEnvFor(findPgBinaries().binDir),
    PGHOST: '127.0.0.1',
    PGPORT: String(ctx.ports.postgres),
    PGUSER: 'cvg_aaa',
    PGDATABASE: ctx.databaseName,
  };
}

function queryScalar(ctx: RunContext, sql: string, database: string = ctx.databaseName): string {
  const binaries = findPgBinaries();
  const result = run(binaries.psql, ['-X', '-v', 'ON_ERROR_STOP=1', '-tAc', sql], {
    env: { ...psqlEnv(ctx), PGDATABASE: database },
  });

  if (result.status !== 0) {
    throw new IsolationError('PG_QUERY_FAILED', `psql falhou (exit ${result.status}): ${result.stderr.trim()}`);
  }

  return result.stdout.trim();
}

export async function startPostgres(ctx: RunContext, sourceRevision: string): Promise<PostgresStatus> {
  const binaries = findPgBinaries();
  const { dataDir, socketDir, logFile } = postgresPath(ctx);
  const bootLog = join(ctx.runRoot, 'pg', 'bootstrap.log');
  mkdirSync(socketDir, { recursive: true });

  const existing = readPostmasterPid(dataDir);
  if (existing && isProcessAlive(existing.pid)) {
    if (existing.port !== ctx.ports.postgres) {
      throw new IsolationError(
        'PG_EXISTING_PORT_MISMATCH',
        `PostgreSQL do run ja roda na porta ${existing.port}, esperado ${ctx.ports.postgres}. Nao reiniciar as cegas.`,
      );
    }
    await waitForPostgres(ctx, logFile);
    await ensureDatabase(ctx, binaries, bootLog);
    await writeMarker(ctx, sourceRevision);
    return { status: 'already-ours', port: ctx.ports.postgres, dataDir, pid: existing.pid };
  }

  if (await isTcpOpen('127.0.0.1', ctx.ports.postgres)) {
    throw new IsolationError(
      'PG_PORT_BUSY',
      `Porta ${ctx.ports.postgres} ocupada por processo que nao pertence ao run ${ctx.runId}. Escolha outra AAA_PG_PORT.`,
    );
  }

  const fresh = !existsSync(join(dataDir, 'PG_VERSION'));
  if (fresh) {
    const init = runLogged(
      binaries.initdb,
      ['-D', dataDir, '-U', 'cvg_aaa', '-A', 'trust', '--encoding=UTF8', '--locale=C'],
      bootLog,
      { env: runtimeEnvFor(binaries.binDir) },
    );
    if (init.status !== 0) {
      throw new IsolationError('PG_INITDB_FAILED', `initdb falhou: ${init.stderr.trim()}`);
    }
  }

  const start = runLogged(
    binaries.pgCtl,
    [
      '-D', dataDir,
      '-l', logFile,
      '-o', `-p ${ctx.ports.postgres} -k ${socketDir} -h 127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off`,
      '-w', '-t', '60',
      'start',
    ],
    bootLog,
    { env: runtimeEnvFor(binaries.binDir) },
  );
  if (start.status !== 0) {
    throw new IsolationError('PG_START_FAILED', `pg_ctl start falhou: ${start.stderr.trim()}`);
  }

  await waitForPostgres(ctx, logFile);
  await ensureDatabase(ctx, binaries, bootLog);
  await writeMarker(ctx, sourceRevision);

  const postmaster = readPostmasterPid(dataDir);
  return { status: 'started', port: ctx.ports.postgres, dataDir, pid: postmaster?.pid ?? null };
}

async function ensureDatabase(ctx: RunContext, binaries: PgBinaries, logFile: string): Promise<void> {
  const exists = queryScalar(ctx, `SELECT 1 FROM pg_database WHERE datname = '${ctx.databaseName.replace(/'/g, "''")}'`, 'postgres');
  if (exists === '1') {
    return;
  }

  const created = runLogged(
    binaries.createdb,
    ['-h', '127.0.0.1', '-p', String(ctx.ports.postgres), '-U', 'cvg_aaa', ctx.databaseName],
    logFile,
    { env: runtimeEnvFor(binaries.binDir) },
  );
  if (created.status !== 0) {
    throw new IsolationError('PG_CREATEDB_FAILED', `createdb falhou: ${created.stderr.trim()}`);
  }
}

async function writeMarker(ctx: RunContext, sourceRevision: string): Promise<void> {
  const sql = [
    `CREATE TABLE IF NOT EXISTS ${MARKER_TABLE} (`,
    '  run_id text PRIMARY KEY,',
    '  source_revision text NOT NULL,',
    "  purpose text NOT NULL DEFAULT 'cvg-aaa isolated synthetic data',",
    '  created_at timestamptz NOT NULL DEFAULT now()',
    ');',
    `INSERT INTO ${MARKER_TABLE} (run_id, source_revision) VALUES ('${ctx.runId}', '${sourceRevision.replace(/'/g, "''")}')`,
    'ON CONFLICT (run_id) DO UPDATE SET source_revision = EXCLUDED.source_revision, created_at = now();',
  ].join('\n');

  const binaries = findPgBinaries();
  const result = run(binaries.psql, ['-X', '-v', 'ON_ERROR_STOP=1', '-c', sql], { env: psqlEnv(ctx) });
  if (result.status !== 0) {
    throw new IsolationError('PG_MARKER_FAILED', `Falha ao gravar marcador de teste: ${result.stderr.trim()}`);
  }
}

export function verifyMarker(ctx: RunContext): { runId: string; sourceRevision: string; createdAt: string } {
  const row = queryScalar(
    ctx,
    `SELECT run_id || '|' || source_revision || '|' || created_at::text FROM ${MARKER_TABLE} WHERE run_id = '${ctx.runId}'`,
  );
  if (!row) {
    throw new IsolationError('PG_MARKER_MISSING', `Banco ${ctx.databaseName} sem marcador para o run ${ctx.runId}.`);
  }
  const [runId, sourceRevision, createdAt] = row.split('|');
  if (runId !== ctx.runId) {
    throw new IsolationError('PG_MARKER_MISMATCH', `Marcador pertence ao run "${runId}", esperado "${ctx.runId}".`);
  }
  return { runId, sourceRevision, createdAt };
}

export function queryOne(ctx: RunContext, sql: string): string {
  return queryScalar(ctx, sql);
}

export function execSql(ctx: RunContext, sql: string): void {
  const binaries = findPgBinaries();
  const result = run(binaries.psql, ['-X', '-v', 'ON_ERROR_STOP=1', '-c', sql], { env: psqlEnv(ctx) });
  if (result.status !== 0) {
    throw new IsolationError('PG_EXEC_FAILED', `psql falhou: ${result.stderr.trim()}`);
  }
}

async function waitForPostgres(ctx: RunContext, logFile: string, timeoutMs = 30_000): Promise<void> {
  const binaries = findPgBinaries();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = run(
      binaries.pgIsready,
      ['-h', '127.0.0.1', '-p', String(ctx.ports.postgres), '-U', 'cvg_aaa', '-d', 'postgres', '-q'],
      { env: runtimeEnvFor(binaries.binDir) },
    );
    if (result.status === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new IsolationError('PG_NOT_READY', `PostgreSQL nao ficou pronto. Ver log: ${logFile}`);
}

export function stopPostgres(ctx: RunContext, options: { dropDatabase?: boolean } = {}): { stopped: boolean; pid: number | null } {
  const binaries = findPgBinaries();
  const { dataDir, logFile } = postgresPath(ctx);
  const postmaster = readPostmasterPid(dataDir);

  if (!postmaster || !isProcessAlive(postmaster.pid)) {
    return { stopped: false, pid: null };
  }

  if (postmaster.port !== ctx.ports.postgres) {
    throw new IsolationError(
      'PG_STOP_REFUSED_PORT',
      `Recusado parar PostgreSQL: pid file indica porta ${postmaster.port}, esperado ${ctx.ports.postgres}.`,
    );
  }

  if (options.dropDatabase) {
    run(
      binaries.psql,
      ['-X', '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE IF EXISTS "${ctx.databaseName}"`],
      { env: { ...psqlEnv(ctx), PGDATABASE: 'postgres' } },
    );
  }

  const result = runLogged(binaries.pgCtl, ['-D', dataDir, '-m', 'fast', '-w', '-t', '30', 'stop'], logFile, {
    env: runtimeEnvFor(binaries.binDir),
  });
  if (result.status !== 0) {
    throw new IsolationError('PG_STOP_FAILED', `pg_ctl stop falhou: ${result.stderr.trim()}`);
  }

  return { stopped: true, pid: postmaster.pid };
}
