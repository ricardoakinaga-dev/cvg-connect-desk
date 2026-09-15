// PROD-02 correção M1/M2/L2 — reprodução executável no candidato.
// Uso: node docs/producao-2026-09-13/evidencias/prod-02/repro-correcao.mjs
// Sai 0 apenas se M1/M2/L2 estiverem corrigidos; L5 (fora do escopo de escrita
// desta correção) é apenas registrado.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_CHECKS,
  computeSourceHash,
  evaluateGate,
  resolveCandidate,
} from '../../../../scripts/production/evidence-gate.mjs';
import { main as aggregatorMain } from '../../../../.github/scripts/certification-aggregator.mjs';

const checks = [];
const log = (line) => process.stdout.write(`${line}\n`);
const expect = (name, ok, detail) => {
  checks.push({ name, ok });
  log(`${ok ? 'OK  ' : 'FALHA'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// --- M1: untracked entra no sourceSha256 ---
const repo = mkdtempSync(join(tmpdir(), 'prod02-m1-'));
const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
git(['init', '-q']);
writeFileSync(join(repo, 'tracked.js'), 'export const a = 1;\n');
git(['add', 'tracked.js']);
git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
writeFileSync(join(repo, 'untracked.js'), 'export const b = 1;\n');
const before = computeSourceHash(repo);
writeFileSync(join(repo, 'untracked.js'), 'export const b = 2;\n');
const after = computeSourceHash(repo);
log(`M1: hash antes  = ${before.sourceSha256} (${before.files} arquivos)`);
log(`M1: hash depois = ${after.sourceSha256} (${after.files} arquivos)`);
expect('M1 untracked alterado muda sourceSha256', before.sourceSha256 !== after.sourceSha256);
rmSync(repo, { recursive: true, force: true });

// --- M2: artefato derivado velho e sem lock/source ---
const root = mkdtempSync(join(tmpdir(), 'prod02-m2-'));
mkdirSync(join(root, 'src'), { recursive: true });
mkdirSync(join(root, 'evidence', 'ci'), { recursive: true });
writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\nimporters: {}\n');
writeFileSync(join(root, 'src', 'app.js'), 'export const x = 1;\n');
const candidate = resolveCandidate({ root, commit: 'c'.repeat(40) });
writeFileSync(
  join(root, 'evidence', 'ci', 'codeql.json'),
  `${JSON.stringify({ commit: candidate.commit, result: 'PASS', generatedAt: '2000-01-01T00:00:00.000Z' }, null, 2)}\n`,
);
const check = {
  id: 'external-codeql',
  required: true,
  external: true,
  scope: 'CodeQL sintético',
  evidence: { kind: 'json-result', file: 'ci/codeql.json' },
};
const report = evaluateGate({ checks: [check], evidenceDir: join(root, 'evidence'), candidate, withExternal: true });
log(`M2: estado do gate com payload 2000/PASS/sem lock/source = ${report.state} (${report.gates['external-codeql'].status})`);
log(`M2: reasons = ${JSON.stringify(report.gates['external-codeql'].reasons)}`);
expect('M2 payload velho/sem identidade é rejeitado (nunca PASS)', report.state !== 'VERIFIED_CANDIDATE');
rmSync(root, { recursive: true, force: true });

// --- L2: defaults de banco exigem run isolado ---
for (const id of ['unit', 'postgres-real', 'migration-check']) {
  const dbCheck = DEFAULT_CHECKS.find((entry) => entry.id === id);
  log(`L2: ${id} DATABASE_URL fixado = ${dbCheck.env?.DATABASE_URL ?? 'ausente'}`);
  expect(`L2 ${id} não fixa banco do host`, dbCheck.env?.DATABASE_URL === undefined);
}

// --- L5 (opcional, fora do escopo desta correção): EVENT inválido -> push ---
const artifactsDir = mkdtempSync(join(tmpdir(), 'prod02-l5-'));
const realConsoleLog = console.log;
console.log = () => {};
let bogus;
try {
  bogus = aggregatorMain(
    { SHA: 'a'.repeat(40), EVENT: 'evento-invalido', AGGREGATOR_ARTIFACTS_DIR: artifactsDir, GITHUB_OUTPUT: join(artifactsDir, 'out.txt') },
    {
      runsPayload: { total_count: 0, workflow_runs: [] },
      getJobsPayload: () => ({ total_count: 0, jobs: [] }),
      getImageEvidence: () => null,
    },
  );
} finally {
  console.log = realConsoleLog;
}
log(`L5: EVENT inválido -> report.event=${bogus.event} requestedEvent=${bogus.requestedEvent} (sem erro; corrigir em PROD-03)`);
rmSync(artifactsDir, { recursive: true, force: true });

const failed = checks.filter((entry) => !entry.ok);
log(`\nRESULTADO: ${checks.length - failed.length}/${checks.length} verificações M1/M2/L2 OK`);
process.exitCode = failed.length === 0 ? 0 : 1;
