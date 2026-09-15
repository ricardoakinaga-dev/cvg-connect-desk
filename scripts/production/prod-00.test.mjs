// PROD-00 — verificacao integral do congelamento de candidato e isolamento.
// Cobre AC1-AC4 com casos positivos e negativos; exit 0 isolado nao substitui
// a revisao do integrador nem desbloqueia servicos ausentes.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const PROGRAM_DIR = resolve(
  process.env.CVG_PROGRAM_DIR || join(REPO_ROOT, 'docs', 'producao-2026-09-13'),
);
const EVIDENCE_SEGMENT = process.env.CVG_EVIDENCE_SEGMENT?.trim() || null;
const EVIDENCE = join(PROGRAM_DIR, 'evidencias', 'prod-00', ...(EVIDENCE_SEGMENT ? [EVIDENCE_SEGMENT] : []));
const RUNTIME_DIR = join(EVIDENCE, 'runtime');
const IS_R3 = PROGRAM_DIR.endsWith('docs/melhorias-2026-09-13-r3');
const PLAN_VALIDATE = IS_R3
  ? 'docs/melhorias-2026-09-13-r3/plan.py'
  : 'docs/producao-2026-09-13/plan.py';
const AUDIT_REPORT = IS_R3
  ? 'docs/auditorias/2026-09-13-r3/RELATORIO.md'
  : 'docs/auditorias/2026-09-13/RELATORIO.md';
const RUN_ID = process.env.AAA_RUN_ID || process.env.R3_RUN_ID || `prod00-${Date.now().toString(36)}`;
const EXPECTED_RUN_ID = RUN_ID.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeoutMs ?? 300_000,
    env: { ...process.env, ...(options.env || {}) },
  });
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function runHarnessEvidence() {
  const harnessDir = join(EVIDENCE, 'harness');
  mkdirSync(harnessDir, { recursive: true });
  const env = {
    ...process.env,
    CVG_PROGRAM_DIR: PROGRAM_DIR,
    CVG_RUNTIME_DIR: RUNTIME_DIR,
    CVG_EVIDENCE_SEGMENT: EVIDENCE_SEGMENT || undefined,
    AAA_RUN_ID: RUN_ID,
    AAA_WORKER_INDEX: process.env.AAA_WORKER_INDEX || '7',
    AAA_RUN_ROOT: process.env.AAA_RUN_ROOT || join('/tmp', 'cvg-aaa-runs', RUN_ID),
    NODE_OPTIONS: '--import tsx',
  };

  const positive = run(
    'pnpm',
    [
      'exec',
      'playwright',
      'test',
      '--config',
      'playwright.production.config.ts',
      'e2e/aaa/00-harness-sanity.spec.ts',
      'e2e/production/01-harness-identity.spec.ts',
    ],
    {
      env: { ...env, AAA_PLAYWRIGHT_JSON: join(harnessDir, 'production-report.json') },
      timeoutMs: 600_000,
    },
  );
  writeFileSync(join(harnessDir, 'http-positive.log'), `${positive.stdout}\n${positive.stderr}`);
  assert.equal(positive.status, 0, `harness positivo falhou: ${positive.stderr.slice(-2000)}`);

  const negative = run(
    'pnpm',
    ['exec', 'playwright', 'test', '--config', 'playwright.production.config.ts', '--project', 'canary'],
    {
      env: {
        ...env,
        AAA_CANARY_MODE: 'fail',
        AAA_PLAYWRIGHT_JSON: join(harnessDir, 'canary-report.json'),
      },
      timeoutMs: 400_000,
    },
  );
  writeFileSync(join(harnessDir, 'http-canary-negative.log'), `${negative.stdout}\n${negative.stderr}`);
  assert.notEqual(negative.status, 0, 'harness negativo deveria falhar');

  const teardown = run(
    'pnpm',
    ['exec', 'tsx', 'e2e/support/aaa/teardown-aaa-env.ts', '--stop-services', '--drop-database'],
    { env, timeoutMs: 120_000 },
  );
  assert.equal(teardown.status, 0, `teardown do harness falhou: ${teardown.stderr}`);
}

