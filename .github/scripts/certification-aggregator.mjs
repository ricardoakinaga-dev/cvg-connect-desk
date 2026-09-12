#!/usr/bin/env node
/**
 * Certification aggregator (§3–4, §28).
 * Consulta a API de checks do SHA e calcula o estado REAL de promoção.
 * Required checks (por nome de workflow/job abaixo) — ausência = NOT VERIFIED.
 *
 * Por que via API: GitHub Actions não expõe estado cross-workflow por `needs`;
 * este agregador é a fonte única e inequívoca para o SHA.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const artifactsDir = join(root, 'artifacts');
mkdirSync(artifactsDir, { recursive: true });

const SHA = process.env.SHA || execSync('git rev-parse HEAD').toString().trim();
const token = process.env.GH_TOKEN;

function gh(args) {
  const cmd = token ? `gh api ${args} --jq .` : `gh api ${args} --jq .`;
  try {
    return JSON.parse(execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch (error) {
    console.error(`[aggregator] gh api falhou (${args}):`, error.stderr?.toString().slice(0, 300));
    return [];
  }
}

// Required gates nomeados em cada workflow. Job name prefix: <workflow> / <job>.
const REQUIRED = [
  { gate: 'lint', match: /Lint \+ Typecheck/i, wf: 'CI Quality Gate', jobs: ['lint-typecheck'] },
  { gate: 'unit', match: /Unit tests/i, wf: 'CI Quality Gate', jobs: ['unit'] },
  { gate: 'integration', match: /Integration/i, wf: 'CI Quality Gate', jobs: ['unit'] },
  { gate: 'postgres-real', match: /PostgreSQL Real Suites/i, wf: 'PostgreSQL Real Tests', jobs: ['postgres-real-tests'] },
  { gate: 'contracts', match: /Contract/i, wf: 'CI Quality Gate', jobs: ['unit'] },
  { gate: 'migrations-fresh', match: /Migration check/i, wf: 'CI Quality Gate', jobs: ['migration-check'] },
  { gate: 'migrations-upgrade', match: /Migration check/i, wf: 'CI Quality Gate', jobs: ['migration-check'] },
  { gate: 'build', match: /Build/i, wf: 'CI Quality Gate', jobs: ['build'] },
  { gate: 'e2e-browser', match: /Playwright|E2E/i, wf: 'Smoke E2E', jobs: ['smoke-e2e'] },
  { gate: 'dr-e2e', match: /DR end-to-end/i, wf: 'DR End-to-End (backup/restore proof)', jobs: ['dr-e2e'] },
  { gate: 'codeql', match: /CodeQL/i, wf: 'Supply Chain Security', jobs: ['codeql'] },
  { gate: 'gitleaks', match: /Gitleaks|Secret scan/i, wf: 'Supply Chain Security', jobs: ['gitleaks'] },
  { gate: 'trivy', match: /Container scan/i, wf: 'Supply Chain Security', jobs: ['trivy'] },
  { gate: 'dependency-review', match: /Dependency review/i, wf: 'Supply Chain Security', jobs: ['dependency-review'] },
  { gate: 'sbom', match: /SBOM/i, wf: 'Supply Chain Security', jobs: ['sbom'] },
  { gate: 'critical-security-audit', match: /audit/i, wf: 'Triple AAA Gate', jobs: ['security-gate'] },
  { gate: 'coverage', match: /Coverage|coverage/i, wf: 'CI Quality Gate', jobs: ['lint-typecheck'] },
];

const runPayload = gh(`/repos/ricardoakinaga-dev/cvg-connect-desk/actions/runs?head_sha=${SHA}&per_page=100`);
const runs = Array.isArray(runPayload) ? runPayload : (runPayload.workflow_runs || []);
const byWorkflow = new Map();
for (const run of runs) {
  const key = run.name || run.workflow_name;
  if (!byWorkflow.has(key)) byWorkflow.set(key, []);
  byWorkflow.get(key).push(run);
}
for (const workflowRuns of byWorkflow.values()) {
  workflowRuns.sort((a, b) => (b.run_number || 0) - (a.run_number || 0));
}

const gates = {};
let failures = 0;
let missing = 0;
const perJob = {};

for (const req of REQUIRED) {
  const wfRuns = byWorkflow.get(req.wf) || [];
  const latest = wfRuns[0]; // hmm: múltiplos; usa o mais recente por run_number
  if (!latest) {
    gates[req.gate] = { status: 'NOT_VERIFIED', reason: `workflow não executou no SHA (${req.wf})` };
    missing += 1;
    continue;
  }
  const jobPayload = gh(`/repos/ricardoakinaga-dev/cvg-connect-desk/actions/runs/${latest.id}/jobs?per_page=100`);
  const jobs = Array.isArray(jobPayload) ? jobPayload : (jobPayload.jobs || []);
  const relevant = jobs.filter((j) => req.match.test(`${j.name} ${j.labels?.join(' ')}`));
  if (relevant.length === 0) {
    gates[req.gate] = { status: 'NOT_VERIFIED', reason: `job não encontrado (${req.wf} / ${req.match})` };
    missing += 1;
    continue;
  }
  // Todos os jobs relevantes precisam sucesso; classes (e.g. codeql) exigem cada job.
  const ok = relevant.every((j) => j.conclusion === 'success');
  gates[req.gate] = ok ? { status: 'PASS' } : { status: 'FAIL', reason: relevant.map((j) => `${j.name}:${j.conclusion}`).join(',') };
  if (!ok) failures += 1;
  perJob[req.gate] = { runId: latest.id, jobs: relevant.map((j) => j.conclusion) };
}

let state;
if (failures > 0) state = 'FAILED';
else if (missing > 0) state = 'CONDITIONAL'; // núcleo ok, evidência incompleta
else state = 'VERIFIED_CANDIDATE'; // todos os required checks no SHA

const summary = Object.entries(gates)
  .map(([k, v]) => `${k}=${v.status}`)
  .join(' ');

const report = {
  repository: 'ricardoakinaga-dev/cvg-connect-desk',
  branch: 'main',
  commit: SHA,
  timestamp: new Date().toISOString(),
  gateMode: 'github-actions-aggregator',
  gates,
  promotionState: state,
  requiredChecks: REQUIRED.map((r) => r.gate),
  perJob,
  honesty: 'Nenhum PASS sem evidência; ausência de evidência = NOT_VERIFIED (CONDITIONAL). TRIPLE_AAA_CERTIFIED exige tag manual.',
};

writeFileSync(join(artifactsDir, 'triple-aaa-report.json'), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(
  join(artifactsDir, 'triple-aaa-report.md'),
  `# Triple AAA Certification Report — ${SHA.slice(0, 8)}\n\n- State: **${state}**\n- Timestamp: ${report.timestamp}\n\n| Gate | Status |\n|---|---|\n${Object.entries(gates).map(([k, v]) => `| ${k} | ${v.status} |`).join('\n')}\n`,
);

console.log(`STATE=${state}`);
console.log(`SUMMARY=${summary}`);

// Outputs para o workflow.
writeFileSync(process.env.GITHUB_OUTPUT || '/dev/null', `state=${state}\nsummary=${summary}\n`, { flag: 'a' });
