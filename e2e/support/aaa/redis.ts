import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { isProcessAlive, isTcpOpen, IsolationError } from './pg.ts';
import { ensureRunDirs, type RunContext } from './run-context.ts';

export interface RedisBinary {
  path: string;
  env: NodeJS.ProcessEnv;
  source: string;
}

export interface RedisStatus {
  status: 'started' | 'already-ours';
  port: number;
  pid: number | null;
}

interface RedisCandidate {
  path: string;
  env: NodeJS.ProcessEnv;
  source: string;
}

function runtimeRoot(): string {
  return join(process.env.HOME || '', '.local', 'share', 'cvg-his-v4-runtime', 'root');
}

function redisCandidates(): RedisCandidate[] {
  const root = runtimeRoot();
  const runtimeEnv = {
    ...process.env,
    LD_LIBRARY_PATH: [
      join(root, 'usr', 'lib', 'x86_64-linux-gnu'),
      join(root, 'usr', 'lib'),
      join(root, 'lib', 'x86_64-linux-gnu'),
      process.env.LD_LIBRARY_PATH,
    ].filter(Boolean).join(':'),
  };

  return [
    process.env.AAA_REDIS_BIN
      ? { path: process.env.AAA_REDIS_BIN, env: { ...process.env }, source: 'AAA_REDIS_BIN' }
      : undefined,
    { path: join(root, 'usr', 'bin', 'redis-server'), env: runtimeEnv, source: 'cvg-his-v4-runtime' },
    { path: '/tmp/opencode/redis-src/src/redis-server', env: { ...process.env }, source: 'redis-stable-compilado' },
    { path: 'redis-server', env: { ...process.env }, source: 'PATH' },
  ].filter((candidate): candidate is RedisCandidate => Boolean(candidate));
}

export function findRedisBinary(): RedisBinary {
  for (const candidate of redisCandidates()) {
    if (candidate.path.includes('/') && !existsSync(candidate.path)) {
      continue;
    }
    const probe = spawnSync(candidate.path, ['--version'], { encoding: 'utf8', env: candidate.env });
    if (probe.status === 0 && `${probe.stdout}${probe.stderr}`.includes('Redis server')) {
      return candidate;
    }
  }

  throw new IsolationError(
    'REDIS_BIN_NOT_FOUND',
    'Binario redis-server nao encontrado. Defina AAA_REDIS_BIN para um redis-server 7+ executavel.',
  );
}

async function ping(port: number, timeoutMs = 500): Promise<string | null> {
  return await new Promise<string | null>((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let data = '';
    const finish = (value: string | null) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => socket.write('PING\r\n'));
    socket.on('data', (chunk) => {
      data += chunk.toString();
      if (data.includes('PONG')) {
        finish('PONG');
      }
    });
    socket.once('timeout', () => finish(null));
    socket.once('error', () => finish(null));
  });
}

export async function startRedis(ctx: RunContext): Promise<RedisStatus> {
  const binary = findRedisBinary();
  const dataDir = ensureRunDirs(ctx, 'redis');
  const pidFile = join(dataDir, `redis-${ctx.ports.redis}.pid`);
  const logFile = join(dataDir, 'redis.log');

  const existing = readRedisPid(pidFile, ctx);
  if (existing && isProcessAlive(existing)) {
    if ((await ping(ctx.ports.redis)) === 'PONG') {
      return { status: 'already-ours', port: ctx.ports.redis, pid: existing };
    }
  }

  if (await isTcpOpen('127.0.0.1', ctx.ports.redis)) {
    throw new IsolationError(
      'REDIS_PORT_BUSY',
      `Porta ${ctx.ports.redis} ocupada por processo que nao pertence ao run ${ctx.runId}. Escolha outra AAA_REDIS_PORT.`,
    );
  }

  const child = spawn(binary.path, [
    '--bind', '127.0.0.1',
    '--protected-mode', 'no',
    '--port', String(ctx.ports.redis),
    '--save', '',
    '--appendonly', 'no',
    '--dir', dataDir,
    '--pidfile', pidFile,
    '--logfile', logFile,
    '--daemonize', 'no',
  ], {
    detached: true,
    stdio: 'ignore',
    env: binary.env,
  });
  child.unref();

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if ((await ping(ctx.ports.redis)) === 'PONG') {
      return { status: 'started', port: ctx.ports.redis, pid: readRedisPid(pidFile, ctx) };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new IsolationError('REDIS_NOT_READY', `Redis nao respondeu PING na porta ${ctx.ports.redis}. Log: ${logFile}`);
}

function readRedisPid(pidFile: string, ctx: RunContext): number | null {
  if (!existsSync(pidFile)) {
    return null;
  }
  try {
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    if (!Number.isInteger(pid) || pid <= 0) {
      return null;
    }
    return pid;
  } catch {
    return null;
  }
}

function commandLineMatches(pid: number, ctx: RunContext): boolean {
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    return cmdline.includes('redis-server') && cmdline.includes(String(ctx.ports.redis));
  } catch {
    return false;
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function stopRedis(ctx: RunContext): { stopped: boolean; pid: number | null } {
  const pidFile = join(ctx.runRoot, 'redis', `redis-${ctx.ports.redis}.pid`);
  const pid = readRedisPid(pidFile, ctx);

  if (!pid || !isProcessAlive(pid)) {
    return { stopped: false, pid: null };
  }

  if (!commandLineMatches(pid, ctx)) {
    throw new IsolationError(
      'REDIS_STOP_REFUSED',
      `Recusado parar pid ${pid}: cmdline nao corresponde ao redis do run ${ctx.runId} na porta ${ctx.ports.redis}.`,
    );
  }

  process.kill(pid, 'SIGTERM');
  // Aguarda a saida efetiva para que teardowns em sequencia sejam idempotentes
  // (sem corrida entre o SIGTERM e a remocao do pidfile).
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && isProcessAlive(pid)) {
    sleepSync(50);
  }

  return { stopped: !isProcessAlive(pid), pid };
}

export async function redisPing(ctx: RunContext): Promise<boolean> {
  return (await ping(ctx.ports.redis)) === 'PONG';
}