if (IS_R3 && (!existsSync(join(EVIDENCE, 'harness', 'production-report.json'))
  || !existsSync(join(EVIDENCE, 'harness', 'canary-report.json')))) {
  runHarnessEvidence();
}

test('AC1 — plano canonico valida e baseline registra worktree sem reset', () => {
  const validate = run('python3', [PLAN_VALIDATE, 'validate']);
  assert.equal(validate.status, 0, `plan.py validate falhou: ${validate.stderr}`);
  assert.match(validate.stdout, new RegExp(`VALID: ${IS_R3 ? 45 : 44} tasks`));

  const baseline = run('node', ['e2e/support/production/baseline.mjs']);
  assert.equal(baseline.status, 0, `baseline falhou: ${baseline.stderr}`);
  assert.ok(existsSync(join(EVIDENCE, 'baseline', 'candidate-manifest.json')), 'manifesto ausente');

  const manifest = JSON.parse(readFileSync(join(EVIDENCE, 'baseline', 'candidate-manifest.json'), 'utf8'));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  assert.equal(manifest.git.revision, head, 'manifesto nao corresponde ao HEAD');
  assert.ok(manifest.git.counts.entries > 0, 'worktree deveria registrar alteracoes preexistentes');
  assert.equal(manifest.git.statusPorcelainSha256.length, 64, 'hash do status ausente');
  assert.ok(manifest.git.diffTrackedBytes > 0, 'diff rastreado deveria ser registrado');
  assert.equal(manifest.audit.match, true, 'SHA-256 do relatorio de auditoria divergente');
  assert.equal(manifest.audit.notesMatch, true, 'SHA-256 de notas.json divergente');
  assert.ok(manifest.lock.lockfileSha256, 'lockfile nao fixado');
  assert.equal(manifest.fileHashes['package.json'], sha256File(join(REPO_ROOT, 'package.json')), 'hash de package.json diverge do arquivo');
  assert.equal(manifest.lock.lockfileSha256, sha256File(join(REPO_ROOT, 'pnpm-lock.yaml')), 'hash do lockfile diverge do arquivo');
  assert.equal(
    manifest.audit.reportSha256,
     sha256File(join(REPO_ROOT, AUDIT_REPORT)),
    'hash do relatorio diverge do arquivo',
  );
  assert.equal(
    manifest.git.statusPorcelainSha256,
    sha256(execFileSync('git', ['status', '--porcelain=v1', ...manifest.git.statusPathspec], { cwd: REPO_ROOT }).toString()),
    'hash do status diverge do git atual',
  );
  assert.ok(manifest.seeds.databaseSeed.sha256, 'seed do banco nao fixado');
  assert.ok(manifest.seeds.aaaFixtures.sha256, 'fixtures AAA nao fixadas');
  assert.ok(manifest.migrations.count >= 23, `migrations registradas: ${manifest.migrations.count}`);
  assert.match(manifest.environment.clock.timezone, /^[\w+-]+\/[\w+-]+$/, 'timezone IANA nao registrado');
  assert.equal(manifest.environment.concurrency.loadProfile.dataset.conversations, 10_000, 'perfil de carga divergente');
  assert.equal(manifest.environment.concurrency.loadProfile.rounds, 3);
  assert.ok(manifest.policy.some((line) => line.includes('reset')), 'politica de nao-reset ausente');
  assert.equal(manifest.images.status, 'BLOCKED', 'imagens deveriam constar BLOCKED com dono enquanto Docker indisponivel');
  assert.ok(manifest.images.owner, 'imagens sem dono');
  assert.ok(manifest.images.dependentTasks.includes('PROD-35'), 'imagens sem tarefas dependentes');
  for (const artifact of [
    'e2e/support/production/baseline.mjs',
    'e2e/support/production/isolation-canary.mjs',
    'playwright.production.config.ts',
    'scripts/production/prod-00.test.mjs',
    'e2e/production/01-harness-identity.spec.ts',
  ]) {
    assert.ok(manifest.fileHashes[artifact], `delta do PROD-00 nao fixado: ${artifact}`);
  }
});

