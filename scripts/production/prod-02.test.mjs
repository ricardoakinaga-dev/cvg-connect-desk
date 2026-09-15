// PROD-02 — regressão do gate mestre vinculado ao candidato (AC1–AC4).
// Executa o CLI real (scripts/triple-aaa-verify.mjs) sobre fixtures sintéticas
// em tmp; nenhum mock da função de veredito. Exit 0 só com tudo verde.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { after, before } from 'node:test';
import {
  DATABASE_ISOLATION_GUARD,
  DEFAULT_CHECKS,
  computeSourceHash,
  deriveArtifactManifest,
  sha256File,
} from './evidence-gate.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const CLI = join(REPO_ROOT, 'scripts', 'triple-aaa-verify.mjs');
const GATE_LIB = join(REPO_ROOT, 'scripts', 'production', 'evidence-gate.mjs');
const CANDIDATE = '0123456789abcdef0123456789abcdef01234567';
const IMAGE_DIGEST = `sha256:${'b'.repeat(64)}`;

let tmpRoot;
let root;
let evidenceDir;
let artifactsDir;
let checksFile;

function runGate(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: tmpRoot,
    env: { ...process.env, GITHUB_RUN_ID: 'prod02-fixture-run', GITHUB_RUN_ATTEMPT: '1' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
}

function readReport(base = root) {
  return JSON.parse(readFileSync(join(base, 'artifacts', 'triple-aaa-report.json'), 'utf8'));
}

function mutateEvidence(name) {
  const dir = join(tmpRoot, `evidence-${name}`);
  cpSync(evidenceDir, dir, { recursive: true });
  return dir;
}

function readManifest(dir, id) {
  return JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'));
}

function writeManifest(dir, id, manifest) {
  writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
}

function sealedCandidateOf(dir = evidenceDir) {
  return JSON.parse(readFileSync(join(dir, 'candidate.json'), 'utf8'));
}

// Payload de artefato/externo com identidade C10 (commit/lock/source) e
// horário dentro da janela do candidato; overrides provam cada rejeição.
function artifactPayload(dir, overrides = {}) {
  const sealed = sealedCandidateOf(dir);
  return `${JSON.stringify(
    {
       runId: sealed.runId,
       attempt: sealed.attempt,
      commit: sealed.commit,
      lockfileSha256: sealed.lockfileSha256,
      sourceSha256: sealed.sourceSha256,
      result: 'PASS',
      generatedAt: new Date().toISOString(),
      profile: { name: 'fixture-hot-paths', dataset: 'fixture-db' },
      budget: { maxTotalCost: 100, maxPlanRows: 1000 },
      ...overrides,
    },
    null,
    2,
  )}\n`;
}

function writePayload(dir, relPath, overrides = {}) {
  const file = join(dir, relPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, artifactPayload(dir, overrides));
}

function evaluateArgs(dir, extra = []) {
  return [
    '--root', root,
    '--checks-file', checksFile,
    '--evidence-dir', dir,
    '--artifacts-dir', artifactsDir,
    '--candidate', CANDIDATE,
    '--image-digest', IMAGE_DIGEST,
    '--evaluate',
    ...extra,
  ];
}

function baseArgs(extra = []) {
  return [
    '--root', root,
    '--checks-file', checksFile,
    '--evidence-dir', evidenceDir,
    '--artifacts-dir', artifactsDir,
    '--candidate', CANDIDATE,
    '--image-digest', IMAGE_DIGEST,
    ...extra,
  ];
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'prod02-gate-'));
  root = join(tmpRoot, 'candidate');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'tools'), { recursive: true });
  evidenceDir = join(root, 'evidence');
  artifactsDir = join(root, 'artifacts');
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\nimporters: {}\n');
  writeFileSync(join(root, 'src', 'app.js'), "export const answer = 42;\n");
  writeFileSync(
    join(root, 'tools', 'write-queries.mjs'),
    `import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
 const out = process.argv[2];
 const candidate = JSON.parse(readFileSync('evidence/candidate.json', 'utf8'));
 mkdirSync(dirname(out), { recursive: true });
 writeFileSync(out, JSON.stringify({
   runId: candidate.runId,
   attempt: candidate.attempt,
   commit: candidate.commit,
   lockfileSha256: candidate.lockfileSha256,
   sourceSha256: candidate.sourceSha256,
   result: 'PASS',
   generatedAt: new Date().toISOString(),
   profile: { name: 'fixture-hot-paths', dataset: 'fixture-db' },
   budget: { maxTotalCost: 100, maxPlanRows: 1000 },
    queries: { 'select-conversations': {
      name: 'select-conversations',
      sql: 'SELECT 1',
      plan: { nodeType: 'Index Scan', seqScan: false },
      totalCost: 1,
      planRows: 1,
      measuredAt: new Date().toISOString(),
      acceptable: true,
      withinBudget: true,
       budget: { maxTotalCost: 100, maxPlanRows: 1000 },
    } },
 }, null, 2));
`,
  );
  writeFileSync(
    join(root, 'tools', 'write-artifact.mjs'),
    `import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const out = process.argv[2];
const candidate = JSON.parse(readFileSync('evidence/candidate.json', 'utf8'));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({
  commit: candidate.commit,
  lockfileSha256: candidate.lockfileSha256,
  sourceSha256: candidate.sourceSha256,
  runId: candidate.runId,
  attempt: candidate.attempt,
  producer: 'fixture/dr',
  result: 'PASS',
  generatedAt: new Date().toISOString(),
  steps: ['backup', 'restore', 'smoke'],
}, null, 2));
`,
  );
  writeFileSync(
    join(root, 'tools', 'write-bad-queries.mjs'),
    `import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const out = process.argv[2];
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ commit: process.env.CANDIDATE_SHA, result: 'PASS', queries: {} }, null, 2));
`,
  );
  checksFile = join(tmpRoot, 'checks.json');
  const checks = [
    {
      id: 'compile',
      required: true,
      scope: 'compilação sintética real (subprocesso node)',
      command: 'node -e "process.stdout.write(\'compile ok\\n\')"',
      timeoutMs: 20_000,
    },
    {
      id: 'queries',
      required: true,
      scope: 'query set sintético com pelo menos uma query aceitável',
      command: 'node tools/write-queries.mjs evidence/metrics/queries.json',
      timeoutMs: 20_000,
        evidence: {
          kind: 'queries',
          file: 'metrics/queries.json',
          minEntries: 1,
          budget: { maxTotalCost: 100, maxPlanRows: 1000 },
          expectedEntries: ['select-conversations'],
        },
    },
    {
      id: 'coverage',
      required: true,
      scope: 'coverage sintético medido (nenhum percentual fixo)',
       command: 'node -e "console.log(\'All files | 77.7 | 66.6 | 55.5 | 44.4 |\'); console.log(\'COVERAGE_METRICS=\'+JSON.stringify({source:\'measured\',statements:77.7,branches:66.6,functions:55.5,lines:44.4,denominators:{statements:{total:1000,covered:777,skipped:0},branches:{total:1000,covered:666,skipped:0},functions:{total:1000,covered:555,skipped:0},lines:{total:1000,covered:444,skipped:0}}}))"',
      timeoutMs: 20_000,
      evidence: { kind: 'coverage' },
      metrics: 'coverage',
    },
    {
      id: 'image-proof',
      required: true,
      scope: 'prova de imagem vinculada ao digest do candidato',
      command: 'node -e "process.stdout.write(\'image ok\\n\')"',
      timeoutMs: 20_000,
      image: true,
    },
    {
      id: 'artifact-producer',
      required: true,
      scope: 'produtor sintético do artefato DR (pós-selo)',
      command: 'node tools/write-artifact.mjs evidence/artifacts/dr-e2e.json',
      timeoutMs: 20_000,
    },
    {
      id: 'dr-e2e',
      required: true,
      artifact: true,
      scope: 'DR end-to-end sintético (artefato vinculado ao candidato)',
      command: 'node tools/write-artifact.mjs evidence/artifacts/dr-e2e.json',
      producer: 'fixture/tools/write-artifact.mjs',
      evidence: { kind: 'json-result', file: 'artifacts/dr-e2e.json' },
    },
    {
      id: 'external-codeql',
      required: true,
      external: true,
      scope: 'CodeQL sintético no SHA (evidência CI)',
      evidence: { kind: 'json-result', file: 'ci/codeql.json' },
    },
  ];
  writeFileSync(checksFile, `${JSON.stringify(checks, null, 2)}\n`);
  mkdirSync(join(evidenceDir, 'ci'), { recursive: true });
  writeFileSync(
    join(evidenceDir, 'ci', 'codeql.json'),
    `${JSON.stringify({ commit: CANDIDATE, result: 'PASS', generatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
});

after(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

test('AC4 — execução real do gate produz selo bom aceito e reavaliação idempotente', () => {
  const run = runGate(baseArgs(['--run']));
  assert.equal(run.status, 0, `gate real falhou: ${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /FINAL: VERIFIED_CANDIDATE/);

  const report = readReport();
  assert.equal(report.state, 'VERIFIED_CANDIDATE');
  assert.equal(report.counts.pass, 6, 'checks não-externos deveriam passar');
  assert.equal(report.counts.notEvaluated, 1, 'check externo sem flag deve ser NOT_EVALUATED');
  assert.equal(report.commit, CANDIDATE);
  assert.ok(report.lockfileSha256, 'lockfileSha256 ausente no relatório');
  assert.ok(report.sourceSha256, 'sourceSha256 ausente no relatório');
  assert.equal(report.gates['dr-e2e'].status, 'PASS', 'artefato derivado vinculado (M2) deveria passar');

  // Evidência externa emitida depois do selo, com identidade C10 completa.
  writePayload(evidenceDir, 'ci/codeql.json');

  const evaluate = runGate(baseArgs(['--evaluate']));
  assert.equal(evaluate.status, 0, `reavaliação falhou: ${evaluate.stdout}\n${evaluate.stderr}`);
  assert.equal(readReport().counts.pass, 6);

  const withExternal = runGate(baseArgs(['--evaluate', '--with-external-evidence']));
  assert.equal(withExternal.status, 0, `avaliação com externo falhou: ${withExternal.stdout}\n${withExternal.stderr}`);
  assert.equal(readReport().counts.pass, 7);
});

