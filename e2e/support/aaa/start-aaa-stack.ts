import 'dotenv/config';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, openSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { seedFixtureByProfile } from './fixtures.ts';
import { provisionIsolatedEnv } from './isolated-env.ts';
import { ensureEvidenceDir, getRunContext, type RunContext } from './run-context.ts';

const children: ChildProcess[] = [];
let shuttingDown = false;

function buildEnv(ctx: RunContext): NodeJS.ProcessEnv {
  const apiUrl = `http://127.0.0.1:${ctx.ports.api}`;
  const realtimeUrl = `ws://127.0.0.1:${ctx.ports.realtime}`;

  return {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'development',
    DATABASE_URL: ctx.databaseUrl,
    REDIS_URL: ctx.redisUrl,
    PORT: String(ctx.ports.api),
    REALTIME_PORT: String(ctx.ports.realtime),
    DESK_API_URL: apiUrl,
    VITE_API_URL: apiUrl,
    VITE_REALTIME_URL: realtimeUrl,
    EVOLUTION_API_URL: `http://127.0.0.1:${ctx.ports.evolutionMock}`,
    EVOLUTION_MOCK_PORT: String(ctx.ports.evolutionMock),
    CORS_ORIGIN: `http://127.0.0.1:${ctx.ports.web},http://localhost:${ctx.ports.web}`,
    JWT_SECRET: process.env.JWT_SECRET || 'aaa-isolated-fixture-secret-not-for-production',
    INTERNAL_EVENTS_SECRET: process.env.INTERNAL_EVENTS_SECRET || 'aaa-isolated-internal-events-secret',
    USE_DATABASE_OUTBOX: process.env.USE_DATABASE_OUTBOX || 'true',
    // The visual/accessibility matrix opens many isolated browser contexts in
    // one minute. Keep the production limiter enabled, but prevent the
    // harness's own repeated /auth/me bootstrap from masking UI evidence.
    RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX || '10000',
    RATE_LIMIT_LOGIN_MAX: process.env.RATE_LIMIT_LOGIN_MAX || '1000',
    AAA_RUN_ID: ctx.runId,
  };
}

function spawnManaged(ctx: RunContext, command: string, args: string[], label: string, extraEnv: NodeJS.ProcessEnv = {}) {
  // Stdio vai para arquivo do run: se o wrapper morrer, os filhos detached nao
  // seguram os pipes do Playwright (causa de hang no shutdown do webServer).
  const stackDir = join(ctx.runRoot, 'stack');
  mkdirSync(stackDir, { recursive: true });
  const logFd = openSync(join(stackDir, `${label}.log`), 'a');

  const child = spawn(command, args, {
    cwd: ctx.repoRoot,
    detached: true,
    env: { ...buildEnv(ctx), ...extraEnv },
    stdio: ['ignore', logFd, logFd],
  });

  child.on('exit', (code, signal) => {
    if (!shuttingDown && code !== 0 && signal !== 'SIGTERM') {
      console.error(`[aaa-stack] ${label} encerrou inesperadamente (code=${code ?? 'null'} signal=${signal ?? 'null'})`);
      shutdown(ctx, 1);
    }
  });

  children.push(child);
  return child;
}

function shutdown(ctx: RunContext, exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  for (const child of children) {
    if (child.pid && !child.killed) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // processo ja encerrado
      }
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (child.pid && !child.killed) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // processo ja encerrado
        }
      }
    }
    // PostgreSQL e Redis permanecem ativos para inspecao de evidencia;
    // teardown explicito via teardown-aaa-env.ts.
    void ctx;
    process.exit(exitCode);
  }, 1_000).unref();
}

async function waitForHttp(url: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`status ${response.status} para ${url}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }

  throw lastError instanceof Error ? lastError : new Error(`timeout aguardando ${url}`);
}

async function waitForTcp(host: string, port: number, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port });
      socket.once('connect', () => {
        socket.end();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (connected) {
      return;
    }
    await delay(500);
  }
  throw new Error(`timeout aguardando tcp://${host}:${port}`);
}

