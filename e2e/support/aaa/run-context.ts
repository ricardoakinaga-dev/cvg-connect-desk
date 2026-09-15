import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// O Playwright carrega a configuração via CommonJS, enquanto o runner
// isolado também é executado pelo tsx/ESM. `import.meta.url` não pode ficar
// neste módulo compartilhado: o transformador CJS do Playwright o preserva e
// o Node então tenta reavaliar o arquivo como ESM. Todos os entrypoints do
// harness definem o repositório como cwd; CVG_REPO_ROOT permite sobrescrever
// isso para invocações externas sem depender do modo de módulos.
export const REPO_ROOT = resolve(process.env.CVG_REPO_ROOT || process.cwd());
// Programa de evidencia ativo. O default preserva o programa historico
// execucao-aaa-2026-09-12; o programa de producao define CVG_PROGRAM_DIR.
export const PROGRAM_DIR = process.env.CVG_PROGRAM_DIR
  ? resolve(process.env.CVG_PROGRAM_DIR)
  : join(REPO_ROOT, 'docs', 'execucao-aaa-2026-09-12');
export const RUNTIME_DIR = process.env.CVG_RUNTIME_DIR
  ? resolve(process.env.CVG_RUNTIME_DIR)
  : join(PROGRAM_DIR, 'runtime');

export interface RunPorts {
  postgres: number;
  redis: number;
  api: number;
  realtime: number;
  web: number;
  evolutionMock: number;
}

export interface RunContext {
  runId: string;
  runRoot: string;
  repoRoot: string;
  runtimeDir: string;
  evidenceDir: string;
  databaseName: string;
  databaseUrl: string;
  redisUrl: string;
  ports: RunPorts;
  workerIndex: number;
}

export function sanitizeRunId(raw: string): string {
  const clean = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  if (!clean) {
    throw new Error(`AAA_RUN_ID invalido: "${raw}" nao produz identificador utilizavel.`);
  }

  return clean;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`${name} invalido: "${raw}" (esperado porta 1-65535).`);
  }
  return value;
}

export function getRunContext(workerIndexOverride?: number): RunContext {
  const workerIndex = workerIndexOverride ?? Number(process.env.AAA_WORKER_INDEX || 0);
  if (!Number.isInteger(workerIndex) || workerIndex < 0 || workerIndex > 50) {
    throw new Error(`AAA_WORKER_INDEX invalido: "${workerIndex}" (esperado inteiro 0-50).`);
  }

  const runId = sanitizeRunId(process.env.AAA_RUN_ID || 'aaa-20260912');
  // AAA_RUN_ROOT explicito e o caminho FINAL do run (ja pode conter o sufixo do
  // worker); so derivamos e sufixamos quando o operador nao o informou. Sem
  // isso, configs que repassam ctx.runRoot produziam "-wN-wN" e o teardown
  // apontava para outro diretorio, deixando PostgreSQL/Redis orfaos.
  const explicitRunRoot = process.env.AAA_RUN_ROOT?.trim();
  const baseRunRoot = explicitRunRoot || join('/tmp', 'cvg-aaa-runs', runId);
  const runRoot = explicitRunRoot
    ? baseRunRoot
    : workerIndex > 0
      ? `${baseRunRoot}-w${workerIndex}`
      : baseRunRoot;

  // Faixa exclusiva AAA-00: nenhuma porta coincide com smoke (55432/56379/4330/4173/4930),
  // com staging (55433/56380/9100/9101/9310/4318/9090/3001/3200/4331/4332/4174)
  // nem com servicos vivos do host (5432/5543/6379/16379/15432/6782/6489).
  // Workers usam passo de 100 (PG) e 10 (Redis) para nao colidir com reservas
  // por agente (ex.: 56442/56681 do Agente 2, 56452/56682 do Agente 4).
  const ports: RunPorts = {
    postgres: envInt('AAA_PG_PORT', 56432 + workerIndex * 100),
    redis: envInt('AAA_REDIS_PORT', 56680 + workerIndex * 10),
    api: envInt('AAA_API_PORT', 4630 + workerIndex * 10),
    realtime: envInt('AAA_REALTIME_PORT', 4931 + workerIndex * 10),
    web: envInt('AAA_WEB_PORT', 4373 + workerIndex * 10),
    evolutionMock: envInt('AAA_EVOLUTION_MOCK_PORT', 8083 + workerIndex),
  };

  const databaseName = `cvg_aaa_${runId.replace(/-/g, '_')}${workerIndex > 0 ? `_w${workerIndex}` : ''}`;

  return {
    runId,
    runRoot,
    repoRoot: REPO_ROOT,
    runtimeDir: RUNTIME_DIR,
    evidenceDir: join(RUNTIME_DIR, 'environment'),
    databaseName,
    databaseUrl: `postgresql://cvg_aaa@127.0.0.1:${ports.postgres}/${databaseName}`,
    redisUrl: `redis://127.0.0.1:${ports.redis}`,
    ports,
    workerIndex,
  };
}

export function ensureRunDirs(ctx: RunContext, ...parts: string[]): string {
  const dir = join(ctx.runRoot, ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureEvidenceDir(ctx: RunContext, ...parts: string[]): string {
  const dir = join(ctx.evidenceDir, ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}