test('AC3 — manifesto por check contém comando, ambiente, horário, resultado, hashes e escopo', () => {
  const manifest = readManifest(evidenceDir, 'compile');
  assert.equal(manifest.check, 'compile');
  assert.ok(manifest.command.includes('compile ok') || manifest.command.includes('process.stdout'), 'comando ausente');
  assert.ok(manifest.scope.length > 0, 'escopo ausente');
  assert.equal(manifest.status, 'PASS');
  assert.ok(manifest.environment.node.startsWith('v'), 'ambiente sem versão node');
  assert.ok(manifest.environment.platform, 'ambiente sem plataforma');
  assert.ok(Number.isFinite(Date.parse(manifest.startedAt)), 'startedAt inválido');
  assert.ok(Number.isFinite(Date.parse(manifest.finishedAt)), 'finishedAt inválido');
  assert.ok(manifest.durationMs >= 0, 'durationMs inválido');
  assert.equal(manifest.candidate.commit, CANDIDATE);
  assert.ok(manifest.hashes.log, 'hash do log ausente');
  assert.ok(manifest.artifacts.some((entry) => entry.kind === 'log'), 'artefato de log ausente');
  assert.ok(existsSync(join(evidenceDir, 'logs', 'compile.log')), 'log real do check ausente');
  assert.equal(readManifest(evidenceDir, 'image-proof').candidate.imageDigest, IMAGE_DIGEST);
});

