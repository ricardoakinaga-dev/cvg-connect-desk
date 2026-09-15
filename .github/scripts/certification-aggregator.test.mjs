#!/usr/bin/env node
/**
 * Fixture-driven tests for the certification aggregator (PROD-03).
 *
 * Cobre: inventário requerido (Docker/boot, staging, coverage global,
 * migrations fresh/upgrade distintos, E2E, carga/DR, segurança), políticas por
 * evento (PR/push/schedule/release), paginação, SHA correto, imagem testada,
 * e rejeição dos adversariais da auditoria (sucesso antigo, cancelamento, job
 * duplicado/renomeado, skip, payload malformado).
 *
 * Run: node .github/scripts/certification-aggregator.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  POLICIES,
  REQUIRED,
  asArray,
  collectPages,
  evaluateRequired,
  main,
  pickLatest,
  validateImageEvidence,
} from './certification-aggregator.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const workflowsDir = join(here, '..', 'workflows');
const SHA = 'a'.repeat(40);
const OLD_SHA = 'b'.repeat(40);
const LOCK_SHA = 'c'.repeat(64);
const SOURCE_SHA = 'd'.repeat(64);

// ---------------------------------------------------------------------------
// 1. Estática: inventário resolve para jobs reais e distintos (sem fantasma).
// ---------------------------------------------------------------------------
function workflowName(text) {
  const match = text.match(/^name:\s*(.+)$/m);
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
}
function jobNames(text) {
  const names = [];
  let inJobs = false;
  for (const line of text.split('\n')) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    const jobId = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (jobId) {
      names.push(jobId[1]);
      continue;
    }
    const jobName = line.match(/^ {4}name:\s*(.+)$/);
    if (jobName && names.length > 0) names[names.length - 1] = jobName[1].trim().replace(/^["']|["']$/g, '');
  }
  return names;
}

const workflowJobs = new Map();
for (const file of readdirSync(workflowsDir).filter((entry) => entry.endsWith('.yml'))) {
  const text = readFileSync(join(workflowsDir, file), 'utf8');
  const name = workflowName(text);
  if (name) workflowJobs.set(name, jobNames(text));
}

function resolvedJob(descriptor) {
  const jobs = workflowJobs.get(descriptor.wf);
  if (!jobs) return { ok: false, reason: `workflow não encontrado: ${descriptor.wf}` };
  const matches = jobs.filter((job) => descriptor.match.test(job));
  if (matches.length === 0) return { ok: false, reason: `nenhum job de ${descriptor.wf} casa ${descriptor.match}` };
  return { ok: true, job: matches[0], matches };
}

for (const descriptor of REQUIRED) {
  if (descriptor.pending) {
    test(`pendente '${descriptor.gate}' tem dono e motivo explícitos`, () => {
      assert.ok(descriptor.pending.owner, 'owner ausente');
      assert.ok(descriptor.pending.reason, 'motivo ausente');
      assert.ok(descriptor.events.length > 0, 'evento ausente');
    });
    continue;
  }
  test(`mapping '${descriptor.gate}' -> ${descriptor.wf} / ${descriptor.match}`, () => {
    const resolved = resolvedJob(descriptor);
    assert.ok(resolved.ok, resolved.reason);
    assert.equal(resolved.matches.length, 1, `mais de um job casa ${descriptor.gate}: ${resolved.matches.join(', ')}`);
  });
}

test('inventário cobre as categorias obrigatórias e fresh/upgrade são distinct', () => {
  const byGate = Object.fromEntries(REQUIRED.map((descriptor) => [descriptor.gate, descriptor]));
  for (const gate of [
    'lint',
    'typecheck',
    'unit',
    'integration',
    'contracts',
    'coverage-shared',
    'coverage-global',
    'migrations-fresh',
    'migrations-upgrade',
    'build',
    'docker',
    'image-identity',
    'boot-smoke',
    'postgres-real',
    'dr-e2e',
    'load',
    'codeql',
    'gitleaks',
    'trivy',
    'sbom-ci',
    'sbom-security',
    'pnpm-audit-security',
    'dependency-review',
    'staging-real',
  ]) {
    assert.ok(byGate[gate], `inventário sem gate ${gate}`);
    assert.ok(byGate[gate].scope, `gate ${gate} sem escopo`);
  }
  const fresh = resolvedJob(byGate['migrations-fresh']);
  const upgrade = resolvedJob(byGate['migrations-upgrade']);
  assert.ok(fresh.ok && upgrade.ok);
  assert.notDeepEqual(
    { wf: byGate['migrations-fresh'].wf, job: fresh.job },
    { wf: byGate['migrations-upgrade'].wf, job: upgrade.job },
    'fresh e upgrade não podem ser o mesmo job/workflow',
  );
});

test('every gate resolves to a distinct (workflow, job)', () => {
  const seen = new Map();
  for (const descriptor of REQUIRED) {
    if (descriptor.pending) continue;
    const resolved = resolvedJob(descriptor);
    assert.ok(resolved.ok, resolved.reason);
    const key = `${descriptor.wf}::${resolved.job}`;
    assert.ok(!seen.has(key), `${descriptor.gate} reutiliza ${key} de ${seen.get(key)}`);
    seen.set(key, descriptor.gate);
  }
});

test('políticas por evento: PR exige dependency-review; push/release usam substituto explícito', () => {
  assert.ok(POLICIES.pull_request.required.includes('dependency-review'));
  assert.ok(!POLICIES.push.required.includes('dependency-review'));
  assert.ok(!POLICIES.release.required.includes('dependency-review'));
  assert.deepEqual(
    POLICIES.push.waived.map((waiver) => waiver.gate),
    ['dependency-review'],
  );
  assert.deepEqual(
    POLICIES.release.waived.map((waiver) => waiver.substitute),
    ['audit'],
  );
  assert.ok(POLICIES.release.required.includes('coverage-global'), 'release deve cobrar coverage global');
  assert.ok(POLICIES.release.required.includes('load'), 'release deve cobrar carga');
  assert.ok(!POLICIES.push.required.includes('coverage-global'), 'push não deve exigir gate pendente');
});

// ---------------------------------------------------------------------------
// 2. Fixtures de payloads GitHub API por evento.
// ---------------------------------------------------------------------------
const run = (id, name, runNumber = 1, extra = {}) => ({
  id,
  name,
  run_number: runNumber,
  head_sha: SHA,
  status: 'completed',
  conclusion: 'success',
  run_attempt: 1,
  created_at: `2026-09-13T00:00:${String(runNumber).padStart(2, '0')}Z`,
  ...extra,
});
const job = (name, conclusion = 'success') => ({ name, conclusion, labels: [] });

const imageEvidence = {
  commit: SHA,
  lockfileSha256: LOCK_SHA,
  sourceSha256: SOURCE_SHA,
  runId: '106',
  attempt: '1',
  generatedAt: new Date().toISOString(),
  images: ['cvg-desk-api', 'cvg-desk-web', 'cvg-message-worker', 'cvg-realtime-service'].map((name, index) => ({
    name,
    digest: `sha256:${String(index + 1).repeat(64)}`,
  })),
};

function baseFixture() {
  const runs = {
    total_count: 7,
    workflow_runs: [
      run(101, 'CI Quality Gate', 7),
      run(102, 'PostgreSQL Real Tests', 2),
      run(103, 'Smoke E2E', 2),
      run(105, 'Supply Chain Security', 4),
      run(106, 'Triple AAA Gate', 5),
      run(107, 'Staging Integrations (MinIO + ClamAV + OTel Collector real)', 1),
    ],
  };
  const jobs = {
    101: {
      total_count: 12,
      jobs: [
        job('Lint (real, zero errors)'),
        job('Typecheck (real per package)'),
        job('Unit tests (no DB)'),
        job('Integration tests (isolated PG + Redis)'),
        job('Contract tests (messaging-contracts)'),
        job('Coverage (shared thresholds)'),
        job('Migration check (fresh DB)'),
        job('Build (real, macro)'),
        job('Dependency audit (high blocks)'),
        job('Docker build (frozen lockfile, Node 24)'),
        job('Aggregate gate (per SHA)'),
        job('SBOM (CycloneDX workspace)'),
      ],
    },
    102: { total_count: 1, jobs: [job('PostgreSQL Real Suites')] },
    103: { total_count: 1, jobs: [job('Smoke E2E Tests')] },
    105: {
      total_count: 6,
      jobs: [
        job('CodeQL (SAST)'),
        job('Secret scan (Gitleaks)'),
        job('Container scan (Trivy)'),
        job('Dependency review', 'skipped'),
        job('SBOM (CycloneDX)'),
        job('pnpm audit'),
      ],
    },
    106: {
      total_count: 5,
      jobs: [
        job('Critical gates (lint, typecheck, integration, migrations, build)'),
        job('Migration upgrade (previous -> current)'),
        job('Image identity (build + digest)'),
        job('Security gate (audit high + secret scan)'),
        job('Promotion state'),
      ],
    },
    107: {
      total_count: 1,
      jobs: [job('Real MinIO + ClamAV + Collector smoke')],
    },
  };
  return { runs, jobs };
}

function ctx(fixture, { imageFor = () => imageEvidence } = {}) {
  return {
    runsPayload: fixture.runs,
    getJobsPayload: (runId) => fixture.jobs[runId] ?? { total_count: 0, jobs: [] },
    getImageEvidence: imageFor,
    sha: SHA,
    candidateIdentity: { commit: SHA, lockfileSha256: LOCK_SHA, sourceSha256: SOURCE_SHA },
  };
}

// ---------------------------------------------------------------------------
// 3. Política push: todos requeridos verdes aceitos; adversariais rejeitados.
// ---------------------------------------------------------------------------
test('push: todos requeridos verdes -> VERIFIED_CANDIDATE com dependency-review dispensado por substituto', () => {
  const fixture = baseFixture();
  const result = evaluateRequired(REQUIRED, { ...ctx(fixture), event: 'push' });
  const failures = Object.entries(result.gates).filter(([, value]) => value.required && !['PASS', 'WAIVED_WITH_SUBSTITUTE'].includes(value.status));
  assert.deepEqual(failures, [], JSON.stringify(result.gates, null, 2));
  assert.equal(result.state, 'VERIFIED_CANDIDATE');
  assert.equal(result.gates['dependency-review'].status, 'WAIVED_WITH_SUBSTITUTE');
  assert.equal(result.promotionEligible, true);
});

test('adversarial auditoria: Docker+aggregate falham e staging ausente -> FAILED (não VERIFIED)', () => {
  const fixture = baseFixture();
  fixture.jobs[101].jobs = fixture.jobs[101].jobs.map((entry) => {
    if (/Docker build/.test(entry.name)) return job(entry.name, 'failure');
    if (/Aggregate gate/.test(entry.name)) return job(entry.name, 'failure');
    return entry;
  });
  delete fixture.jobs[107];
  const result = evaluateRequired(REQUIRED, { ...ctx(fixture), event: 'push' });
  assert.equal(result.gates.docker.status, 'FAIL');
  assert.equal(result.gates['ci-aggregate'].status, 'FAIL');
  assert.equal(result.gates['staging-real'].status, 'NOT_VERIFIED');
  assert.equal(result.state, 'FAILED');
  assert.equal(result.promotionEligible, false);
});

test('job duplicado é rejeitado (INVALID), mesmo com um sucesso', () => {
  const fixture = baseFixture();
  fixture.jobs[101].jobs.push(job('Lint (real, zero errors)', 'success'));
  const result = evaluateRequired(REQUIRED, { ...ctx(fixture), event: 'push' });
  assert.equal(result.gates.lint.status, 'INVALID');
  assert.match(result.gates.lint.reasons.join(' '), /duplicado/);
  assert.equal(result.state, 'FAILED');
});

test('job renomeado -> NOT_VERIFIED e estado CONDITIONAL (nunca PASS silencioso)', () => {
  const fixture = baseFixture();
  fixture.jobs[101].jobs = fixture.jobs[101].jobs.filter((entry) => !/Docker build/.test(entry.name));
  const result = evaluateRequired(REQUIRED, { ...ctx(fixture), event: 'push' });
  assert.equal(result.gates.docker.status, 'NOT_VERIFIED');
  assert.match(result.gates.docker.reasons.join(' '), /não encontrado|renomeado/);
  assert.equal(result.state, 'CONDITIONAL');
});

test('skip indevido em check requerido reprova', () => {
  const fixture = baseFixture();
  fixture.jobs[101].jobs = fixture.jobs[101].jobs.map((entry) =>
    /Coverage \(shared/.test(entry.name) ? job(entry.name, 'skipped') : entry,
  );
  const result = evaluateRequired(REQUIRED, { ...ctx(fixture), event: 'push' });
  assert.equal(result.gates['coverage-shared'].status, 'FAIL');
  assert.equal(result.state, 'FAILED');
});

test('sucesso antigo (run de outro SHA) não conta e reprova', () => {
  const fixture = baseFixture();
  fixture.runs.workflow_runs = fixture.runs.workflow_runs.map((entry) =>
    /Supply Chain Security/.test(entry.name) ? { ...entry, head_sha: OLD_SHA } : entry,
  );
  const result = evaluateRequired(REQUIRED, { ...ctx(fixture), event: 'push' });
  assert.equal(result.gates.codeql.status, 'INVALID');
  assert.match(result.gates.codeql.reasons.join(' '), /outro SHA|SHA divergente|não executou/);
  assert.equal(result.state, 'FAILED');
});

test('run cancelada reprova', () => {
  const fixture = baseFixture();
  fixture.runs.workflow_runs = fixture.runs.workflow_runs.map((entry) =>
    /Smoke E2E/.test(entry.name) ? { ...entry, conclusion: 'cancelled' } : entry,
  );
  const result = evaluateRequired(REQUIRED, { ...ctx(fixture), event: 'push' });
  assert.equal(result.gates['boot-smoke'].status, 'FAIL');
  assert.equal(result.state, 'FAILED');
});

test('payload de runs malformado/indisponível -> FAILED, sem crash', () => {
  for (const payload of [null, undefined, 'oops', 42, { total_count: 0 }, { workflow_runs: {} }]) {
    const result = evaluateRequired(REQUIRED, { ...ctx({ runs: payload, jobs: {} }), event: 'push' });
    assert.equal(result.state, 'FAILED', `payload ${JSON.stringify(payload)} deveria reprovar`);
    assert.ok(result.invalid > 0);
  }
});

test('payload de jobs malformado -> INVALID para o workflow', () => {
  const fixture = baseFixture();
  const result = evaluateRequired(REQUIRED, {
    ...ctx(fixture),
    getJobsPayload: (runId) => (runId === 101 ? 'malformed' : fixture.jobs[runId]),
    event: 'push',
  });
  assert.equal(result.gates.lint.status, 'INVALID');
  assert.equal(result.state, 'FAILED');
});

// ---------------------------------------------------------------------------
// 4. Imagem testada e paginação.
// ---------------------------------------------------------------------------
test('imagem com digest de outro commit/duplicado é rejeitada', () => {
  const fixture = baseFixture();
  const badCommit = evaluateRequired(REQUIRED, {
    ...ctx(fixture, { imageFor: () => ({ ...imageEvidence, commit: OLD_SHA }) }),
    event: 'push',
  });
  assert.equal(badCommit.gates['image-identity'].status, 'INVALID');
  assert.equal(badCommit.state, 'FAILED');

  const duplicated = structuredClone(imageEvidence);
  duplicated.images[1].digest = duplicated.images[0].digest;
  const badDigest = evaluateRequired(REQUIRED, {
    ...ctx(fixture, { imageFor: () => duplicated }),
    event: 'push',
  });
  assert.equal(badDigest.gates['image-identity'].status, 'INVALID');
  assert.match(badDigest.gates['image-identity'].reasons.join(' '), /duplicado/);
});

test('imagem sem artefato é rejeitada', () => {
  const fixture = baseFixture();
  const result = evaluateRequired(REQUIRED, { ...ctx(fixture, { imageFor: () => null }), event: 'push' });
  assert.equal(result.gates['image-identity'].status, 'INVALID');
  assert.equal(result.state, 'FAILED');
});

test('collectPages junta páginas até o total reportado', () => {
  const pages = {
    1: { total_count: 150, jobs: Array.from({ length: 100 }, (_, index) => job(`j${index}`)) },
    2: { total_count: 150, jobs: Array.from({ length: 50 }, (_, index) => job(`k${index}`)) },
  };
  const collected = collectPages((page) => pages[page] ?? { total_count: 150, jobs: [] }, 'jobs');
  assert.equal(collected.length, 150);
  assert.equal(collected[0].name, 'j0');
  assert.equal(collected[149].name, 'k49');
  const runs = collectPages(
    (page) => (page === 1 ? { total_count: 2, workflow_runs: [run(1, 'x', 1)] } : { total_count: 2, workflow_runs: [run(2, 'x', 2)] }),
    'workflow_runs',
  );
  assert.equal(runs.length, 2);
});

// ---------------------------------------------------------------------------
// 5. Release e scheduled.
// ---------------------------------------------------------------------------
test('release sem proof global/carga fica BLOCKED com bloqueadores explícitos (não silencioso)', () => {
  const fixture = baseFixture();
  fixture.runs.workflow_runs.push(run(104, 'DR End-to-End (backup/restore proof)', 1));
  fixture.jobs[104] = { total_count: 1, jobs: [job('Backup, destroy, restore, validate, smoke')] };
  const result = evaluateRequired(REQUIRED, { ...ctx(fixture), event: 'release' });
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.gates['coverage-global'].status, 'PENDING_IMPLEMENTATION');
  assert.equal(result.gates.load.status, 'PENDING_IMPLEMENTATION');
  assert.ok(result.releaseBlockers.some((entry) => entry.includes('coverage-global')));
  assert.ok(result.releaseBlockers.some((entry) => entry.includes('load')));
  assert.equal(result.promotionEligible, false);
  assert.equal(result.gates['dr-e2e'].status, 'PASS');
});

test('release com check vermelho explícito é FAILED, com substitute ausente reprovando', () => {
  const fixture = baseFixture();
  fixture.jobs[101].jobs = fixture.jobs[101].jobs.map((entry) =>
    /Dependency audit/.test(entry.name) ? job(entry.name, 'failure') : entry,
  );
  const result = evaluateRequired(REQUIRED, { ...ctx(fixture), event: 'release' });
  assert.equal(result.state, 'FAILED');
  assert.equal(result.gates['dependency-review'].status, 'FAIL');
  assert.match(result.gates['dependency-review'].reasons.join(' '), /substituto audit=FAIL/);
});

test('scheduled cobre segurança e DR sem exigir gates de push', () => {
  const fixture = { runs: { total_count: 2, workflow_runs: [run(105, 'Supply Chain Security', 4), run(104, 'DR End-to-End (backup/restore proof)', 1)] }, jobs: {} };
  fixture.jobs = {
    105: {
      total_count: 5,
      jobs: [
        job('CodeQL (SAST)'),
        job('Secret scan (Gitleaks)'),
        job('Container scan (Trivy)'),
        job('SBOM (CycloneDX)'),
        job('pnpm audit'),
      ],
    },
    104: { total_count: 1, jobs: [job('Backup, destroy, restore, validate, smoke')] },
  };
  const result = evaluateRequired(REQUIRED, { ...ctx(fixture), event: 'schedule' });
  assert.equal(result.state, 'VERIFIED_CANDIDATE');
  assert.equal(result.promotionEligible, false, 'schedule não promove candidato');
  assert.equal(result.gates['dependency-review'].status, 'NOT_APPLICABLE');
  assert.equal(result.gates.docker.status, 'NOT_APPLICABLE');
});

test('pull_request exige dependency-review executado (skip reprova)', () => {
  const fixture = baseFixture();
  fixture.runs.workflow_runs = fixture.runs.workflow_runs.filter((entry) => !/Staging Integrations/.test(entry.name));
  const prResult = evaluateRequired(REQUIRED, { ...ctx(fixture), event: 'pull_request' });
  assert.equal(prResult.gates['dependency-review'].status, 'FAIL');
  const fixed = structuredClone(fixture);
  fixed.jobs[105].jobs = fixed.jobs[105].jobs.map((entry) =>
    /Dependency review/.test(entry.name) ? job(entry.name, 'success') : entry,
  );
  const okResult = evaluateRequired(REQUIRED, { ...ctx(fixed), event: 'pull_request' });
  const blocking = Object.entries(okResult.gates).filter(([, value]) => value.required && !['PASS', 'WAIVED_WITH_SUBSTITUTE'].includes(value.status));
  assert.deepEqual(blocking, [], JSON.stringify(okResult.gates, null, 2));
  assert.equal(okResult.gates['dependency-review'].status, 'PASS');
  assert.equal(okResult.state, 'VERIFIED_CANDIDATE');
  assert.equal(okResult.promotionEligible, false, 'PR não promove candidato');
});

// ---------------------------------------------------------------------------
// 6. main() e utilitários.
// ---------------------------------------------------------------------------
test('main() escreve relatório e outputs para o evento release', () => {
  const artifactsDir = mkdtempSync(join(tmpdir(), 'agg-main-'));
  const outputFile = join(artifactsDir, 'github-output.txt');
  const fixture = baseFixture();
  try {
    const report = main(
      { SHA, EVENT: 'push', AGGREGATOR_ARTIFACTS_DIR: artifactsDir, GITHUB_OUTPUT: outputFile },
      {
        runsPayload: fixture.runs,
        getJobsPayload: (runId) => fixture.jobs[runId] ?? { total_count: 0, jobs: [] },
        getImageEvidence: () => imageEvidence,
        candidateIdentity: { commit: SHA, lockfileSha256: LOCK_SHA, sourceSha256: SOURCE_SHA },
      },
    );
    assert.equal(report.promotionState, 'VERIFIED_CANDIDATE');
    assert.equal(report.certification.state, 'NOT_ELIGIBLE_LOCAL');
    const written = JSON.parse(readFileSync(join(artifactsDir, 'triple-aaa-report.json'), 'utf8'));
    assert.equal(written.commit, SHA);
    assert.match(readFileSync(outputFile, 'utf8'), /state=VERIFIED_CANDIDATE/);
  } finally {
    rmSync(artifactsDir, { recursive: true, force: true });
  }
});

test('asArray/pickLatest resistem a payloads quebrados', () => {
  assert.deepEqual(asArray({ total_count: 2, workflow_runs: [1, 2] }, 'workflow_runs'), [1, 2]);
  assert.deepEqual(asArray([1, 2], 'workflow_runs'), [1, 2]);
  assert.deepEqual(asArray({ total_count: 0 }, 'workflow_runs'), []);
  assert.deepEqual(asArray({ workflow_runs: 'nope' }, 'workflow_runs'), []);
  assert.deepEqual(asArray(null, 'workflow_runs'), []);
  assert.deepEqual(asArray('[]', 'workflow_runs'), []);
  assert.equal(pickLatest([run(1, 'x', 2), run(2, 'x', 9), run(3, 'x', 5)]).id, 2);
});

test('validateImageEvidence aceita 4 imagens válidas e rejeita vazio', () => {
  assert.equal(validateImageEvidence(imageEvidence, SHA, { lockfileSha256: LOCK_SHA, sourceSha256: SOURCE_SHA }).ok, true);
  assert.equal(validateImageEvidence(null, SHA).ok, false);
  assert.equal(validateImageEvidence({ ...imageEvidence, images: [] }, SHA).ok, false);
});
