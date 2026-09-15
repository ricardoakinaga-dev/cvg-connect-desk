// PROD-03 repro (after): mesmos adversariais da auditoria, agora contra o
// agregador corrigido. Demonstra rejeição e a política de waivers.
import { EVENTS, POLICIES, REQUIRED, evaluateRequired } from '../../../../.github/scripts/certification-aggregator.mjs';

const SHA = 'a'.repeat(40);
const run = (id, name, extra = {}) => ({ id, name, run_number: 1, head_sha: SHA, status: 'completed', conclusion: 'success', created_at: '2026-09-13T00:00:01Z', ...extra });
const job = (name, conclusion = 'success') => ({ name, conclusion, labels: [] });
const imageEvidence = {
  commit: SHA,
  images: ['cvg-desk-api', 'cvg-desk-web', 'cvg-message-worker', 'cvg-realtime-service'].map((name, index) => ({
    name,
    digest: `sha256:${String(index + 1).repeat(64)}`,
  })),
};

function jobs101() {
  return {
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
  };
}
function baseRuns() {
  return {
    total_count: 7,
    workflow_runs: [
      run(101, 'CI Quality Gate'),
      run(102, 'PostgreSQL Real Tests'),
      run(103, 'Smoke E2E'),
      run(105, 'Supply Chain Security'),
      run(106, 'Triple AAA Gate'),
      run(107, 'Staging Integrations (MinIO + ClamAV + OTel Collector real)'),
      run(104, 'DR End-to-End (backup/restore proof)'),
    ],
  };
}
function baseJobs() {
  return {
    101: jobs101(),
    102: { total_count: 1, jobs: [job('PostgreSQL Real Suites')] },
    103: { total_count: 1, jobs: [job('Smoke E2E Tests')] },
    104: { total_count: 1, jobs: [job('Backup, destroy, restore, validate, smoke')] },
    105: {
      total_count: 6,
      jobs: [job('CodeQL (SAST)'), job('Secret scan (Gitleaks)'), job('Container scan (Trivy)'), job('Dependency review', 'skipped'), job('SBOM (CycloneDX)'), job('pnpm audit')],
    },
    106: {
      total_count: 5,
      jobs: [job('Critical gates (lint, typecheck, integration, migrations, build)'), job('Migration upgrade (previous -> current)'), job('Image identity (build + digest)'), job('Security gate (audit high + secret scan)'), job('Promotion state')],
    },
    107: { total_count: 1, jobs: [job('Real MinIO + ClamAV + Collector smoke')] },
  };
}
const ctx = (runs, jobs) => ({
  runsPayload: runs,
  getJobsPayload: (runId) => jobs[runId] ?? { total_count: 0, jobs: [] },
  getImageEvidence: () => imageEvidence,
  sha: SHA,
});

// (1) Adversarial original: Docker+aggregate falham, staging ausente.
{
  const jobs = baseJobs();
  jobs[101].jobs = jobs[101].jobs.map((entry) => {
    if (/Docker build/.test(entry.name)) return job(entry.name, 'failure');
    if (/Aggregate gate/.test(entry.name)) return job(entry.name, 'failure');
    return entry;
  });
  delete jobs[107];
  const result = evaluateRequired(REQUIRED, { ...ctx(baseRuns(), jobs), event: 'push' });
  console.log(`ADVERSARIAL Docker+aggregate failed, staging absent: ${result.state}`);
  console.log(`  docker=${result.gates.docker.status} aggregate=${result.gates['ci-aggregate'].status} staging=${result.gates['staging-real'].status}`);
}
// (2) Adversarial original: push com dependency-review skip.
{
  const result = evaluateRequired(REQUIRED, { ...ctx(baseRuns(), baseJobs()), event: 'push' });
  console.log(`PUSH dependency-review skips per workflow: ${result.state} (${result.gates['dependency-review'].status})`);
}
// (3) Release sem prova de coverage global/carga.
{
  const result = evaluateRequired(REQUIRED, { ...ctx(baseRuns(), baseJobs()), event: 'release' });
  console.log(`RELEASE sem coverage-global/load: ${result.state} blockers=${result.releaseBlockers.length}`);
}
// (4) Eventos e required sets.
for (const event of EVENTS) {
  console.log(`POLICY ${event}: ${POLICIES[event].required.length} requeridos, ${POLICIES[event].waived.length} waiver(s)`);
}