test('AC3 — métrica de coverage vem da medição (sem percentual fixo no código/relatório)', () => {
  const report = readReport();
  assert.deepEqual(report.gates.coverage.metrics, {
    source: 'measured',
    statements: 77.7,
    branches: 66.6,
    functions: 55.5,
    lines: 44.4,
    denominators: {
      statements: { total: 1000, covered: 777, skipped: 0 },
      branches: { total: 1000, covered: 666, skipped: 0 },
      functions: { total: 1000, covered: 555, skipped: 0 },
      lines: { total: 1000, covered: 444, skipped: 0 },
    },
  });
  const markdown = readFileSync(join(artifactsDir, 'triple-aaa-report.md'), 'utf8');
  assert.match(markdown, /77\.7/);
  assert.doesNotMatch(markdown, /94\.6/, 'percentual histórico fixo reapareceu no relatório');
  const gateSource = readFileSync(CLI, 'utf8');
  const libSource = readFileSync(GATE_LIB, 'utf8');
  assert.doesNotMatch(`${gateSource}\n${libSource}`, /94\.6/, 'percentual de coverage fixo no código');
});

test('AC1 — WRONG-SHA (outro candidato) é rejeitado e log da falha é conservado', () => {
  const dir = mutateEvidence('wrong-sha');
  const manifest = readManifest(dir, 'compile');
  manifest.candidate.commit = 'WRONG-SHA';
  writeManifest(dir, 'compile', manifest);
  const run = runGate(['--root', root, '--checks-file', checksFile, '--evidence-dir', dir, '--artifacts-dir', artifactsDir, '--candidate', CANDIDATE, '--image-digest', IMAGE_DIGEST, '--evaluate']);
  assert.notEqual(run.status, 0, 'WRONG-SHA deveria reprovar');
  const report = JSON.parse(readFileSync(join(artifactsDir, 'triple-aaa-report.json'), 'utf8'));
  assert.equal(report.state, 'FAILED');
  assert.equal(report.gates.compile.status, 'INVALID');
  assert.match(report.gates.compile.reasons.join(' '), /commit divergente/);
  assert.ok(existsSync(join(dir, 'logs', 'compile.log')), 'log original deveria ser conservado');
});

test('AC1 — lockfileSha256 divergente é rejeitado', () => {
  const dir = mutateEvidence('wrong-lock');
  const manifest = readManifest(dir, 'compile');
  manifest.candidate.lockfileSha256 = 'f'.repeat(64);
  writeManifest(dir, 'compile', manifest);
  const run = runGate(['--root', root, '--checks-file', checksFile, '--evidence-dir', dir, '--artifacts-dir', artifactsDir, '--candidate', CANDIDATE, '--image-digest', IMAGE_DIGEST, '--evaluate']);
  assert.notEqual(run.status, 0);
  assert.match(readReport().gates.compile.reasons.join(' '), /lockfileSha256 divergente/);
});

test('AC1 — sourceSha256 divergente é rejeitado', () => {
  const dir = mutateEvidence('wrong-source');
  const manifest = readManifest(dir, 'compile');
  manifest.candidate.sourceSha256 = '0'.repeat(64);
  writeManifest(dir, 'compile', manifest);
  const run = runGate(['--root', root, '--checks-file', checksFile, '--evidence-dir', dir, '--artifacts-dir', artifactsDir, '--candidate', CANDIDATE, '--image-digest', IMAGE_DIGEST, '--evaluate']);
  assert.notEqual(run.status, 0);
  assert.match(readReport().gates.compile.reasons.join(' '), /sourceSha256 divergente/);
});

test('AC1 — imageDigest divergente é rejeitado', () => {
  const dir = mutateEvidence('wrong-image');
  const manifest = readManifest(dir, 'image-proof');
  manifest.candidate.imageDigest = `sha256:${'c'.repeat(64)}`;
  writeManifest(dir, 'image-proof', manifest);
  const run = runGate(['--root', root, '--checks-file', checksFile, '--evidence-dir', dir, '--artifacts-dir', artifactsDir, '--candidate', CANDIDATE, '--image-digest', IMAGE_DIGEST, '--evaluate']);
  assert.notEqual(run.status, 0);
  assert.match(readReport().gates['image-proof'].reasons.join(' '), /imageDigest divergente/);
});

test('AC1 — evidência anterior ao selo (STALE de outro candidato) é rejeitada', () => {
  const dir = mutateEvidence('stale');
  const manifest = readManifest(dir, 'compile');
  manifest.startedAt = '2000-01-01T00:00:00.000Z';
  manifest.finishedAt = '2000-01-01T00:00:01.000Z';
  manifest.durationMs = 1000;
  writeManifest(dir, 'compile', manifest);
  const run = runGate(['--root', root, '--checks-file', checksFile, '--evidence-dir', dir, '--artifacts-dir', artifactsDir, '--candidate', CANDIDATE, '--image-digest', IMAGE_DIGEST, '--evaluate']);
  assert.notEqual(run.status, 0);
  assert.match(readReport().gates.compile.reasons.join(' '), /anterior ao selo do candidato/);
});