test('AC2/AC3 — canario de isolamento aceita o run e rejeita terceiros', () => {
  const canary = run('node', ['e2e/support/production/isolation-canary.mjs']);
  const reportPath = join(EVIDENCE, 'isolation', 'canary.json');
  assert.ok(existsSync(reportPath), 'canary.json ausente');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const checks = new Map(report.checks.map((check) => [check.name, check]));
  for (const required of [
    'recusa_banco_sem_marcador',
    'recusa_host_remoto',
    'recusa_porta_divergente',
    'recusa_banco_proibido',
    'recusa_banco_de_outro_run',
    'recusa_redis_porta_divergente',
    'aceita_banco_do_run',
    'provisiona_pg_redis_marcados',
    'postgres_isolado_responde',
    'redis_isolado_responde',
    'teardown_para_servicos_do_run',
    'teardown_idempotente',
  ]) {
    assert.ok(checks.has(required), `canario sem caso ${required}`);
    assert.equal(checks.get(required).result, 'passed', `caso ${required} nao passou: ${JSON.stringify(checks.get(required))}`);
  }
  assert.equal(canary.status, 0, `canario falhou (exit ${canary.status}): ${canary.stdout}\n${canary.stderr}`);
  assert.equal(report.result, 'PASS', `canario reportou ${report.result}: ${report.failures.join('; ')}`);
   assert.equal(report.isolatedEnv.marker.runId, EXPECTED_RUN_ID, 'marcador sem runId do PROD-00');
  assert.notEqual(report.isolatedEnv.databaseUrl, undefined);
  assert.ok(report.startedAt && report.checkedAt, 'canario sem janela temporal');
});

test('AC3 — disponibilidade registrada; ausente bloqueia com dono e prova dependente', () => {
  const availability = JSON.parse(readFileSync(join(EVIDENCE, 'environment', 'availability.json'), 'utf8'));
  assert.ok(availability.services.postgresql, 'servico postgresql ausente do inventario');
  assert.ok(availability.services.redis, 'servico redis ausente do inventario');
  assert.ok(availability.services.minio, 'servico minio ausente do inventario');
  assert.ok(availability.services.clamav, 'servico clamav ausente do inventario');
  assert.ok(availability.services.otelCollector, 'servico otel ausente do inventario');
  for (const [name, service] of Object.entries(availability.services)) {
    assert.match(service.status, /^(AVAILABLE|BLOCKED|BINARY_ONLY)$/, `${name} com status invalido`);
    if (service.status === 'BLOCKED') {
      assert.ok(service.blocker, `${name} bloqueado sem causa registrada`);
      assert.ok(service.owner, `${name} bloqueado sem dono`);
      assert.ok(Array.isArray(service.unblocks) || ['postgresql', 'redis', 'browserChromium', 'loadGenerator', 'osvScanner'].includes(name),
        `${name} bloqueado sem tarefas dependentes`);
    }
  }
  assert.match(availability.policy, /bloqueia apenas a prova dependente/);
  assert.equal(availability.services.postgresql.status, 'AVAILABLE', 'PostgreSQL local deveria estar disponivel');
  assert.equal(availability.services.redis.status, 'AVAILABLE', 'Redis local deveria estar disponivel');
});

test('AC3 — configuracao production existe, lista as suites e o bootstrap e real', () => {
  const config = readFileSync(join(REPO_ROOT, 'playwright.production.config.ts'), 'utf8');
  assert.match(config, /testMatch:\s*\[[^\]]*'aaa\/\*\*\/\*\.spec\.ts'/, 'config sem suites aaa');
  assert.match(config, /production\/\*\*\/\*\.spec\.ts/, 'config sem suites production');
  assert.match(config, /name: 'canary'/, 'config sem projeto canary');
  assert.ok(existsSync(join(REPO_ROOT, 'e2e/production/01-harness-identity.spec.ts')), 'suite production inexistente');
  const listed = run('pnpm', ['exec', 'playwright', 'test', '--config', 'playwright.production.config.ts', '--list'], {
    timeoutMs: 120_000,
    env: { NODE_OPTIONS: '--import tsx' },
  });
  assert.equal(listed.status, 0, `config production nao carrega: ${listed.stderr}`);
  assert.match(listed.stdout, /00-harness-sanity/, 'suite de sanidade ausente do listamento');
  assert.match(listed.stdout, /01-harness-identity/, 'suite production ausente do listamento');
  assert.doesNotMatch(listed.stdout, /\.spec\.js/, 'listamento inclui duplicatas compiladas .js');
});

