#!/usr/bin/env node
/**
 * Certification aggregator (§3–4, §28).
 * Consulta a API de checks do SHA e calcula o estado REAL de promoção.
 * Required checks (por nome de workflow/job abaixo) — ausência = NOT VERIFIED.
 *
 * Por que via API: GitHub Actions não expõe estado cross-workflow por `needs`;
 * este agregador é a fonte única e inequívoca para o SHA.
 *
 * A API `/actions/runs` e `/actions/runs/:id/jobs` devolve objetos
 * `{ total_count, workflow_runs | jobs }` (não arrays). `asArray()` normaliza as
 * duas formas e protege contra respostas malformadas (o teste de fixture em
 * `certification-aggregator.test.mjs` cobre explicitamente o bug do payload).
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
export const REPOSITORY = 'ricardoakinaga-dev/cvg-connect-desk';

// Required gates nomeados em cada workflow. Job name prefix: <workflow> / <job>.
export const REQUIRED = [
  { gate: 'lint', match: /Lint \(real/i, wf: 'CI Quality Gate', jobs: ['lint'] },
  { gate: 'typecheck', match: /Typecheck \(real/i, wf: 'CI Quality Gate', jobs: ['typecheck'] },
  { gate: 'unit', match: /Unit tests/i, wf: 'CI Quality Gate', jobs: ['unit'] },
  { gate: 'integration', match: /Integration tests/i, wf: 'CI Quality Gate', jobs: ['integration'] },
  { gate: 'contracts', match: /Contract tests/i, wf: 'CI Quality Gate', jobs: ['contracts'] },
  { gate: 'coverage', match: /Coverage \(shared/i, wf: 'CI Quality Gate', jobs: ['coverage'] },
  { gate: 'postgres-real', match: /PostgreSQL Real Suites/i, wf: 'PostgreSQL Real Tests', jobs: ['postgres-real-tests'] },
  { gate: 'migrations-fresh', match: /Migration check/i, wf: 'CI Quality Gate', jobs: ['migration-check'] },
  { gate: 'migrations-upgrade', match: /Migration check/i, wf: 'CI Quality Gate', jobs: ['migration-check'] },
  { gate: 'build', match: /^Build \(real/i, wf: 'CI Quality Gate', jobs: ['build'] },
  { gate: 'e2e-browser', match: /Smoke E2E/i, wf: 'Smoke E2E', jobs: ['smoke-e2e'] },
  { gate: 'dr-e2e', match: /Backup, destroy, restore, validate, smoke/i, wf: 'DR End-to-End (backup/restore proof)', jobs: ['dr-e2e'] },
  { gate: 'codeql', match: /CodeQL/i, wf: 'Supply Chain Security', jobs: ['codeql'] },
  { gate: 'gitleaks', match: /Gitleaks|Secret scan/i, wf: 'Supply Chain Security', jobs: ['gitleaks'] },
  { gate: 'trivy', match: /Container scan/i, wf: 'Supply Chain Security', jobs: ['trivy'] },
  { gate: 'dependency-review', match: /Dependency review/i, wf: 'Supply Chain Security', jobs: ['dependency-review'] },
  { gate: 'sbom', match: /SBOM/i, wf: 'Supply Chain Security', jobs: ['sbom'] },
  { gate: 'security-audit', match: /Security gate/i, wf: 'Triple AAA Gate', jobs: ['security-gate'] },
];

/** Normaliza respostas de listagem da API (`{ key: [...] }`, array puro ou lixo). */
export function asArray(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray(payload[key])) return payload[key];
  return [];
}

/** Escolhe o run mais recente por run_number (fallback created_at). */
export function pickLatest(runs) {
  return runs
    .slice()
    .sort(
      (a, b) =>
        (Number(b?.run_number) || 0) - (Number(a?.run_number) || 0) ||
        String(b?.created_at || '').localeCompare(String(a?.created_at || ''))
    )[0];
}

/**
 * Avalia os required gates a partir de payloads crus da API.
 * @param {typeof REQUIRED} required
 * @param {{ runsPayload: unknown, getJobsPayload: (runId: number|string) => unknown }} io
 */
export function evaluateRequired(required, { runsPayload, getJobsPayload }) {
  const byWorkflow = new Map();
  for (const run of asArray(runsPayload, 'workflow_runs')) {
    const key = run?.name || run?.workflow_name;
    if (!key) continue;
    if (!byWorkflow.has(key)) byWorkflow.set(key, []);
    byWorkflow.get(key).push(run);
  }

  const gates = {};
  const perJob = {};
  let failures = 0;
  let missing = 0;

  for (const req of required) {
    const latest = pickLatest(byWorkflow.get(req.wf) || []);
    if (!latest) {
      gates[req.gate] = { status: 'NOT_VERIFIED', reason: `workflow não executou no SHA (${req.wf})` };
      missing += 1;
      continue;
    }
    const relevant = asArray(getJobsPayload(latest.id), 'jobs').filter((j) =>
      req.match.test(`${j?.name ?? ''} ${(j?.labels ?? []).join(' ')}`)
    );
    if (relevant.length === 0) {
      gates[req.gate] = { status: 'NOT_VERIFIED', reason: `job não encontrado (${req.wf} / ${req.match})` };
      missing += 1;
      continue;
    }
    const ok = relevant.every((j) => j.conclusion === 'success');
    gates[req.gate] = ok
      ? { status: 'PASS' }
      : { status: 'FAIL', reason: relevant.map((j) => `${j.name}:${j.conclusion}`).join(',') };
    if (!ok) failures += 1;
    perJob[req.gate] = { runId: latest.id, jobs: relevant.map((j) => j.conclusion) };
  }

  const state = failures > 0 ? 'FAILED' : missing > 0 ? 'CONDITIONAL' : 'VERIFIED_CANDIDATE';
  const summary = Object.entries(gates)
    .map(([k, v]) => `${k}=${v.status}`)
    .join(' ');
  return { gates, failures, missing, perJob, state, summary };
}

function ghApiJson(endpoint) {
  try {
    return JSON.parse(execSync(`gh api ${endpoint} --jq .`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (error) {
    console.error(`[aggregator] gh api falhou (${endpoint}):`, error.stderr?.toString().slice(0, 300));
    return null;
  }
}

export function main(env = process.env) {
  const sha = env.SHA || execSync('git rev-parse HEAD').toString().trim();
  const artifactsDir = env.AGGREGATOR_ARTIFACTS_DIR || join(root, 'artifacts');
  mkdirSync(artifactsDir, { recursive: true });

  const runsPayload = ghApiJson(`/repos/${REPOSITORY}/actions/runs?head_sha=${sha}&per_page=100`);
  const getJobsPayload = (runId) => ghApiJson(`/repos/${REPOSITORY}/actions/runs/${runId}/jobs`);

  const { gates, perJob, state, summary } = evaluateRequired(REQUIRED, { runsPayload, getJobsPayload });

  const report = {
    repository: REPOSITORY,
    branch: 'main',
    commit: sha,
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
    `# Triple AAA Certification Report — ${sha.slice(0, 8)}\n\n- State: **${state}**\n- Timestamp: ${report.timestamp}\n\n| Gate | Status |\n|---|---|\n${Object.entries(gates).map(([k, v]) => `| ${k} | ${v.status} |`).join('\n')}\n`
  );

  console.log(`STATE=${state}`);
  console.log(`SUMMARY=${summary}`);
  writeFileSync(env.GITHUB_OUTPUT || '/dev/null', `state=${state}\nsummary=${summary}\n`, { flag: 'a' });
  return report;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) main();