test('AC1 — JSON vazio é rejeitado', () => {
  const dir = mutateEvidence('empty-json');
  writeFileSync(join(dir, 'compile.json'), '{}\n');
  const run = runGate(['--root', root, '--checks-file', checksFile, '--evidence-dir', dir, '--artifacts-dir', artifactsDir, '--candidate', CANDIDATE, '--image-digest', IMAGE_DIGEST, '--evaluate']);
  assert.notEqual(run.status, 0);
  assert.equal(readReport().gates.compile.status, 'INVALID');
});

test('AC1 — JSON truncado é rejeitado', () => {
  const dir = mutateEvidence('truncated-json');
  writeFileSync(join(dir, 'compile.json'), '{"check": "compile", "status": "PASS"');
  const run = runGate(['--root', root, '--checks-file', checksFile, '--evidence-dir', dir, '--artifacts-dir', artifactsDir, '--candidate', CANDIDATE, '--image-digest', IMAGE_DIGEST, '--evaluate']);
  assert.notEqual(run.status, 0);
  assert.equal(readReport().gates.compile.status, 'INVALID');
  assert.match(readReport().gates.compile.reasons.join(' '), /truncado|inválido/);
});

test('AC1 — query set vazio é rejeitado', () => {
  const dir = mutateEvidence('empty-queries');
  const manifest = readManifest(dir, 'queries');
  // Identidade C10 completa para isolar a falha no conjunto de queries.
  writePayload(dir, 'metrics/queries.json', { queries: {} });
  writeManifest(dir, 'queries', manifest);
  const run = runGate(evaluateArgs(dir));
  assert.notEqual(run.status, 0);
  assert.equal(readReport().gates.queries.status, 'INVALID');
  assert.match(readReport().gates.queries.reasons.join(' '), /queries vazio/);
});

test('AC1 — PASS só narrativo (log ausente) é rejeitado', () => {
  const dir = mutateEvidence('narrative');
  rmSync(join(dir, 'logs', 'compile.log'));
  const run = runGate(['--root', root, '--checks-file', checksFile, '--evidence-dir', dir, '--artifacts-dir', artifactsDir, '--candidate', CANDIDATE, '--image-digest', IMAGE_DIGEST, '--evaluate']);
  assert.notEqual(run.status, 0);
  assert.match(readReport().gates.compile.reasons.join(' '), /PASS narrativo/);
});

test('PROD-02-R2-AC5 — manifesto contraditório não aprova command/exit/log/tempo/metadados', () => {
  const cases = [
    ['command', (manifest) => { manifest.command = 'true'; }, /comando divergente/],
    ['exit', (manifest) => { manifest.exitCode = 99; }, /exitCode inválido/],
    ['future', (manifest) => {
      manifest.startedAt = '2099-01-01T00:00:00.000Z';
      manifest.finishedAt = '2099-01-01T00:00:01.000Z';
      manifest.durationMs = 1000;
    }, /futuro/],
    ['metadata', (manifest) => {
      delete manifest.environment.runId;
      delete manifest.environment.attempt;
    }, /ambiente sem (runId|attempt)/],
  ];
  for (const [name, mutate, expected] of cases) {
    const dir = mutateEvidence(`r2-${name}`);
    const manifest = readManifest(dir, 'compile');
    mutate(manifest);
    writeManifest(dir, 'compile', manifest);
    const run = runGate(['--root', root, '--checks-file', checksFile, '--evidence-dir', dir, '--artifacts-dir', artifactsDir, '--candidate', CANDIDATE, '--image-digest', IMAGE_DIGEST, '--evaluate']);
    assert.notEqual(run.status, 0, `${name} deveria reprovar`);
    assert.match(readReport().gates.compile.reasons.join(' '), expected, name);
  }

  const emptyLog = mutateEvidence('r2-empty-log');
  const emptyManifest = readManifest(emptyLog, 'compile');
  writeFileSync(join(emptyLog, 'logs', 'compile.log'), '');
  emptyManifest.hashes.log = sha256File(join(emptyLog, 'logs', 'compile.log'));
  emptyManifest.artifacts.find((entry) => entry.kind === 'log').sha256 = emptyManifest.hashes.log;
  writeManifest(emptyLog, 'compile', emptyManifest);
  const emptyRun = runGate(['--root', root, '--checks-file', checksFile, '--evidence-dir', emptyLog, '--artifacts-dir', artifactsDir, '--candidate', CANDIDATE, '--image-digest', IMAGE_DIGEST, '--evaluate']);
  assert.notEqual(emptyRun.status, 0, 'log vazio deveria reprovar');
  assert.match(readReport().gates.compile.reasons.join(' '), /log vazio/);
});

test('OPS01 — reavaliação com imageDigest diferente reprova o candidato', () => {
  const dir = mutateEvidence('r2-image-drift');
  const differentDigest = `sha256:${'e'.repeat(64)}`;
  const run = runGate(['--root', root, '--checks-file', checksFile, '--evidence-dir', dir, '--artifacts-dir', artifactsDir, '--candidate', CANDIDATE, '--image-digest', differentDigest, '--evaluate']);
  assert.notEqual(run.status, 0, 'digest esperado diferente deveria reprovar');
  const report = readReport();
  assert.equal(report.state, 'FAILED');
  assert.ok(report.candidateDrift.includes('imageDigest'), JSON.stringify(report.candidateDrift));
});

