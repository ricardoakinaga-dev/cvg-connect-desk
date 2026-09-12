#!/usr/bin/env node
/**
 * Triple AAA master gate (Final, §19).
 * Orquestra gates locais e gera artifacts/triple-aaa-report.json.
 * Honestidade mecânica: sem evidência externa (CI), o teto é VERIFIED_CANDIDATE.
 * TRIPLE_AAA_CERTIFIED só com --with-external-evidence + arquivos em artifacts/ci-evidence/.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifactsDir = join(root, 'artifacts');
mkdirSync(artifactsDir, { recursive: true });

const gates = {};
function run(name, command, env = {}) {
  const started = Date.now();
  try {
    execSync(command, {
      cwd: root,
      stdio: 'pipe',
      timeout: 1500000,
      env: { ...process.env, ...env },
    });
    gates[name] = { status: 'PASS', durationMs: Date.now() - started };
    console.log(`[gate] ${name}: PASS (${Date.now() - started}ms)`);
  } catch (error) {
    const output = [error.stdout?.toString(), error.stderr?.toString()].filter(Boolean).join('\n').slice(-2000);
    gates[name] = { status: 'FAIL', durationMs: Date.now() - started, output };
    console.log(`[gate] ${name}: FAIL`);
  }
}

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/connect_desk_db';
const DB_ENV = { DATABASE_URL };

run('install', 'pnpm install --frozen-lockfile');
run('lint', 'pnpm --filter @cvg/desk-web exec eslint . --max-warnings 100');
run('typecheck', 'pnpm --filter @cvg/desk-web exec tsc --noEmit -p tsconfig.json');
// Concorrência limitada: 31 pacotes em paralelo esgotam conexões do PG/Redis
// e derrubam workers (falsos ELIFECYCLE). CI runners têm 2-4 cores de qq forma.
run('unit', 'pnpm exec turbo run test --force --concurrency=2', DB_ENV);
run('postgres-real', 'pnpm test:postgres-real', DB_ENV);
run('migration-check', 'pnpm --filter @cvg/database db:check', {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/postgres',
});
run('build', 'pnpm --filter @cvg/desk-web build');

// Security local: 0 critical.
try {
  execSync('pnpm audit --audit-level=critical', { cwd: root, stdio: 'pipe', timeout: 300000 });
  gates['security-audit-critical'] = { status: 'PASS' };
  console.log('[gate] security-audit-critical: PASS');
} catch {
  gates['security-audit-critical'] = { status: 'FAIL' };
  console.log('[gate] security-audit-critical: FAIL');
}

// Evidência externa (CI): só conta se os arquivos existirem.
const externalMarkers = {
  codeql: 'artifacts/ci-evidence/codeql.json',
  gitleaks: 'artifacts/ci-evidence/gitleaks.json',
  trivy: 'artifacts/ci-evidence/trivy.json',
  sbom: 'artifacts/ci-evidence/sbom.json',
  e2e: 'artifacts/ci-evidence/e2e.json',
  dr: 'artifacts/ci-evidence/dr.json',
};
const withExternal = process.argv.includes('--with-external-evidence');
for (const [name, rel] of Object.entries(externalMarkers)) {
  const path = join(root, rel);
  if (withExternal && existsSync(path)) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8'));
      gates[`external-${name}`] = { status: data.status === 'PASS' ? 'PASS' : 'FAIL' };
    } catch {
      gates[`external-${name}`] = { status: 'FAIL' };
    }
  } else {
    gates[`external-${name}`] = { status: 'NOT_RUN' };
  }
}

const localNames = ['install', 'lint', 'typecheck', 'unit', 'postgres-real', 'migration-check', 'build', 'security-audit-critical'];
const localPass = localNames.every((n) => gates[n]?.status === 'PASS');
const externalNames = Object.keys(externalMarkers).map((n) => `external-${n}`);
const externalPass = externalNames.every((n) => gates[n]?.status === 'PASS');

const commit = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
let final = 'FAILED';
let aaa = { a1: 'NOT VERIFIED', a2: 'NOT VERIFIED', a3: 'NOT VERIFIED' };
if (localPass) {
  // AAA-1 exige gates locais verdes (arquitetura/correção coberto por eles).
  // AAA-2/AAA-3 ficam CONDITIONAL até evidência externa (CI) — ver certificação.
  aaa.a1 = 'VERIFIED';
  aaa.a2 = 'CONDITIONAL';
  aaa.a3 = 'CONDITIONAL';
  final = 'VERIFIED_CANDIDATE';
}
if (localPass && withExternal && externalPass) {
  aaa = { a1: 'VERIFIED', a2: 'VERIFIED', a3: 'VERIFIED' };
  final = 'TRIPLE_AAA_CERTIFIED';
}

const report = {
  commit,
  timestamp: new Date().toISOString(),
  gates,
  aaa1: aaa.a1,
  aaa2: aaa.a2,
  aaa3: aaa.a3,
  final,
};
writeFileSync(join(artifactsDir, 'triple-aaa-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nFINAL: ${final}`);
console.log(`AAA-1: ${aaa.a1} · AAA-2: ${aaa.a2} · AAA-3: ${aaa.a3}`);
process.exitCode = localPass ? 0 : 1;
