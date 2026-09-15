// PROD-03 — regressão do agregador e políticas required (AC1–AC4).
// Executa as funções reais do agregador sobre fixtures fiéis da API GitHub,
// reproduz os adversariais da auditoria, valida os YAML com parser real e
// registra explicitamente o que não pôde ser comprovado (rulesets remotos).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import {
  EVENTS,
  POLICIES,
  REQUIRED,
  collectPages,
  evaluateRequired,
  fetchJobsPaged,
  fetchRunsPaged,
  main,
  validateImageEvidence,
} from '../../.github/scripts/certification-aggregator.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const SHA = 'a'.repeat(40);
const OLD_SHA = 'b'.repeat(40);
const LOCK_SHA = 'c'.repeat(64);
const SOURCE_SHA = 'd'.repeat(64);

// --- fixtures fiéis aos payloads da API (nunca mocks da lógica avaliada) ---
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

function fixtureAllGreen() {
  const runs = {
    total_count: 7,
    workflow_runs: [
      run(101, 'CI Quality Gate', 7),
      run(102, 'PostgreSQL Real Tests', 2),
      run(103, 'Smoke E2E', 2),
      run(105, 'Supply Chain Security', 4),
      run(106, 'Triple AAA Gate', 5),
      run(107, 'Staging Integrations (MinIO + ClamAV + OTel Collector real)', 1),
      run(104, 'DR End-to-End (backup/restore proof)', 1),
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
    104: { total_count: 1, jobs: [job('Backup, destroy, restore, validate, smoke')] },
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
    107: { total_count: 1, jobs: [job('Real MinIO + ClamAV + Collector smoke')] },
  };
  return { runs, jobs };
}

function ctx(fixture, options = {}) {
  return {
    runsPayload: fixture.runs,
    getJobsPayload: (runId) => fixture.jobs[runId] ?? { total_count: 0, jobs: [] },
    getImageEvidence: options.imageFor ?? (() => imageEvidence),
    sha: options.sha ?? SHA,
    event: options.event ?? 'push',
  };
}

function blockingOf(result) {
  return Object.entries(result.gates).filter(
    ([, value]) => value.required && !['PASS', 'WAIVED_WITH_SUBSTITUTE'].includes(value.status),
  );
}

// ---------------------------------------------------------------------------
// AC1 — inventário e agregados.
// ---------------------------------------------------------------------------
test('AC1 — inventário cobre Docker/boot, staging, coverage global, migrations fresh/upgrade, E2E, carga/DR e segurança', () => {
  const scopes = new Set(REQUIRED.map((descriptor) => descriptor.scope));
  for (const scope of [
    'docker',
    'docker-boot-image',
    'boot-e2e',
    'staging-real',
    'coverage-shared',
    'coverage-global',
    'migrations-fresh',
    'migrations-upgrade',
    'dr',
    'load',
    'security-sast',
    'security-secrets',
    'security-containers',
    'security-sbom',
    'security-audit',
    'security-dependency-review',
    'postgres-real',
  ]) {
    assert.ok(scopes.has(scope), `escopo ${scope} ausente do inventário`);
  }
  const fresh = REQUIRED.find((descriptor) => descriptor.gate === 'migrations-fresh');
  const upgrade = REQUIRED.find((descriptor) => descriptor.gate === 'migrations-upgrade');
  assert.notEqual(fresh.wf, upgrade.wf, 'fresh e upgrade devem ser jobs/workflows distintos');
  assert.ok(upgrade.match.test('Migration upgrade (previous -> current)'));
  assert.ok(!upgrade.match.test('Migration check (fresh DB)'), 'upgrade não pode casar o job fresh');
});

test('AC1 — falha de dependente não é escondida por job agregado', () => {
  const fixture = fixtureAllGreen();
  // Agregado verde (ci-aggregate e promotion-state success) mas Docker vermelho.
  fixture.jobs[101].jobs = fixture.jobs[101].jobs.map((entry) =>
    /Docker build/.test(entry.name) ? job(entry.name, 'failure') : entry,
  );
  const result = evaluateRequired(REQUIRED, ctx(fixture));
  assert.equal(result.gates.docker.status, 'FAIL');
  assert.equal(result.gates['ci-aggregate'].status, 'PASS');
  assert.equal(result.state, 'FAILED');
});

// ---------------------------------------------------------------------------
// AC2 — políticas por evento.
// ---------------------------------------------------------------------------
test('AC2 — PR exige dependency-review; push não fica impossível; release não dispensa em silêncio', () => {
  assert.ok(POLICIES.pull_request.required.includes('dependency-review'));
  const pushWaiver = POLICIES.push.waived.find((waiver) => waiver.gate === 'dependency-review');
  assert.ok(pushWaiver, 'push deve declarar o waiver de dependency-review');
  assert.equal(pushWaiver.substitute, 'audit');
  const releaseWaiver = POLICIES.release.waived.find((waiver) => waiver.gate === 'dependency-review');
  assert.ok(releaseWaiver && releaseWaiver.substitute === 'audit');
  assert.match(releaseWaiver.reason, /nunca dispensa silenciosa/);
});

test('AC2 — push com dependency-review skip e audit verde é aceito; sem substituto reprova', () => {
  const fixture = fixtureAllGreen();
  const accepted = evaluateRequired(REQUIRED, ctx(fixture));
  assert.equal(accepted.gates['dependency-review'].status, 'WAIVED_WITH_SUBSTITUTE');
  assert.equal(accepted.state, 'VERIFIED_CANDIDATE');

  const broken = fixtureAllGreen();
  broken.jobs[101].jobs = broken.jobs[101].jobs.map((entry) =>
    /Dependency audit/.test(entry.name) ? job(entry.name, 'failure') : entry,
  );
  const rejected = evaluateRequired(REQUIRED, ctx(broken));
  assert.equal(rejected.gates['dependency-review'].status, 'FAIL');
  assert.match(rejected.gates['dependency-review'].reasons.join(' '), /substituto audit=FAIL/);
  assert.equal(rejected.state, 'FAILED');
});

test('AC2 — release sem prova obrigatória fica BLOCKED com dono e motivo (não silencioso)', () => {
  const fixture = fixtureAllGreen();
  const result = evaluateRequired(REQUIRED, ctx(fixture, { event: 'release' }));
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.gates['coverage-global'].status, 'PENDING_IMPLEMENTATION');
  assert.equal(result.gates.load.status, 'PENDING_IMPLEMENTATION');
  assert.ok(result.releaseBlockers.some((entry) => entry.includes('PROD-34')));
  assert.ok(result.releaseBlockers.some((entry) => entry.includes('PROD-33')));
  assert.equal(result.promotionEligible, false);
});