test('PROD-02-R2-AC5 — coverage exige denominadores e query exige schema/orçamento/conjunto completo', () => {
  const coverageDir = mutateEvidence('r2-coverage-no-denominator');
  const coverage = readManifest(coverageDir, 'coverage');
  delete coverage.metrics.denominators;
  writeManifest(coverageDir, 'coverage', coverage);
  const coverageRun = runGate(evaluateArgs(coverageDir));
  assert.notEqual(coverageRun.status, 0, 'coverage sem denominadores deveria reprovar');
  assert.match(readReport().gates.coverage.reasons.join(' '), /denominador/);

  const queryDir = mutateEvidence('r2-query-schema');
  const queryManifest = readManifest(queryDir, 'queries');
  writePayload(queryDir, 'metrics/queries.json', { queries: { 'select-conversations': {} } });
  writeManifest(queryDir, 'queries', queryManifest);
  const queryRun = runGate(evaluateArgs(queryDir));
  assert.notEqual(queryRun.status, 0, 'query sem medição deveria reprovar');
  assert.match(readReport().gates.queries.reasons.join(' '), /sem identidade|sem SQL|sem custo numérico|sem linhas inteiras|medição sem horário/);

  const incompleteDir = mutateEvidence('r2-query-incomplete');
  writePayload(incompleteDir, 'metrics/queries.json');
  const incompleteChecks = join(tmpRoot, 'r2-incomplete-checks.json');
  writeFileSync(incompleteChecks, `${JSON.stringify([{
    id: 'queries',
    required: true,
    scope: 'query set incompleto',
    command: 'true',
    artifact: true,
    evidence: { kind: 'queries', file: 'metrics/queries.json', minEntries: 2, expectedEntries: ['select-conversations', 'required-second-query'] },
  }], null, 2)}\n`);
  const incompleteRun = runGate(['--root', root, '--checks-file', incompleteChecks, '--evidence-dir', incompleteDir, '--artifacts-dir', artifactsDir, '--candidate', CANDIDATE, '--image-digest', IMAGE_DIGEST, '--evaluate']);
  assert.notEqual(incompleteRun.status, 0, 'conjunto incompleto deveria reprovar');
  assert.match(readReport().gates.queries.reasons.join(' '), /query obrigatória ausente|insuficiente/);

  const budgetDir = mutateEvidence('r2-query-budget');
  const budgetManifest = readManifest(budgetDir, 'queries');
  writePayload(budgetDir, 'metrics/queries.json', {
    budget: { maxTotalCost: 1, maxPlanRows: 1 },
    queries: { 'select-conversations': {
      name: 'select-conversations', totalCost: 2, planRows: 2, measuredAt: new Date().toISOString(), acceptable: false, withinBudget: false,
    } },
  });
  writeManifest(budgetDir, 'queries', budgetManifest);
  const budgetRun = runGate(evaluateArgs(budgetDir));
  assert.notEqual(budgetRun.status, 0, 'query fora do orçamento deveria reprovar');
  assert.match(readReport().gates.queries.reasons.join(' '), /não aceitável|fora do orçamento/);
});

test('PROD-02-R3-AC1 — query gate rejeita tipos inválidos, excedentes, orçamento divergente e medições futuras', () => {
  const cases = [
    ['null-measurements', (query) => { query.totalCost = null; query.planRows = null; }, /custo numérico|linhas inteiras/],
    ['empty-string-measurements', (query) => { query.totalCost = ''; query.planRows = ''; }, /custo numérico|linhas inteiras/],
    ['negative-measurements', (query) => { query.totalCost = -1; query.planRows = -1; }, /custo numérico|linhas inteiras|fora do orçamento/],
    ['over-budget', (query) => { query.totalCost = 101; query.planRows = 1001; query.withinBudget = true; query.acceptable = true; }, /fora do orçamento|aderência/],
    ['future-measurement', (query) => { query.measuredAt = '2099-01-01T00:00:00.000Z'; }, /medição.*futuro/],
    ['missing-query-evidence', (query) => { delete query.sql; delete query.plan; }, /sem SQL|sem plano/],
  ];
  for (const [name, mutate, expected] of cases) {
    const dir = mutateEvidence(`r3-query-${name}`);
    const file = join(dir, 'metrics', 'queries.json');
    const payload = JSON.parse(readFileSync(file, 'utf8'));
    mutate(payload.queries['select-conversations']);
    writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
    const run = runGate(evaluateArgs(dir));
    assert.notEqual(run.status, 0, `${name} deveria reprovar`);
    const gate = readReport().gates.queries;
    assert.equal(gate.status, 'INVALID', `${name}: ${JSON.stringify(gate)}`);
    assert.match(gate.reasons.join(' '), expected, name);
  }

  const budgetDir = mutateEvidence('r3-query-budget-drift');
  const budgetFile = join(budgetDir, 'metrics', 'queries.json');
  const budgetPayload = JSON.parse(readFileSync(budgetFile, 'utf8'));
  budgetPayload.budget = { maxTotalCost: 100000, maxPlanRows: 100000 };
  budgetPayload.queries['select-conversations'].budget = { ...budgetPayload.budget };
  budgetPayload.queries['select-conversations'].totalCost = 50000;
  budgetPayload.queries['select-conversations'].planRows = 50000;
  budgetPayload.queries['select-conversations'].withinBudget = true;
  budgetPayload.queries['select-conversations'].acceptable = true;
  writeFileSync(budgetFile, `${JSON.stringify(budgetPayload, null, 2)}\n`);
  const budgetRun = runGate(evaluateArgs(budgetDir));
  assert.notEqual(budgetRun.status, 0, 'orçamento alterado no payload deveria reprovar');
  assert.match(readReport().gates.queries.reasons.join(' '), /orçamento divergente do orçamento congelado/);

  const invalidCoverageDir = mutateEvidence('r3-coverage-invalid-metric');
  const invalidCoverage = readManifest(invalidCoverageDir, 'coverage');
  invalidCoverage.metrics.statements = null;
  writeManifest(invalidCoverageDir, 'coverage', invalidCoverage);
  const invalidCoverageRun = runGate(evaluateArgs(invalidCoverageDir));
  assert.notEqual(invalidCoverageRun.status, 0, 'coverage nula deveria reprovar');
  assert.match(readReport().gates.coverage.reasons.join(' '), /coverage\.statements inválido/);

  const excessCoverageDir = mutateEvidence('r3-coverage-excess');
  const excessCoverage = readManifest(excessCoverageDir, 'coverage');
  excessCoverage.metrics.branches = 101;
  writeManifest(excessCoverageDir, 'coverage', excessCoverage);
  const excessCoverageRun = runGate(evaluateArgs(excessCoverageDir));
  assert.notEqual(excessCoverageRun.status, 0, 'coverage acima de 100 deveria reprovar');
  assert.match(readReport().gates.coverage.reasons.join(' '), /coverage\.branches inválido|diverge/);
});