test('AC2 — caminho AAA usado nao contem fuser nem nomes fixos de banco', () => {
  for (const relativePath of [
    'e2e/support/aaa/run-context.ts',
    'e2e/support/aaa/pg.ts',
    'e2e/support/aaa/redis.ts',
    'e2e/support/aaa/isolated-env.ts',
    'e2e/support/aaa/teardown-aaa-env.ts',
  ]) {
    const source = readFileSync(join(REPO_ROOT, relativePath), 'utf8');
    assert.doesNotMatch(source, /\bfuser\b/, `${relativePath} usa fuser`);
  }
  const runContext = readFileSync(join(REPO_ROOT, 'e2e/support/aaa/run-context.ts'), 'utf8');
  assert.doesNotMatch(runContext, /connect_desk_db|evolution_db/, 'run-context referencia banco alheio');
  const pgSource = readFileSync(join(REPO_ROOT, 'e2e/support/aaa/pg.ts'), 'utf8');
  assert.match(pgSource, /FORBIDDEN_DATABASE_NAMES/, 'pg.ts deve manter lista de bancos proibidos');
});

test('AC4 — indice de evidencia com hashes, comando e janela', () => {
  const artifacts = [
    'baseline/candidate-manifest.json',
    'baseline/git-status.txt',
    'baseline/diff-stat.txt',
    'baseline/hash-before.txt',
    'environment/availability.json',
    'isolation/canary.json',
    'harness/production-report.json',
    'harness/canary-report.json',
    'harness/http-positive.log',
    'harness/http-canary-negative.log',
  ];
  const index = {
    task: 'PROD-00',
    generatedAt: new Date().toISOString(),
    command: 'node --test scripts/production/prod-00.test.mjs',
    environment: 'synthetic-isolated (PG/Redis por run, Docker bloqueado)',
    artifacts: {},
  };
  for (const relative of artifacts) {
    const path = join(EVIDENCE, relative);
    if (existsSync(path)) {
      index.artifacts[relative] = { sha256: sha256File(path), bytes: readFileSync(path).length };
    } else {
      index.artifacts[relative] = { sha256: null, bytes: null };
    }
  }
  assert.ok(index.artifacts['isolation/canary.json'].sha256, 'canary sem hash de evidencia');
  assert.ok(index.artifacts['baseline/candidate-manifest.json'].sha256, 'manifesto sem hash de evidencia');
  assert.ok(index.artifacts['harness/production-report.json'].sha256, 'report HTTP positivo sem hash de evidencia');
  mkdirSync(RUNTIME_DIR, { recursive: true });
  mkdirSync(join(EVIDENCE, 'checks'), { recursive: true });
  writeFileSync(join(EVIDENCE, 'checks', 'evidence-index.json'), `${JSON.stringify(index, null, 2)}\n`);
});

test('AC3 — prova HTTP real: positivo 6/6 sem skip e canario negativo rejeitado', () => {
  const positivePath = join(EVIDENCE, 'harness', 'production-report.json');
  const negativePath = join(EVIDENCE, 'harness', 'canary-report.json');
  if (!existsSync(positivePath) || !existsSync(negativePath)) {
    runHarnessEvidence();
  }
  const positive = JSON.parse(readFileSync(positivePath, 'utf8'));
  const negative = JSON.parse(readFileSync(negativePath, 'utf8'));
  assert.equal(positive.stats.expected, 6, 'HTTP positivo deveria ter 6 testes esperados');
  assert.equal(positive.stats.skipped, 0, 'HTTP positivo nao pode ter skip');
  assert.equal(positive.stats.unexpected, 0, 'HTTP positivo nao pode ter falha');
  assert.equal(negative.stats.expected, 0, 'canario negativo nao pode passar');
  assert.equal(negative.stats.skipped, 0, 'canario negativo nao pode ser pulado');
  assert.equal(negative.stats.unexpected, 1, 'canario negativo deve falhar exatamente uma vez');

  const positiveLog = readFileSync(join(EVIDENCE, 'harness', 'http-positive.log'), 'utf8');
  assert.match(positiveLog, /6 passed/, 'log HTTP positivo sem 6 passed');
  const negativeLog = readFileSync(join(EVIDENCE, 'harness', 'http-canary-negative.log'), 'utf8');
  assert.match(negativeLog, /1 failed/, 'log do canario negativo sem 1 failed');
  assert.doesNotMatch(negativeLog, /skipped/, 'canario negativo registrou skip');
});

