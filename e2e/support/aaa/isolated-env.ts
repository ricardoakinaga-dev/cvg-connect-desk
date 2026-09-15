import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertIsolatedDatabaseUrl, assertIsolatedRedisUrl, startPostgres, stopPostgres, verifyMarker } from './pg.ts';
import { findRedisBinary, redisPing, startRedis, stopRedis } from './redis.ts';
import { ensureEvidenceDir, getRunContext, type RunContext } from './run-context.ts';

export interface IsolatedEnv {
  runId: string;
  databaseUrl: string;
  databaseName: string;
  databasePort: number;
  redisUrl: string;
  redisPort: number;
  sourceRevision: string;
  postgres: { status: string; pid: number | null; dataDir: string };
  redis: { status: string; pid: number | null; binarySource: string };
  marker: { runId: string; sourceRevision: string; createdAt: string };
}

function sourceRevision(): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Nao foi possivel obter revisao: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export async function provisionIsolatedEnv(ctx: RunContext = getRunContext()): Promise<IsolatedEnv> {
  const revision = sourceRevision();

  assertIsolatedDatabaseUrl(ctx.databaseUrl, {
    port: ctx.ports.postgres,
    databaseName: ctx.databaseName,
  });
  assertIsolatedRedisUrl(ctx.redisUrl, { port: ctx.ports.redis });

  const postgres = await startPostgres(ctx, revision);
  const marker = verifyMarker(ctx);
  const redis = await startRedis(ctx);
  const redisBinary = findRedisBinary();

  if (!(await redisPing(ctx))) {
    throw new Error(`Redis provisionado mas sem resposta PING em ${ctx.redisUrl}.`);
  }

  const env: IsolatedEnv = {
    runId: ctx.runId,
    databaseUrl: ctx.databaseUrl,
    databaseName: ctx.databaseName,
    databasePort: ctx.ports.postgres,
    redisUrl: ctx.redisUrl,
    redisPort: ctx.ports.redis,
    sourceRevision: revision,
    postgres: { status: postgres.status, pid: postgres.pid, dataDir: postgres.dataDir },
    redis: { status: redis.status, pid: redis.pid, binarySource: redisBinary.source },
    marker,
  };

  const evidenceDir = ensureEvidenceDir(ctx);
  writeFileSync(join(evidenceDir, 'isolated-env.json'), `${JSON.stringify(env, null, 2)}\n`);
  return env;
}

export function teardownIsolatedEnv(
  ctx: RunContext = getRunContext(),
  options: { dropDatabase?: boolean; stopServices?: boolean } = {},
): Record<string, unknown> {
  const result: Record<string, unknown> = { runId: ctx.runId };

  if (options.stopServices) {
    result.redis = stopRedis(ctx);
    result.postgres = stopPostgres(ctx, { dropDatabase: options.dropDatabase === true });
  } else if (options.dropDatabase) {
    throw new Error('dropDatabase exige stopServices=true para nao remover banco em uso.');
  }

  return result;
}