test('AC2 — scheduled avalia apenas gates agendados e nunca promove candidato', () => {
  const fixture = {
    runs: {
      total_count: 2,
      workflow_runs: [run(105, 'Supply Chain Security', 4), run(104, 'DR End-to-End (backup/restore proof)', 1)],
    },
    jobs: {
      105: {
        total_count: 5,
        jobs: [job('CodeQL (SAST)'), job('Secret scan (Gitleaks)'), job('Container scan (Trivy)'), job('SBOM (CycloneDX)'), job('pnpm audit')],
      },
      104: { total_count: 1, jobs: [job('Backup, destroy, restore, validate, smoke')] },
    },
  };
  const result = evaluateRequired(REQUIRED, ctx(fixture, { event: 'schedule' }));
  assert.equal(result.state, 'VERIFIED_CANDIDATE');
  assert.equal(result.promotionEligible, false);
  assert.equal(result.gates['dependency-review'].status, 'NOT_APPLICABLE');
  assert.equal(result.gates['coverage-shared'].status, 'NOT_APPLICABLE');
});

// ---------------------------------------------------------------------------
// AC3 — SHA, imagem, paginação e adversariais.
// ---------------------------------------------------------------------------
test('AC3 — consulta paginada junta runs/jobs no SHA correto (100 por página)', () => {
  const runPages = {
    1: { total_count: 150, workflow_runs: [run(1, 'CI Quality Gate', 1)] },
    2: { total_count: 150, workflow_runs: [run(2, 'CI Quality Gate', 2)] },
  };
  const fetchedRuns = fetchRunsPaged(SHA, (page) => runPages[page] ?? { total_count: 150, workflow_runs: [] });
  assert.equal(fetchedRuns.length, 2, 'paginação de runs deve acumular páginas');

  const jobPages = {
    1: { total_count: 101, jobs: Array.from({ length: 100 }, (_, index) => job(`j${index}`)) },
    2: { total_count: 101, jobs: [job('j100')] },
  };
  const fetchedJobs = fetchJobsPaged(7, (page) => jobPages[page] ?? { total_count: 101, jobs: [] });
  assert.equal(fetchedJobs.length, 101, 'paginação de jobs deve acumular páginas');
  assert.equal(collectPages(() => ({ total_count: 0, jobs: [] }), 'jobs').length, 0);
  assert.throws(
    () => fetchJobsPaged(7, (page) => (page === 1 ? { total_count: 101, jobs: [job('j0')] } : null)),
    /payload ausente/,
    'payload de página ausente não pode ser tratado como fim normal',
  );
});

