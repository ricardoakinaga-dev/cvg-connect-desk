#!/usr/bin/env node
/**
 * Fixture-driven tests for the certification aggregator.
 *
 * Motivated by a real defect: the GitHub API returns
 * `{ total_count, workflow_runs: [...] }` for `/actions/runs`, but the
 * aggregator iterated the object itself, so aggregation silently produced
 * NOT_VERIFIED for every required gate (string grep could not see this).
 *
 * Run: node .github/scripts/certification-aggregator.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED, asArray, evaluateRequired, pickLatest } from '/home/ricardo/cvg-connect-desk/.github/scripts/certification-aggregator.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const workflowsDir = '/home/ricardo/cvg-connect-desk/.github/workflows';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}\n    ${String(error.message).split('\n')[0]}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// 1. Static consistency: every REQUIRED mapping must resolve to a real job name
//    in a real workflow file (no phantom gates).
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
    if (jobName) names.push(jobName[1].trim().replace(/^["']|["']$/g, ''));
  }
  return names;
}

const workflowJobs = new Map();
for (const file of readdirSync(workflowsDir).filter((f) => f.endsWith('.yml'))) {
  const text = readFileSync(join(workflowsDir, file), 'utf8');
  const name = workflowName(text);
  if (name) workflowJobs.set(name, jobNames(text));
}

for (const req of REQUIRED) {
  test(`mapping '${req.gate}' -> ${req.wf} / ${req.match}`, () => {
    const jobs = workflowJobs.get(req.wf);
    assert.ok(jobs, `workflow não encontrado: ${req.wf}`);
    assert.ok(
      jobs.some((job) => req.match.test(job)),
      `nenhum job de ${req.wf} casa com ${req.match} (jobs: ${jobs.join(', ')})`
    );
  });
}

// ---------------------------------------------------------------------------
// 2. Fixture-driven verdicts from a canned `/actions/runs` payload.
// ---------------------------------------------------------------------------
const run = (id, name, runNumber = 1) => ({
  id,
  name,
  run_number: runNumber,
  created_at: `2026-09-13T00:00:${String(runNumber).padStart(2, '0')}Z`,
});
const job = (name, conclusion = 'success') => ({ name, conclusion, labels: [] });

const baseRuns = {
  total_count: 6,
  workflow_runs: [
    run(101, 'CI Quality Gate', 3),
    run(102, 'PostgreSQL Real Tests', 2),
    run(103, 'Smoke E2E', 2),
    run(104, 'DR End-to-End (backup/restore proof)', 1),
    run(105, 'Supply Chain Security', 4),
    run(106, 'Triple AAA Gate', 5),
  ],
};
const baseJobs = {
  101: {
    total_count: 8,
    jobs: [
      job('Lint (real, zero errors)'),
      job('Typecheck (real per package)'),
      job('Unit tests (no DB)'),
      job('Integration tests (isolated PG + Redis)'),
      job('Contract tests (messaging-contracts)'),
      job('Migration check (fresh DB)'),
      job('Build (real, macro)'),
      job('Coverage (shared thresholds)'),
    ],
  },
  102: { total_count: 1, jobs: [job('PostgreSQL Real Suites')] },
  103: { total_count: 1, jobs: [job('Smoke E2E Tests')] },
  104: { total_count: 1, jobs: [job('Backup, destroy, restore, validate, smoke')] },
  105: {
    total_count: 5,
    jobs: [
      job('CodeQL (SAST)'),
      job('Secret scan (Gitleaks)'),
      job('Container scan (Trivy)'),
      job('Dependency review'),
      job('SBOM (CycloneDX)'),
    ],
  },
  106: { total_count: 1, jobs: [job('Security gate (audit high + secret scan)')] },
};
const ctx = (runsPayload, jobsById = baseJobs) => ({
  runsPayload,
  getJobsPayload: (runId) => jobsById[runId] ?? { total_count: 0, jobs: [] },
});

test('all required jobs success -> every gate PASS and VERIFIED_CANDIDATE', () => {
  const result = evaluateRequired(REQUIRED, ctx(baseRuns));
  for (const [gate, value] of Object.entries(result.gates)) {
    assert.equal(value.status, 'PASS', `${gate}: ${JSON.stringify(value)}`);
  }
  assert.equal(result.failures, 0);
  assert.equal(result.missing, 0);
  assert.equal(result.state, 'VERIFIED_CANDIDATE');
  assert.equal(Object.keys(result.gates).length, REQUIRED.length);
});

test('one failed required job -> FAILED (and that gate FAIL)', () => {
  const jobs = structuredClone(baseJobs);
  jobs[101].jobs[0] = job('Lint (real, zero errors)', 'failure');
  const result = evaluateRequired(REQUIRED, ctx(baseRuns, jobs));
  assert.equal(result.gates.lint.status, 'FAIL');
  assert.equal(result.state, 'FAILED');
});

test('one skipped required job -> FAILED', () => {
  const jobs = structuredClone(baseJobs);
  jobs[105].jobs[4] = job('SBOM (CycloneDX)', 'skipped');
  const result = evaluateRequired(REQUIRED, ctx(baseRuns, jobs));
  assert.equal(result.gates.sbom.status, 'FAIL');
  assert.equal(result.state, 'FAILED');
});

test('missing workflow run -> CONDITIONAL with NOT_VERIFIED', () => {
  const runs = { total_count: 5, workflow_runs: baseRuns.workflow_runs.filter((r) => r.name !== 'Smoke E2E') };
  const result = evaluateRequired(REQUIRED, ctx(runs));
  assert.equal(result.gates['e2e-browser'].status, 'NOT_VERIFIED');
  assert.equal(result.state, 'CONDITIONAL');
  assert.equal(result.missing, 1);
});

test('missing job in a present run -> NOT_VERIFIED (not a silent PASS)', () => {
  const jobs = structuredClone(baseJobs);
  jobs[101].jobs = jobs[101].jobs.filter((j) => !/Coverage/.test(j.name));
  const result = evaluateRequired(REQUIRED, ctx(baseRuns, jobs));
  assert.equal(result.gates.coverage.status, 'NOT_VERIFIED');
  assert.equal(result.state, 'CONDITIONAL');
});

test('latest run per workflow wins (old failure does not mask new success)', () => {
  const runs = structuredClone(baseRuns);
  runs.workflow_runs.push(run(99, 'CI Quality Gate', 1));
  const jobs = structuredClone(baseJobs);
  jobs[99] = {
    total_count: 8,
    jobs: baseJobs[101].jobs.map((j) => job(j.name, 'failure')),
  };
  const result = evaluateRequired(REQUIRED, ctx(runs, jobs));
  assert.equal(result.gates.lint.status, 'PASS');
  assert.equal(result.state, 'VERIFIED_CANDIDATE');
});

// ---------------------------------------------------------------------------
// 3. Regression: the { workflow_runs } wrapper and malformed payloads.
// ---------------------------------------------------------------------------
test('asArray unwraps workflow_runs (the original defect) and rejects junk', () => {
  assert.deepEqual(asArray({ total_count: 2, workflow_runs: [1, 2] }, 'workflow_runs'), [1, 2]);
  assert.deepEqual(asArray([1, 2], 'workflow_runs'), [1, 2]);
  assert.deepEqual(asArray({ total_count: 0 }, 'workflow_runs'), []);
  assert.deepEqual(asArray({ workflow_runs: 'nope' }, 'workflow_runs'), []);
  assert.deepEqual(asArray(null, 'workflow_runs'), []);
  assert.deepEqual(asArray(undefined, 'workflow_runs'), []);
  assert.deepEqual(asArray('[]', 'workflow_runs'), []);
});

test('runs payload as a raw array (legacy shape) still evaluates', () => {
  const result = evaluateRequired(REQUIRED, ctx(baseRuns.workflow_runs));
  assert.equal(result.state, 'VERIFIED_CANDIDATE');
});

test('malformed runs payload -> all NOT_VERIFIED, no crash', () => {
  for (const payload of [{ total_count: 0 }, null, undefined, 'oops', 42, { workflow_runs: {} }]) {
    const result = evaluateRequired(REQUIRED, ctx(payload));
    assert.equal(result.state, 'CONDITIONAL');
    assert.equal(result.failures, 0);
    assert.equal(result.missing, REQUIRED.length);
  }
});

test('malformed jobs payload -> NOT_VERIFIED for that workflow, no crash', () => {
  const result = evaluateRequired(REQUIRED, {
    runsPayload: baseRuns,
    getJobsPayload: (runId) => (runId === 101 ? null : baseJobs[runId]),
  });
  for (const gate of ['lint', 'typecheck', 'contracts', 'coverage', 'build']) {
    assert.equal(result.gates[gate].status, 'NOT_VERIFIED');
  }
  assert.equal(result.state, 'CONDITIONAL');
});

test('pickLatest prefers higher run_number', () => {
  const latest = pickLatest([run(1, 'x', 2), run(2, 'x', 9), run(3, 'x', 5)]);
  assert.equal(latest.id, 2);
});

console.log(`\n${passed} passed, ${failed} failed`);

const adversarial=structuredClone(baseJobs); adversarial[101].jobs.push(job('Docker build (frozen lockfile, Node 24)', 'failure')); adversarial[101].jobs.push(job('Aggregate gate (per SHA)', 'failure')); console.log('ADVERSARIAL Docker+aggregate failed, staging absent:',evaluateRequired(REQUIRED,ctx(baseRuns,adversarial)).state);const onPush=structuredClone(baseJobs);onPush[105].jobs[3]=job('Dependency review','skipped');console.log('PUSH dependency-review skips per workflow:',evaluateRequired(REQUIRED,ctx(baseRuns,onPush)).state);