// PROD-00 AC1/AC4 — congelamento do candidato, hashes, ferramentas e perfil.
// Somente leitura do worktree; nao executa reset/clean nem substitui HEAD.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import {
  evidenceDir,
  git,
  gitRaw,
  hasFile,
  nowIso,
  productionEvidenceDir,
  PROGRAM_DIR,
  REPO_ROOT,
  run,
  sha256,
  sha256File,
  writeJson,
} from './program.mjs';
import { collectAvailability, pgBinariesAvailable, redisBinaryAvailable } from './availability.mjs';

const IS_R3 = PROGRAM_DIR.endsWith('docs/melhorias-2026-09-13-r3');
const AUDIT_REPORT = process.env.CVG_AUDIT_REPORT
  || (IS_R3 ? 'docs/auditorias/2026-09-13-r3/RELATORIO.md' : 'docs/auditorias/2026-09-13/RELATORIO.md');
const AUDIT_NOTES = process.env.CVG_AUDIT_NOTES || 'docs/auditorias/2026-09-13/notas.json';
const PLAN_VALIDATE_COMMAND = IS_R3
  ? 'python3 docs/melhorias-2026-09-13-r3/plan.py validate'
  : 'python3 docs/producao-2026-09-13/plan.py validate';
const PLAN_RENDER_COMMAND = IS_R3
  ? 'python3 docs/melhorias-2026-09-13-r3/plan.py render'
  : 'python3 docs/producao-2026-09-13/plan.py render';
const RUN_ID = process.env.AAA_RUN_ID || process.env.R3_RUN_ID || `prod00-${Date.now().toString(36)}`;
const ATTEMPT = Number(process.env.AAA_ATTEMPT || process.env.R3_ATTEMPT || 1);

const KEY_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
  'tsconfig.json',
  'vitest.config.ts',
  'playwright.config.ts',
  'playwright.aaa.config.ts',
  'playwright.production.config.ts',
  'docker-compose.yml',
  'docker-compose.dev.yml',
  'docker-compose.staging.yml',
  'docker-compose.smoke.yml',
  '.env.example',
  '.env.production.example',
  'packages/database/src/schema.ts',
  'packages/database/src/seed.ts',
  'packages/database/src/migrate.ts',
  'packages/database/src/check-migrations.ts',
  'e2e/support/aaa/run-context.ts',
  'e2e/support/aaa/pg.ts',
  'e2e/support/aaa/redis.ts',
  'e2e/support/aaa/fixtures.ts',
  'e2e/support/aaa/isolated-env.ts',
  'e2e/support/aaa/harness-selfcheck.ts',
  'e2e/support/production/program.mjs',
  'e2e/support/production/availability.mjs',
  'e2e/support/production/baseline.mjs',
  'e2e/support/production/isolation-canary.mjs',
  'e2e/production/01-harness-identity.spec.ts',
  'scripts/production/prod-00.test.mjs',
  'scripts/triple-aaa-verify.mjs',
  '.github/scripts/certification-aggregator.mjs',
  '.github/workflows/ci.yml',
  '.github/workflows/triple-aaa-certification.yml',
  '.github/workflows/triple-aaa-gate.yml',
  'docs/auditorias/2026-09-13/RELATORIO.md',
  'docs/auditorias/2026-09-13/notas.json',
  'docs/producao-2026-09-13/BACKLOG.json',
  'docs/producao-2026-09-13/CRITERIOS.md',
  'docs/producao-2026-09-13/CONTRATOS.md',
  'docs/producao-2026-09-13/DECISOES.md',
  'docs/melhorias-2026-09-13-r3/BACKLOG.json',
  'docs/melhorias-2026-09-13-r3/CONTRATOS.md',
  'docs/melhorias-2026-09-13-r3/CRITERIOS.md',
  'docs/melhorias-2026-09-13-r3/DECISOES.md',
  'docs/melhorias-2026-09-13-r3/AGENTE.md',
  'docs/auditorias/2026-09-13-r3/RELATORIO.md',
  'docs/auditorias/2026-09-13-r3/ACHADOS.json',
  'docs/auditorias/2026-09-13-r3/VERIFICACOES.json',
];

const MIGRATIONS_DIR = 'packages/database/supabase/migrations';

function listMigrations() {
  const dir = join(REPO_ROOT, MIGRATIONS_DIR);
  if (!existsSync(dir)) {
    return [];
  }
  const entries = run('ls', [dir]).stdout.split('\n').filter((name) => name.endsWith('.sql')).sort();
  return entries.map((name) => ({ name, sha256: sha256File(join(dir, name)) }));
}

function migrationLedger() {
  const out = [];
  const dir = join(REPO_ROOT, MIGRATIONS_DIR);
  if (!existsSync(dir)) {
    return out;
  }
  for (const name of run('ls', [dir]).stdout.split('\n').filter((n) => n.endsWith('.sql')).sort()) {
    out.push(`${sha256File(join(dir, name))}  ${MIGRATIONS_DIR}/${name}`);
  }
  return out;
}