test('AC3 — imagem testada exige digest do mesmo candidato e sem duplicidade', () => {
  assert.equal(validateImageEvidence(imageEvidence, SHA).ok, true);
  assert.equal(validateImageEvidence({ ...imageEvidence, commit: OLD_SHA }, SHA).ok, false);
  const duplicated = structuredClone(imageEvidence);
  duplicated.images[3].digest = duplicated.images[0].digest;
  const verdict = validateImageEvidence(duplicated, SHA);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons.join(' '), /duplicado/);
  assert.equal(validateImageEvidence({ ...imageEvidence, images: [] }, SHA).ok, false);

  const conflictingNested = structuredClone(imageEvidence);
  conflictingNested.candidate = { commit: OLD_SHA, lockfileSha256: LOCK_SHA, sourceSha256: SOURCE_SHA };
  const conflictVerdict = validateImageEvidence(conflictingNested, SHA);
  assert.equal(conflictVerdict.ok, false);
  assert.match(conflictVerdict.reasons.join(' '), /contraditório|divergente/);

  const duplicatedName = structuredClone(imageEvidence);
  duplicatedName.images[1].name = duplicatedName.images[0].name;
  const duplicateNameVerdict = validateImageEvidence(duplicatedName, SHA);
  assert.equal(duplicateNameVerdict.ok, false);
  assert.match(duplicateNameVerdict.reasons.join(' '), /duplicada|ausente/);

  const stale = { ...imageEvidence, generatedAt: '2000-01-01T00:00:00.000Z' };
  const staleVerdict = validateImageEvidence(stale, SHA, null, { runId: 106, attempt: 1, createdAt: '2026-09-13T00:00:00.000Z' });
  assert.equal(staleVerdict.ok, false);
  assert.match(staleVerdict.reasons.join(' '), /antigo/);
});

test('PROD-03-R3-AC1 — identidade da imagem deve apontar ao run/attempt selecionado', () => {
  assert.equal(
    validateImageEvidence(imageEvidence, SHA, { lockfileSha256: LOCK_SHA, sourceSha256: SOURCE_SHA }, { runId: 106, attempt: 1 }).ok,
    true,
  );
  const wrongRun = validateImageEvidence(
    { ...imageEvidence, runId: '999' },
    SHA,
    { lockfileSha256: LOCK_SHA, sourceSha256: SOURCE_SHA },
    { runId: 106, attempt: 1 },
  );
  assert.equal(wrongRun.ok, false);
  assert.match(wrongRun.reasons.join(' '), /runId da imagem divergente/);
  const wrongAttempt = validateImageEvidence(
    { ...imageEvidence, attempt: '2' },
    SHA,
    { lockfileSha256: LOCK_SHA, sourceSha256: SOURCE_SHA },
    { runId: 106, attempt: 1 },
  );
  assert.equal(wrongAttempt.ok, false);
  assert.match(wrongAttempt.reasons.join(' '), /attempt da imagem divergente/);

  const fixture = fixtureAllGreen();
  const rejected = evaluateRequired(REQUIRED, {
    ...ctx(fixture, { imageFor: () => ({ ...imageEvidence, runId: '999' }) }),
    event: 'push',
  });
  assert.equal(rejected.gates['image-identity'].status, 'INVALID');
  assert.equal(rejected.state, 'FAILED');
});