test('PROD-02-R3-AC2 — artefato derivado exige runId/attempt do candidato e preserva metadados', () => {
  const validDir = mutateEvidence('r3-derived-valid');
  const candidate = sealedCandidateOf(validDir);
  const check = JSON.parse(readFileSync(checksFile, 'utf8')).find((entry) => entry.id === 'dr-e2e');
  const derived = deriveArtifactManifest(check, { evidenceDir: validDir, candidate });
  assert.equal(derived.status, 'PASS');
  assert.equal(derived.environment.runId, candidate.runId);
  assert.equal(derived.environment.attempt, candidate.attempt);
  assert.equal(derived.candidate.runId, candidate.runId);
  assert.equal(derived.candidate.attempt, candidate.attempt);

  const cases = [
    ['missing-run', (payload) => { delete payload.runId; }, /payload sem runId/],
    ['missing-attempt', (payload) => { delete payload.attempt; }, /payload sem attempt/],
    ['wrong-run', (payload) => { payload.runId = 'different-run'; }, /runId divergente/],
    ['wrong-attempt', (payload) => { payload.attempt = '2'; }, /attempt divergente/],
  ];
  for (const [name, mutate, expected] of cases) {
    const dir = mutateEvidence(`r3-derived-${name}`);
    const file = join(dir, 'artifacts', 'dr-e2e.json');
    const payload = JSON.parse(readFileSync(file, 'utf8'));
    mutate(payload);
    writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
    const run = runGate(evaluateArgs(dir));
    assert.notEqual(run.status, 0, `${name} deveria reprovar`);
    const gate = readReport().gates['dr-e2e'];
    assert.equal(gate.status, 'INVALID', `${name}: ${JSON.stringify(gate)}`);
    assert.match(gate.reasons.join(' '), expected, name);
  }
});

test('AC2 — FAIL, BLOCKED, NOT_RUN e SKIPPED impedem VERIFIED_CANDIDATE', () => {
  for (const status of ['FAIL', 'BLOCKED', 'NOT_RUN', 'SKIPPED']) {
    const dir = mutateEvidence(`status-${status}`);
    const manifest = readManifest(dir, 'compile');
    manifest.status = status;
    writeManifest(dir, 'compile', manifest);
    const run = runGate(['--root', root, '--checks-file', checksFile, '--evidence-dir', dir, '--artifacts-dir', artifactsDir, '--candidate', CANDIDATE, '--image-digest', IMAGE_DIGEST, '--evaluate']);
    assert.notEqual(run.status, 0, `${status} deveria reprovar`);
    const report = JSON.parse(readFileSync(join(artifactsDir, 'triple-aaa-report.json'), 'utf8'));
    assert.equal(report.state, 'FAILED');
    assert.equal(report.gates.compile.status, status, `status ${status} deveria ser preservado no relatório`);
  }
});

test('AC2 — check requerido ausente (MISSING) reprova com estado inequívoco', () => {
  const dir = mutateEvidence('missing');
  rmSync(join(dir, 'compile.json'));
  const run = runGate(['--root', root, '--checks-file', checksFile, '--evidence-dir', dir, '--artifacts-dir', artifactsDir, '--candidate', CANDIDATE, '--image-digest', IMAGE_DIGEST, '--evaluate']);
  assert.notEqual(run.status, 0);
  const report = readReport();
  assert.equal(report.state, 'FAILED');
  assert.equal(report.gates.compile.status, 'MISSING');
  assert.match(report.gates.compile.reasons.join(' '), /manifesto ausente/);
});

test('AC2 — selo do candidato ausente nunca permite VERIFIED_CANDIDATE', () => {
  const dir = mutateEvidence('missing-candidate-seal');
  rmSync(join(dir, 'candidate.json'));
  const run = runGate(evaluateArgs(dir));
  assert.notEqual(run.status, 0, 'candidate.json ausente deveria reprovar');
  const report = readReport();
  assert.equal(report.state, 'FAILED');
  assert.equal(report.sealMissing, true);
  assert.match(report.rejected.map((entry) => entry.reasons.join(' ')).join(' '), /candidate\.json ausente/);
});

