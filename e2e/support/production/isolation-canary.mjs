// PROD-00 AC2/AC3 — canario positivo/negativo do isolamento e do teardown.
// Usa o harness AAA real (binarios locais), nunca o PostgreSQL de outro projeto.
import { join } from 'node:path';
import { nowIso, productionEvidenceDir, writeJson } from './program.mjs';

const RUN_ID = 'prod00-20260913';
const WORKER_INDEX = Number(process.env.AAA_WORKER_INDEX || 7);

function record(checks, name, ok, detail) {
  checks.push({ name, result: ok ? 'passed' : 'failed', ...(detail ? { detail } : {}) });
  return ok;
}

async function main() {
  const startedAt = nowIso();
  const runId = process.env.AAA_RUN_ID || RUN_ID;
  process.env.CVG_PROGRAM_DIR = process.env.CVG_PROGRAM_DIR
    || join(process.cwd(), 'docs', 'producao-2026-09-13');
  process.env.CVG_RUNTIME_DIR = process.env.CVG_RUNTIME_DIR
    || join(process.env.CVG_PROGRAM_DIR, 'evidencias', 'prod-00', 'runtime');
  process.env.AAA_RUN_ID = runId;
  process.env.AAA_WORKER_INDEX = String(WORKER_INDEX);
  process.env.AAA_RUN_ROOT = process.env.AAA_RUN_ROOT || join('/tmp', 'cvg-aaa-runs', runId);

  const pg = await import('../aaa/pg.ts');
  const isolated = await import('../aaa/isolated-env.ts');
  const redisMod = await import('../aaa/redis.ts');
  const runContext = await import('../aaa/run-context.ts');

  const ctx = runContext.getRunContext(WORKER_INDEX);
  const checks = [];
  const failures = [];

  // 1) Guardas negativas: URLs sem marcador, host remoto, porta errada, banco proibido.
  const guardCases = [
    { name: 'recusa_banco_sem_marcador', url: 'postgresql://connect_desk:root@localhost:55432/connect_desk_db', expected: 'DB_URL_NO_TEST_MARKER', expectedArgs: {} },
    { name: 'recusa_host_remoto', url: 'postgresql://cvg_aaa@db.example.com:56432/cvg_aaa_x', expected: 'DB_URL_REMOTE_HOST', expectedArgs: {} },
    { name: 'recusa_porta_divergente', url: `postgresql://cvg_aaa@127.0.0.1:5432/${ctx.databaseName}`, expected: 'DB_URL_WRONG_PORT', expectedArgs: { port: ctx.ports.postgres } },
    { name: 'recusa_banco_proibido', url: 'postgresql://cvg_aaa@127.0.0.1:56432/evolution', expected: 'DB_URL_NO_TEST_MARKER', expectedArgs: { databaseName: 'evolution' } },
    { name: 'recusa_banco_de_outro_run', url: `postgresql://cvg_aaa@127.0.0.1:${ctx.ports.postgres}/cvg_aaa_outro`, expected: 'DB_URL_WRONG_DATABASE', expectedArgs: { databaseName: ctx.databaseName, port: ctx.ports.postgres } },
    { name: 'recusa_redis_porta_divergente', redis: true, url: 'redis://127.0.0.1:6379', expected: 'REDIS_URL_WRONG_PORT', expectedArgs: { port: ctx.ports.redis } },
  ];

  for (const guardCase of guardCases) {
    try {
      if (guardCase.redis) {
        pg.assertIsolatedRedisUrl(guardCase.url, guardCase.expectedArgs);
      } else {
        pg.assertIsolatedDatabaseUrl(guardCase.url, guardCase.expectedArgs);
      }
      if (!record(checks, guardCase.name, false, `aceito indevidamente (esperava ${guardCase.expected})`)) {
        failures.push(guardCase.name);
      }
    } catch (error) {
      const code = error instanceof pg.IsolationError ? error.code : 'UNEXPECTED';
      const ok = record(checks, guardCase.name, code === guardCase.expected, `code=${code}`);
      if (!ok) failures.push(`${guardCase.name} code=${code}`);
    }
  }

  // 2) Guarda positiva: URL do run e aceita.
  try {
    pg.assertIsolatedDatabaseUrl(ctx.databaseUrl, { port: ctx.ports.postgres, databaseName: ctx.databaseName });
    record(checks, 'aceita_banco_do_run', true, ctx.databaseName);
  } catch (error) {
    record(checks, 'aceita_banco_do_run', false, String(error));
    failures.push('aceita_banco_do_run');
  }

  // 3) Provisionamento real com marcador e teardown idempotente.
  let canarySummary;
  try {
    const env = await isolated.provisionIsolatedEnv(ctx);
    const markerOk = env.marker.runId === ctx.runId
      && /^cvg_aaa_[a-z0-9_]+$/.test(env.databaseName);
    record(checks, 'provisiona_pg_redis_marcados', markerOk, `${env.databaseName} pg=${env.postgres.status} redis=${env.redis.status}`);

    const one = pg.queryOne(ctx, 'SELECT 1');
    record(checks, 'postgres_isolado_responde', one === '1', `select1=${one}`);
    const tz = pg.queryOne(ctx, "SHOW TimeZone");
    const db = pg.queryOne(ctx, 'SELECT current_database()');
    record(checks, 'isolamento_de_banco_conferido', db === ctx.databaseName, `db=${db} timezone=${tz}`);

    const redisPing = await redisMod.redisPing(ctx);
    record(checks, 'redis_isolado_responde', redisPing === true, `ping=${redisPing}`);

    // Segunda chamada deve ser idempotente (nada pertence mais ao run).
    const first = isolated.teardownIsolatedEnv(ctx, { stopServices: true, dropDatabase: true });
    const second = isolated.teardownIsolatedEnv(ctx, { stopServices: true, dropDatabase: true });
    const firstStopped = first.postgres?.stopped === true && first.redis?.stopped === true;
    const secondNoop = second.postgres?.stopped === false && second.redis?.stopped === false;
    record(checks, 'teardown_para_servicos_do_run', firstStopped, JSON.stringify(first));
    const idempotent = record(checks, 'teardown_idempotente', secondNoop, JSON.stringify(second));
    if (!idempotent) failures.push('teardown_idempotente');

    canarySummary = {
      runId: ctx.runId,
      workerIndex: ctx.workerIndex,
      ports: ctx.ports,
      databaseName: env.databaseName,
      databaseUrl: env.databaseUrl,
      redisUrl: env.redisUrl,
      marker: env.marker,
      postgresStatus: env.postgres.status,
      redisStatus: env.redis.status,
    };
  } catch (error) {
    record(checks, 'provisiona_pg_redis_marcados', false, String(error));
    failures.push(`provisionamento: ${String(error)}`);
    try {
      isolated.teardownIsolatedEnv(ctx, { stopServices: true, dropDatabase: true });
    } catch {
      // teardown best-effort apos falha
    }
  }

  const failedChecks = checks.filter((check) => check.result !== 'passed').map((check) => check.name);
  const allFailures = [...new Set([...failures, ...failedChecks])];
  const result = {
    task: 'PROD-00',
    criterion: 'PROD-00-AC2/AC3',
    checkedAt: nowIso(),
    startedAt,
    command: `node e2e/support/production/isolation-canary.mjs (runId=${runId})`,
    runId,
    result: failedChecks.length === 0 ? 'PASS' : 'FAIL',
    failures: allFailures,
    checks,
    isolatedEnv: canarySummary ?? null,
  };

  const dir = productionEvidenceDir('isolation');
  writeJson(join(dir, 'canary.json'), result);
  console.log(`[isolation-canary] ${result.result}`);
  for (const check of checks) {
    console.log(`  ${check.result === 'passed' ? 'ok ' : 'ERR'} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
  }
  if (failedChecks.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[isolation-canary] falha fatal:', error);
  process.exitCode = 1;
});