test('AC3 — adversarial Docker+aggregate falham e staging ausente: rejeitado (reprodução da auditoria)', () => {
  const fixture = fixtureAllGreen();
  fixture.jobs[101].jobs = fixture.jobs[101].jobs.map((entry) => {
    if (/Docker build/.test(entry.name)) return job(entry.name, 'failure');
    if (/Aggregate gate/.test(entry.name)) return job(entry.name, 'failure');
    return entry;
  });
  delete fixture.jobs[107];
  const result = evaluateRequired(REQUIRED, ctx(fixture));
  assert.equal(result.gates.docker.status, 'FAIL');
  assert.equal(result.gates['ci-aggregate'].status, 'FAIL');
  assert.equal(result.gates['staging-real'].status, 'NOT_VERIFIED');
  assert.equal(result.state, 'FAILED');
  assert.notEqual(result.state, 'VERIFIED_CANDIDATE');
});

test('AC3 — sucesso antigo, cancelamento, duplicado, renomeado e skip são rejeitados', () => {
  const old = fixtureAllGreen();
  old.runs.workflow_runs = old.runs.workflow_runs.map((entry) =>
    /CI Quality Gate/.test(entry.name) ? { ...entry, head_sha: OLD_SHA } : entry,
  );
  const oldResult = evaluateRequired(REQUIRED, ctx(old));
  assert.equal(oldResult.gates.lint.status, 'INVALID');
  assert.equal(oldResult.state, 'FAILED');

  const cancelled = fixtureAllGreen();
  cancelled.runs.workflow_runs = cancelled.runs.workflow_runs.map((entry) =>
    /Smoke E2E/.test(entry.name) ? { ...entry, conclusion: 'cancelled' } : entry,
  );
  assert.equal(evaluateRequired(REQUIRED, ctx(cancelled)).gates['boot-smoke'].status, 'FAIL');

  const duplicate = fixtureAllGreen();
  duplicate.jobs[101].jobs.push(job('Lint (real, zero errors)'));
  assert.equal(evaluateRequired(REQUIRED, ctx(duplicate)).gates.lint.status, 'INVALID');

  const renamed = fixtureAllGreen();
  renamed.jobs[101].jobs = renamed.jobs[101].jobs.filter((entry) => !/Docker build/.test(entry.name));
  const renamedResult = evaluateRequired(REQUIRED, ctx(renamed));
  assert.equal(renamedResult.gates.docker.status, 'NOT_VERIFIED');
  assert.equal(renamedResult.state, 'CONDITIONAL');

  const skipped = fixtureAllGreen();
  skipped.jobs[101].jobs = skipped.jobs[101].jobs.map((entry) =>
    /Coverage \(shared/.test(entry.name) ? job(entry.name, 'skipped') : entry,
  );
  assert.equal(evaluateRequired(REQUIRED, ctx(skipped)).state, 'FAILED');
});

test('AC3 — payload malformado é rejeitado sem crash', () => {
  for (const payload of [null, 'oops', 42, { workflow_runs: {} }]) {
    const result = evaluateRequired(REQUIRED, ctx({ runs: payload, jobs: {} }));
    assert.equal(result.state, 'FAILED');
    assert.ok(result.invalid > 0);
  }
  const fixture = fixtureAllGreen();
  const badJobs = evaluateRequired(REQUIRED, {
    ...ctx(fixture),
    getJobsPayload: (runId) => (runId === 106 ? 'malformed' : fixture.jobs[runId]),
  });
  assert.equal(badJobs.gates['image-identity'].status, 'INVALID');
});

test('AC3 — run selecionado sem metadados operacionais não pode virar PASS', () => {
  const fixture = fixtureAllGreen();
  fixture.runs.workflow_runs = fixture.runs.workflow_runs.map((entry) =>
    entry.name === 'CI Quality Gate' ? { ...entry, run_attempt: undefined } : entry,
  );
  const result = evaluateRequired(REQUIRED, ctx(fixture));
  assert.equal(result.gates.lint.status, 'INVALID');
  assert.match(result.gates.lint.reasons.join(' '), /run_attempt/);
  assert.equal(result.state, 'FAILED');
});

test('AC4 — inventário requerido vazio falha fechado', () => {
  const fixture = fixtureAllGreen();
  const result = evaluateRequired([], ctx(fixture));
  assert.equal(result.state, 'FAILED');
  assert.equal(result.promotionEligible, false);
  assert.match(result.releaseBlockers.join(' '), /inventário requerido vazio|gate requerido ausente/);
});

// ---------------------------------------------------------------------------
// AC4 — caso bom, main() e vínculo da configuração de required checks.
// ---------------------------------------------------------------------------
test('AC4 — todos os requeridos verdes são aceitos e main() publica relatório', () => {
  const fixture = fixtureAllGreen();
  const result = evaluateRequired(REQUIRED, ctx(fixture));
  assert.deepEqual(blockingOf(result), [], JSON.stringify(result.gates, null, 2));
  assert.equal(result.state, 'VERIFIED_CANDIDATE');
  assert.equal(result.promotionEligible, true);

  const artifactsDir = mkdtempSync(join(tmpdir(), 'prod03-main-'));
  try {
    const report = main(
      { SHA, EVENT: 'push', AGGREGATOR_ARTIFACTS_DIR: artifactsDir, GITHUB_OUTPUT: join(artifactsDir, 'out.txt') },
      {
        runsPayload: fixture.runs,
        getJobsPayload: (runId) => fixture.jobs[runId] ?? { total_count: 0, jobs: [] },
        getImageEvidence: () => imageEvidence,
        candidateIdentity: { commit: SHA, lockfileSha256: LOCK_SHA, sourceSha256: SOURCE_SHA },
      },
    );
    assert.equal(report.promotionState, 'VERIFIED_CANDIDATE');
    assert.equal(report.certification.state, 'NOT_ELIGIBLE_LOCAL');
    assert.equal(report.branchProtection.inspected, false, 'inspeção remota indisponível deve ser explícita');
    assert.ok(report.branchProtection.reason.length > 0);
    const onDisk = JSON.parse(readFileSync(join(artifactsDir, 'triple-aaa-report.json'), 'utf8'));
    assert.equal(onDisk.commit, SHA);
    assert.equal(onDisk.event, 'push');
    for (const eventName of EVENTS) {
      assert.ok(Array.isArray(onDisk.branchProtection.requiredChecksByEvent[eventName]));
    }
  } finally {
    rmSync(artifactsDir, { recursive: true, force: true });
  }
});

test('AC4 — configuração required por evento vincula workflows reais e eventos válidos', () => {
  for (const eventName of EVENTS) {
    const policy = POLICIES[eventName];
    assert.equal(policy.event, eventName);
    for (const gate of policy.required) {
      assert.ok(REQUIRED.some((descriptor) => descriptor.gate === gate), `gate ${gate} fora do inventário`);
    }
    for (const waiver of policy.waived) {
      assert.ok(REQUIRED.some((descriptor) => descriptor.gate === waiver.gate));
      assert.ok(policy.required.includes(waiver.substitute) || POLICIES[eventName].required.includes(waiver.substitute));
    }
  }
});

test('OPS04 — evento desconhecido falha fechado e não cai silenciosamente em push', () => {
  const fixture = fixtureAllGreen();
  const artifactsDir = mkdtempSync(join(tmpdir(), 'prod03-invalid-event-'));
  try {
    const report = main(
      { SHA, EVENT: 'relase', AGGREGATOR_ARTIFACTS_DIR: artifactsDir, GITHUB_OUTPUT: join(artifactsDir, 'out.txt') },
      {
        runsPayload: fixture.runs,
        getJobsPayload: (runId) => fixture.jobs[runId] ?? { total_count: 0, jobs: [] },
        getImageEvidence: () => imageEvidence,
        candidateIdentity: { commit: SHA, lockfileSha256: LOCK_SHA, sourceSha256: SOURCE_SHA },
      },
    );
    assert.equal(report.event, 'relase');
    assert.equal(report.requestedEvent, 'relase');
    assert.equal(report.promotionState, 'FAILED');
    assert.equal(report.promotionEligible, false);
    assert.match(report.releaseBlockers.join(' '), /evento sem política/);
  } finally {
    rmSync(artifactsDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// YAML — validação por parser real (actionlint indisponível no ambiente).
// ---------------------------------------------------------------------------
test('YAML — workflows parseiam e contêm os jobs requeridos (parser python3 yaml)', () => {
  const files = [
    '.github/workflows/triple-aaa-gate.yml',
    '.github/workflows/triple-aaa-certification.yml',
  ];
  const script = `
import json, sys, yaml
report = {}
for path in sys.argv[1:]:
    with open(path, encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    on_value = data.get("on", data.get(True))
    triggers = list(on_value.keys()) if isinstance(on_value, dict) else [on_value]
    jobs = list((data.get("jobs") or {}).keys())
    names = [job.get("name", key) for key, job in (data.get("jobs") or {}).items()]
    report[path] = {"name": data.get("name"), "jobs": jobs, "jobNames": names, "triggers": triggers}
print(json.dumps(report))
`;
  const parsed = spawnSync('python3', ['-c', script, ...files], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(parsed.status, 0, `parser YAML falhou: ${parsed.stderr}`);
  const report = JSON.parse(parsed.stdout);
  const gate = report['.github/workflows/triple-aaa-gate.yml'];
  assert.equal(gate.name, 'Triple AAA Gate');
  for (const requiredJob of ['critical-gates', 'migration-upgrade', 'image-identity', 'security-gate', 'promotion-state']) {
    assert.ok(gate.jobs.includes(requiredJob), `job ${requiredJob} ausente do gate`);
  }
  assert.ok(gate.jobNames.some((name) => /Migration upgrade/.test(name)));
  assert.ok(gate.jobNames.some((name) => /Image identity/.test(name)));

  const certification = report['.github/workflows/triple-aaa-certification.yml'];
  assert.match(certification.name, /Triple AAA Certification/);
  assert.ok(
    certification.triggers.includes('workflow_run') || certification.triggers.includes('workflow_dispatch'),
    `gatilhos inesperados: ${JSON.stringify(certification.triggers)}`,
  );

  const allWorkflows = spawnSync(
    'python3',
    [
      '-c',
      'import glob,sys,yaml\nfor path in glob.glob(".github/workflows/*.yml"):\n    with open(path, encoding="utf-8") as handle:\n        yaml.safe_load(handle)\nprint("ok")',
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  assert.equal(allWorkflows.status, 0, `workflow YAML quebrado: ${allWorkflows.stderr}`);
  assert.match(allWorkflows.stdout, /ok/);
});

test('AC4 — nenhum arquivo auxiliar de worktree ficou para trás no upgrade job', () => {
  const gate = readFileSync(join(REPO_ROOT, '.github/workflows/triple-aaa-gate.yml'), 'utf8');
  assert.match(gate, /rm -f packages\/database\/\.prod03-migration-upgrade\.check\.ts/);
  assert.equal(existsSync(join(REPO_ROOT, 'packages/database/.prod03-migration-upgrade.check.ts')), false);
});

// Mantém o artefato de trabalho isolado do repositório.
test('cleanup — diretórios temporários do teste não vazam para o repo', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'prod03-probe-'));
  writeFileSync(join(tmp, 'probe.txt'), 'ok');
  assert.equal(readFileSync(join(tmp, 'probe.txt'), 'utf8'), 'ok');
  rmSync(tmp, { recursive: true, force: true });
  assert.equal(existsSync(tmp), false);
});