function environmentFacts() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dateIso = run('date', ['--iso-8601=seconds']).stdout;
  const dateUtc = run('date', ['-u', '+%Y-%m-%dT%H:%M:%SZ']).stdout;
  return {
    clock: { local: dateIso, utc: dateUtc, timezone: tz, TZ: process.env.TZ ?? null },
    locale: run('locale').stdout.split('\n').slice(0, 6),
    host: { cpu: cpus()[0]?.model ?? null, cpuCount: cpus().length, memoryBytes: totalmem() },
    node: process.version,
    concurrency: {
      vitestDefault: 'vitest 3 (pool threads, workers derivados da CPU)',
      playwrightWorkers: Number(process.env.AAA_WORKERS || 1),
      loadProfile: {
        source: IS_R3 ? 'docs/melhorias-2026-09-13-r3/CRITERIOS.md' : 'docs/producao-2026-09-13/CRITERIOS.md',
        dataset: { conversations: 10_000, messages: 100_000, sessions: 100 },
        warmupMinutes: 10,
        measurementMinutes: 30,
        rounds: 3,
        p95: { inboundMs: 250, realtimeMs: 500 },
        unexpectedErrors: '<0.1%',
      },
    },
  };
}

const STATUS_PATHSPEC = [
  '--',
  '.',
  ':(exclude)docs/producao-2026-09-13/evidencias',
  ':(exclude)docs/melhorias-2026-09-13-r3/evidencias',
  ':(exclude)docs/execucao-aaa-2026-09-12/runtime',
];