test('AC3 — rerun HTTP reproduzivel quando PROD00_HTTP_CANARY=1', () => {
  if (process.env.PROD00_HTTP_CANARY !== '1') {
    // Sem a flag, a prova HTTP registrada e validada no teste anterior; o rerun
    // pesado e opcional e nao conta como skip do aceite.
    return;
  }
  const runId = `prod00-http-${Date.now().toString(36)}`;
  const env = {
    ...process.env,
     CVG_PROGRAM_DIR: PROGRAM_DIR,
     CVG_RUNTIME_DIR: RUNTIME_DIR,
     CVG_EVIDENCE_SEGMENT: EVIDENCE_SEGMENT || undefined,
    AAA_RUN_ID: runId,
    AAA_WORKER_INDEX: '9',
    AAA_RUN_ROOT: join('/tmp', 'cvg-aaa-runs', runId),
    // Relatorios do rerun vao para arquivos proprios: nunca sobrescrevem a
    // evidencia base (production-report.json pertence ao positivo 6/6).
    AAA_PLAYWRIGHT_JSON: join(EVIDENCE, 'harness', 'rerun-positive-report.json'),
    NODE_OPTIONS: '--import tsx',
  };
  const positive = run('pnpm', ['exec', 'playwright', 'test', '--config', 'playwright.production.config.ts',
    'e2e/aaa/00-harness-sanity.spec.ts', 'e2e/production/01-harness-identity.spec.ts'], { env, timeoutMs: 600_000 });
  assert.equal(positive.status, 0, `rerun HTTP positivo falhou: ${positive.stderr.slice(-2000)}`);
  const rerunPositive = JSON.parse(readFileSync(join(EVIDENCE, 'harness', 'rerun-positive-report.json'), 'utf8'));
  assert.equal(rerunPositive.stats.expected, 6, 'rerun positivo deveria ter 6 testes');
  assert.equal(rerunPositive.stats.unexpected, 0, 'rerun positivo nao pode falhar');
  assert.equal(rerunPositive.stats.skipped, 0, 'rerun positivo nao pode ter skip');

  const negativeEnv = {
    ...env,
    AAA_CANARY_MODE: 'fail',
    AAA_PLAYWRIGHT_JSON: join(EVIDENCE, 'harness', 'rerun-canary-report.json'),
  };
  const negative = run('pnpm', ['exec', 'playwright', 'test', '--config', 'playwright.production.config.ts', '--project', 'canary'],
    { env: negativeEnv, timeoutMs: 400_000 });
  assert.notEqual(negative.status, 0, 'canario negativo deveria falhar');
  const rerunCanary = JSON.parse(readFileSync(join(EVIDENCE, 'harness', 'rerun-canary-report.json'), 'utf8'));
  assert.equal(rerunCanary.stats.expected, 0, 'rerun canario nao pode passar');
  assert.equal(rerunCanary.stats.skipped, 0, 'rerun canario nao pode ser pulado');
  assert.equal(rerunCanary.stats.unexpected, 1, 'rerun canario deve falhar exatamente uma vez');
  const teardown = run('pnpm', ['exec', 'tsx', 'e2e/support/aaa/teardown-aaa-env.ts', '--stop-services', '--drop-database'], { env });
  assert.equal(teardown.status, 0, `teardown falhou: ${teardown.stderr}`);
});