test('AC2 — FAIL externo com --with-external-evidence reprova (exit != 0)', () => {
  const dir = mutateEvidence('external-fail');
  writeFileSync(
    join(dir, 'ci', 'codeql.json'),
    `${JSON.stringify({ commit: CANDIDATE, result: 'FAIL', generatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  const run = runGate(['--root', root, '--checks-file', checksFile, '--evidence-dir', dir, '--artifacts-dir', artifactsDir, '--candidate', CANDIDATE, '--image-digest', IMAGE_DIGEST, '--evaluate', '--with-external-evidence']);
  assert.notEqual(run.status, 0, 'FAIL externo deveria reprovar');
  const report = readReport();
  assert.equal(report.state, 'FAILED');
  assert.equal(report.gates['external-codeql'].status, 'INVALID');
  assert.match(report.gates['external-codeql'].reasons.join(' '), /não é PASS/);
});

test('AC2 — payload externo sem vínculo de candidato é rejeitado', () => {
  const dir = mutateEvidence('external-unbound');
  writeFileSync(
    join(dir, 'ci', 'codeql.json'),
    `${JSON.stringify({ result: 'PASS', generatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  const run = runGate(['--root', root, '--checks-file', checksFile, '--evidence-dir', dir, '--artifacts-dir', artifactsDir, '--candidate', CANDIDATE, '--image-digest', IMAGE_DIGEST, '--evaluate', '--with-external-evidence']);
  assert.notEqual(run.status, 0);
  assert.match(readReport().gates['external-codeql'].reasons.join(' '), /sem vínculo de candidato/);
});

test('AC4 — selo local nunca é TRIPLE_AAA_CERTIFIED e exige política de release', () => {
  const report = readReport();
  assert.notEqual(report.state, 'TRIPLE_AAA_CERTIFIED');
  assert.notEqual(report.final, 'TRIPLE_AAA_CERTIFIED');
  assert.equal(report.certification.state, 'NOT_ELIGIBLE_LOCAL');
  assert.ok(report.certification.requiredForCertification.length >= 3);
  const source = readFileSync(CLI, 'utf8');
  assert.doesNotMatch(source, /final\s*=\s*'TRIPLE_AAA_CERTIFIED'/, 'gate local não pode atribuir CERTIFIED');
  assert.match(source, /CERTIFICATION_POLICY/);
});

// ---------------------------------------------------------------------------
// M1 — vínculo do selo com arquivos untracked (revisão independente do lote M0).
// ---------------------------------------------------------------------------
test('M1 — sourceSha256 cobre untracked de repo git, com determinismo, e exclui evidências do repo', () => {
  const repo = join(tmpRoot, 'm1-unit-repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  assert.equal(git(['init', '-q']).status, 0, 'git init falhou');
  writeFileSync(join(repo, 'src', 'tracked.js'), 'export const a = 1;\n');
  assert.equal(git(['add', 'src/tracked.js']).status, 0, 'git add falhou');
  assert.equal(
    git(['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-qm', 'init']).status,
    0,
    'git commit falhou',
  );
  writeFileSync(join(repo, 'src', 'untracked.js'), 'export const b = 1;\n');

  const first = computeSourceHash(repo);
  assert.equal(first.sourceSha256, computeSourceHash(repo).sourceSha256, 'hash deve ser determinístico');
  assert.equal(first.files, 2, 'tracked + untracked devem compor o hash de fonte');

  writeFileSync(join(repo, 'src', 'untracked.js'), 'export const b = 2;\n');
  const changed = computeSourceHash(repo);
  assert.notEqual(changed.sourceSha256, first.sourceSha256, 'untracked alterado deve mudar o hash');

  const evid = join(repo, 'docs', 'producao-2026-09-13', 'evidencias', 'prod-02');
  const runtime = join(repo, 'docs', 'execucao-aaa-2026-09-12', 'runtime');
  mkdirSync(evid, { recursive: true });
  mkdirSync(runtime, { recursive: true });
  writeFileSync(join(evid, 'novo.txt'), 'evidência gerada no repo');
  writeFileSync(join(runtime, 'run.txt'), 'runtime gerado no repo');
  assert.equal(
    computeSourceHash(repo).sourceSha256,
    changed.sourceSha256,
    'evidências dentro do repo não podem invalidar o hash de fonte',
  );
});

test('M1 — selo do CLI detecta alteração de untracked e ignora novas evidências no repo', () => {
  const repo = join(tmpRoot, 'm1-sealed-repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  assert.equal(git(['init', '-q']).status, 0);
  writeFileSync(join(repo, 'src', 'tracked.js'), 'export const a = 1;\n');
  assert.equal(git(['add', 'src/tracked.js']).status, 0);
  assert.equal(
    git(['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-qm', 'init']).status,
    0,
  );
  writeFileSync(join(repo, 'src', 'untracked.js'), 'export const b = 1;\n');
  writeFileSync(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9\nimporters: {}\n');

  const evidence = join(repo, 'evidence');
  const artifacts = join(repo, 'artifacts');
  const checks = join(tmpRoot, 'm1-checks.json');
  writeFileSync(
    checks,
    `${JSON.stringify([
      {
        id: 'compile',
        required: true,
        scope: 'compilação M1',
        command: 'node -e "process.stdout.write(\'m1 ok\\n\')"',
        timeoutMs: 20_000,
      },
    ], null, 2)}\n`,
  );
  const args = [
    '--root', repo,
    '--checks-file', checks,
    '--evidence-dir', evidence,
    '--artifacts-dir', artifacts,
    '--candidate', 'a'.repeat(40),
  ];

  const run = runGate(['--run', ...args]);
  assert.equal(run.status, 0, `selagem falhou: ${run.stdout}\n${run.stderr}`);

  writeFileSync(join(evidence, 'nota.txt'), 'nova evidência no repo');
  const evaluate = runGate(['--evaluate', ...args]);
  assert.equal(evaluate.status, 0, `evidência nova invalidou o selo: ${evaluate.stdout}\n${evaluate.stderr}`);

  writeFileSync(join(repo, 'src', 'untracked.js'), 'export const b = 2;\n');
  const drift = runGate(['--evaluate', ...args]);
  assert.notEqual(drift.status, 0, 'untracked alterado deveria invalidar o selo');
  const report = JSON.parse(readFileSync(join(artifacts, 'triple-aaa-report.json'), 'utf8'));
  assert.equal(report.state, 'FAILED');
  assert.ok(
    report.candidateDrift.includes('sourceSha256'),
    `drift sem sourceSha256: ${JSON.stringify(report.candidateDrift)}`,
  );
});

// ---------------------------------------------------------------------------
// M2 — artefato/externo com identidade C10 obrigatória e STALE no derivado.
// ---------------------------------------------------------------------------
test('AC1/M2 — artefato derivado PASS velho, sem lock/source ou futuro é rejeitado (nunca PASS)', () => {
  const cases = [
    ['stale-unbound', { generatedAt: '2000-01-01T00:00:00.000Z', lockfileSha256: null, sourceSha256: null }, /STALE|ausente/],
    ['stale-bound', { generatedAt: '2000-01-01T00:00:00.000Z' }, /STALE/],
    ['unbound-fresh', { lockfileSha256: null, sourceSha256: null }, /lockfileSha256 ausente|sourceSha256 ausente/],
    ['future', { generatedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }, /futuro/],
  ];
  for (const [name, overrides, expected] of cases) {
    const dir = mutateEvidence(`derived-${name}`);
    writePayload(dir, 'artifacts/dr-e2e.json', overrides);
    const run = runGate(evaluateArgs(dir));
    assert.notEqual(run.status, 0, `${name}: deveria reprovar`);
    const gate = readReport().gates['dr-e2e'];
    assert.equal(gate.status, 'INVALID', `${name}: status ${gate.status}`);
    assert.match(gate.reasons.join(' '), expected, `${name}: reasons`);
  }
});

test('AC2/M2 — externo derivado com identidade ausente ou velha é rejeitado (STALE no derivado)', () => {
  const stale = mutateEvidence('external-derived-stale');
  writePayload(stale, 'ci/codeql.json', { generatedAt: '2000-01-01T00:00:00.000Z' });
  const staleRun = runGate(evaluateArgs(stale, ['--with-external-evidence']));
  assert.notEqual(staleRun.status, 0, 'payload velho deveria reprovar');
  const staleGate = readReport().gates['external-codeql'];
  assert.equal(staleGate.status, 'INVALID');
  assert.match(staleGate.reasons.join(' '), /STALE/);

  const unbound = mutateEvidence('external-derived-unbound');
  writeFileSync(
    join(unbound, 'ci', 'codeql.json'),
    `${JSON.stringify({ commit: CANDIDATE, result: 'PASS', generatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  const unboundRun = runGate(evaluateArgs(unbound, ['--with-external-evidence']));
  assert.notEqual(unboundRun.status, 0, 'payload sem lock/source deveria reprovar');
  const unboundGate = readReport().gates['external-codeql'];
  assert.equal(unboundGate.status, 'INVALID');
  assert.match(unboundGate.reasons.join(' '), /lockfileSha256 ausente|sourceSha256 ausente/);
});

// ---------------------------------------------------------------------------
// L2 — defaults de banco exigem run isolado (nunca 5432/connect_desk_db).
// ---------------------------------------------------------------------------
test('L2 — defaults de banco exigem cvg_aaa_* em porta dedicada, nunca a instância do host', () => {
  const dbChecks = DEFAULT_CHECKS.filter((check) =>
    ['unit', 'postgres-real', 'migration-check'].includes(check.id),
  );
  assert.equal(dbChecks.length, 3, 'checks de banco esperados');
  for (const check of dbChecks) {
    assert.equal(check.env?.DATABASE_URL, undefined, `${check.id} não pode fixar banco do host`);
    assert.ok(check.command.includes('cvg_aaa_'), `${check.id} sem guarda de isolamento cvg_aaa_*`);
    assert.doesNotMatch(
      check.command,
      /postgresql:\/\/[^@\s]+@[^/\s]+\/connect_desk_db/,
      `${check.id} contém URL do banco alheio`,
    );
  }

  // A guarda real só interpreta a URL (nunca abre conexão): reprova o banco do
  // host e aceita o run isolado.
  const runGuard = (url) =>
    spawnSync('/bin/sh', ['-c', DATABASE_ISOLATION_GUARD], {
      env: { ...process.env, DATABASE_URL: url },
      encoding: 'utf8',
    });
  const hostile = runGuard('postgresql://postgres:postgres@localhost:5432/connect_desk_db');
  assert.notEqual(hostile.status, 0, 'guarda deveria reprovar banco do host');
  assert.match(hostile.stderr, /cvg_aaa_|isolado/);
  const isolated = runGuard('postgresql://postgres:postgres@localhost:5433/cvg_aaa_prod02_run1');
  assert.equal(isolated.status, 0, `guarda deveria aceitar run isolado: ${isolated.stderr}`);
  assert.match(isolated.stdout, /banco isolado ok/);
});