export async function captureBaseline() {
  const capturedAt = nowIso();
  const revision = git(['rev-parse', 'HEAD']);
  const branch = git(['branch', '--show-current']);
  const statusPorcelain = gitRaw(['status', '--porcelain=v1', ...STATUS_PATHSPEC]);
  const diffFull = git(['diff']); // tracked changes
  const diffStat = git(['diff', '--stat']);
  const worktrees = git(['worktree', 'list', '--porcelain']);
  const stash = git(['stash', 'list']);

  const backlog = JSON.parse(readFileSync(join(PROGRAM_DIR, 'BACKLOG.json'), 'utf8'));
  const reportPath = join(REPO_ROOT, AUDIT_REPORT);
  const notesPath = join(REPO_ROOT, AUDIT_NOTES);
  const reportSha = sha256File(reportPath);
  const notesSha = sha256File(notesPath);

  const runtimeRoot = join(process.env.HOME || '', '.local', 'share', 'cvg-his-v4-runtime', 'root');
  const runtimeEnv = {
    LD_LIBRARY_PATH: [
      join(runtimeRoot, 'usr', 'lib', 'x86_64-linux-gnu'),
      join(runtimeRoot, 'usr', 'lib'),
      join(runtimeRoot, 'lib', 'x86_64-linux-gnu'),
      process.env.LD_LIBRARY_PATH,
    ].filter(Boolean).join(':'),
  };
  const pgInfo = pgBinariesAvailable();
  const pgBinaries = { psql: pgInfo.binDir ? join(pgInfo.binDir, 'psql') : 'psql' };
  const pgEnv = (pgInfo.binDir || '').includes('/cvg-his-v4-runtime/') ? runtimeEnv : {};
  const redisInfo = redisBinaryAvailable();
  const redis = { available: redisInfo.available, bin: redisInfo.bin ?? 'redis-server' };
  const redisEnv = (redisInfo.bin || '').includes('/cvg-his-v4-runtime/') ? runtimeEnv : {};

  const fileHashes = {};
  for (const relativePath of KEY_FILES) {
    if (hasFile(relativePath)) {
      fileHashes[relativePath] = sha256File(join(REPO_ROOT, relativePath));
    } else {
      fileHashes[relativePath] = null;
    }
  }

  const entries = statusPorcelain.split('\n').filter(Boolean).map((line) => ({
    status: line.slice(0, 2),
    path: line.slice(3),
  }));
  const modified = entries.filter((entry) => entry.status.trim() === 'M');
  const untracked = entries.filter((entry) => entry.status === '??');
  const deleted = entries.filter((entry) => entry.status.includes('D'));
  const renamed = entries.filter((entry) => entry.status.includes('R'));

  const tools = {
    node: run('node', ['--version']).stdout,
    pnpm: run('pnpm', ['--version']).stdout,
    git: run('git', ['--version']).stdout,
    python3: run('python3', ['--version']).stdout,
    psql: run(pgBinaries.psql, ['--version'], { env: pgEnv }).stdout,
    redisServer: run(redis.available ? redis.bin : 'redis-server', ['--version'], { env: redisEnv }).stdout,
    playwright: run('pnpm', ['exec', 'playwright', '--version']).stdout,
    k6: run('k6', ['version']).stdout.split('\n')[0] || null,
    turbo: run('pnpm', ['exec', 'turbo', '--version']).stdout,
  };

  const availability = await collectAvailability();

  const manifest = {
    task: 'PROD-00',
    capturedAt,
    execution: {
      runId: RUN_ID,
      attempt: ATTEMPT,
      evidenceSegment: process.env.CVG_EVIDENCE_SEGMENT?.trim() || null,
    },
    criterion: 'PROD-00-AC1/AC4 — baseline reproduzivel, sem reset/clean',
    repository: REPO_ROOT,
    git: {
      revision,
      shortRevision: revision.slice(0, 8),
      branch,
      auditBaselineRevision: backlog.baseline_revision ?? null,
      headEqualsAuditBaseline: revision === (backlog.baseline_revision ?? ''),
      statusPorcelainSha256: sha256(statusPorcelain),
      statusPathspec: STATUS_PATHSPEC,
      diffTrackedSha256: sha256(diffFull),
      diffTrackedBytes: Buffer.byteLength(diffFull),
      diffStat,
      counts: {
        entries: entries.length,
        modified: modified.length,
        untracked: untracked.length,
        deleted: deleted.length,
        renamed: renamed.length,
      },
      worktrees,
      stash,
      preexistingChanges: entries,
    },
    audit: {
      report: AUDIT_REPORT,
      reportSha256: reportSha,
      expectedSha256: backlog.audit_sha256,
      match: reportSha === backlog.audit_sha256,
      notes: AUDIT_NOTES,
      notesSha256: notesSha,
      expectedNotesSha256: backlog.notes_sha256,
      notesMatch: notesSha === backlog.notes_sha256,
    },
    planning: {
      programDir: PROGRAM_DIR,
      validateCommand: PLAN_VALIDATE_COMMAND,
      renderCommand: PLAN_RENDER_COMMAND,
      tasks: backlog.tasks?.length ?? null,
      points: backlog.tasks?.reduce((sum, task) => sum + task.effort_points, 0) ?? null,
    },
    lock: {
      packageManager: 'pnpm@10.33.0',
      lockfileSha256: fileHashes['pnpm-lock.yaml'],
      packageJsonSha256: fileHashes['package.json'],
    },
    seeds: {
      databaseSeed: { path: 'packages/database/src/seed.ts', sha256: fileHashes['packages/database/src/seed.ts'] },
      aaaFixtures: { path: 'e2e/support/aaa/fixtures.ts', sha256: fileHashes['e2e/support/aaa/fixtures.ts'] },
      profiles: ['minimal', 'benchmark? ver fixtures.ts'],
    },
    migrations: { count: listMigrations().length, files: listMigrations() },
    fileHashes,
    environment: environmentFacts(),
    tools,
    availability: {
      docker: availability.docker,
      services: Object.fromEntries(
        Object.entries(availability.services).map(([name, value]) => [name, { status: value.status, detail: value.detail ?? null }]),
      ),
    },
    images: {
      status: 'BLOCKED',
      owner: 'plataforma',
      reason: 'Docker sem permissao no socket e sem sudo nao interativo; nenhuma imagem construida/baixada nesta sessao.',
      inventory: [],
      dependentTasks: ['PROD-35', 'PROD-36', 'PROD-38'],
      policy: 'Digests obrigatorios quando build local/CI estiver disponivel; ausencia bloqueia apenas as provas que exigem imagem.',
    },
    policy: [
      'Alteracoes preexistentes preservadas; baseline reproduzivel por hash de status/diff.',
      'Ausencia de servico nao vira skip/PASS; bloqueia somente a prova dependente.',
      'Nenhum reset/clean/checkout destrutivo foi executado.',
    ],
  };

  const dir = productionEvidenceDir('baseline');
  writeJson(join(dir, 'candidate-manifest.json'), manifest);
  writeFileSync(join(dir, 'git-status.txt'), `${statusPorcelain}\n`);
  writeFileSync(join(dir, 'diff-stat.txt'), `${diffStat}\n`);
  writeFileSync(
    join(dir, 'hash-before.txt'),
    Object.entries(fileHashes)
      .filter(([, hash]) => hash)
      .map(([path, hash]) => `${hash}  ${path}`)
      .join('\n') + '\n',
  );
  writeFileSync(join(dir, 'migration-ledger.txt'), `${migrationLedger().join('\n')}\n`);
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  captureBaseline().then((manifest) => {
    console.log(`[baseline] revision=${manifest.git.shortRevision} branch=${manifest.git.branch}`);
    console.log(`[baseline] changes=${manifest.git.counts.entries} (M=${manifest.git.counts.modified} ??=${manifest.git.counts.untracked})`);
    console.log(`[baseline] audit sha match=${manifest.audit.match} notes match=${manifest.audit.notesMatch}`);
    console.log(`[baseline] locked node=${manifest.tools.node} pnpm=${manifest.tools.pnpm}`);
  });
}