async function main() {
  const ctx = getRunContext();
  const env = buildEnv(ctx);
  Object.assign(process.env, env);

  const shutdownHandler = () => shutdown(ctx, 0);
  process.on('SIGINT', shutdownHandler);
  process.on('SIGTERM', shutdownHandler);
  process.on('uncaughtException', (error) => {
    console.error('[aaa-stack] excecao nao tratada:', error);
    shutdown(ctx, 1);
  });
  process.on('unhandledRejection', (error) => {
    console.error('[aaa-stack] rejeicao nao tratada:', error);
    shutdown(ctx, 1);
  });

  // Reaper de orfaos: se o processo pai (ex.: Playwright webServer) morrer sem
  // propagar sinal, os filhos detached continuariam servindo a porta. Quando o
  // ppid muda, encerramos o grupo inteiro para nao deixar stack alheia viva.
  const initialPpid = process.ppid;
  const orphanWatch = setInterval(() => {
    if (process.ppid !== initialPpid) {
      console.error(`[aaa-stack] processo pai encerrado (ppid ${initialPpid} -> ${process.ppid}); encerrando stack do run ${ctx.runId}`);
      shutdown(ctx, 1);
    }
  }, 2_000);
  orphanWatch.unref();

  console.log(`[aaa-stack] run=${ctx.runId} pg=${ctx.ports.postgres} redis=${ctx.ports.redis}`);
  const isolated = await provisionIsolatedEnv(ctx);
  console.log(`[aaa-stack] PostgreSQL marcador ok: ${isolated.marker.runId}@${isolated.marker.sourceRevision.slice(0, 8)}`);

  console.log('[aaa-stack] aplicar migrations');
  const migrated = spawnSync('pnpm', ['--filter', '@cvg/database', 'db:migrate'], {
    cwd: ctx.repoRoot,
    env,
    encoding: 'utf8',
  });
  if (migrated.status !== 0) {
    throw new Error(`migrations falharam (exit ${migrated.status}): ${migrated.stderr || migrated.stdout}`);
  }

  console.log('[aaa-stack] semear fixtures sinteticas');
  const seed = await seedFixtureByProfile(ctx);
  console.log(`[aaa-stack] fixtures: ${JSON.stringify(seed.counts)}`);

  console.log('[aaa-stack] iniciar mock Evolution');
  spawnManaged(ctx, 'pnpm', ['exec', 'tsx', 'e2e/support/mock-evolution-server.ts'], 'mock-evolution');
  await waitForHttp(`http://127.0.0.1:${ctx.ports.evolutionMock}/health`);

  console.log('[aaa-stack] iniciar desk-api');
  spawnManaged(ctx, 'pnpm', ['--filter', '@cvg/desk-api', 'exec', 'tsx', 'src/index.ts'], 'desk-api');
  await waitForHttp(`http://127.0.0.1:${ctx.ports.api}/health`);

  console.log('[aaa-stack] iniciar realtime-service');
  spawnManaged(ctx, 'pnpm', ['--filter', '@cvg/realtime-service', 'exec', 'tsx', 'src/index.ts'], 'realtime-service');
  await waitForTcp('127.0.0.1', ctx.ports.realtime);

  console.log('[aaa-stack] iniciar desk-web');
  spawnManaged(
    ctx,
    'pnpm',
    ['--filter', '@cvg/desk-web', 'exec', 'vite', '--host', '127.0.0.1', '--port', String(ctx.ports.web)],
    'desk-web',
  );
  await waitForHttp(`http://127.0.0.1:${ctx.ports.web}/login`);

  const evidenceDir = ensureEvidenceDir(ctx);
  writeFileSync(join(evidenceDir, 'stack.json'), `${JSON.stringify({
    runId: ctx.runId,
    status: 'ready',
    apiUrl: `http://127.0.0.1:${ctx.ports.api}`,
    realtimeUrl: `ws://127.0.0.1:${ctx.ports.realtime}`,
    webUrl: `http://127.0.0.1:${ctx.ports.web}`,
    databaseUrl: ctx.databaseUrl,
    redisUrl: ctx.redisUrl,
    fixtureProfile: process.env.AAA_FIXTURE_PROFILE || 'minimal',
    seed,
  }, null, 2)}\n`);

  console.log(`[aaa-stack] pronto: web=${env.VITE_API_URL ? `http://127.0.0.1:${ctx.ports.web}` : ''} api=${env.VITE_API_URL}`);
  await new Promise<void>(() => {});
}

main().catch((error) => {
  console.error('[aaa-stack] falha ao iniciar:', error);
  process.exit(1);
});
