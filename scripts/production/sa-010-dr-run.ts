// SA-010/AC3 — executa o DR E2E real (backup→destroy→restore→verificação) no
// cluster PostgreSQL EXCLUSIVO do run (SA-003), com administração por URL
// explícita e evidência estruturada no diretório da tarefa.
//
// Uso: pnpm exec tsx scripts/production/sa-010-dr-run.ts
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getRunContext } from '../../e2e/support/aaa/run-context.ts';
import { provisionIsolatedEnv, teardownIsolatedEnv } from '../../e2e/support/aaa/isolated-env.ts';
import { findPgBinaries, runtimeEnvFor } from '../../e2e/support/aaa/pg.ts';

const ctx = getRunContext();
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const evidenceDir = process.env.CVG_RUNTIME_DIR
  ? join(process.env.CVG_RUNTIME_DIR, 'sa-010')
  : join(ctx.repoRoot, 'docs', 'programa-triplo-aaa-2026-09-14', 'evidencias', 'SA-010');
const backupDir = join(evidenceDir, 'artifacts');
mkdirSync(backupDir, { recursive: true });

const report: Record<string, unknown> = {
  runId: ctx.runId,
  revision,
  databaseUrl: ctx.databaseUrl,
  startedAt: new Date().toISOString(),
  result: 'FAIL',
  failures: [] as string[],
};

async function main() {
let provisioned = false;
try {
  const env = await provisionIsolatedEnv(ctx);
  provisioned = true;
  report.provisioned = { databaseName: env.databaseName, databasePort: env.databasePort, marker: env.marker };

  const binaries = findPgBinaries();
  report.pgBinDir = binaries.binDir;
  const adminUrl = `postgresql://cvg_aaa@127.0.0.1:${ctx.ports.postgres}/postgres`;

  const run = spawnSync('bash', ['infra/scripts/dr-e2e.sh'], {
    cwd: ctx.repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      ...runtimeEnvFor(binaries.binDir),
      PATH: `${binaries.binDir}:${process.env.PATH}`,
      DR_POSTGRES_URL: adminUrl,
      DR_BACKUP_DIR: backupDir,
      DR_APP_PORT: String(ctx.ports.api),
      DR_SOURCE_REVISION: revision,
      DATABASE_URL: ctx.databaseUrl,
    },
  });
  report.exitStatus = run.status;
  report.log = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.slice(-8000);

  if (run.status === 0) {
    // Pega o artefato MAIS RECENTE do diretório (execuções anteriores ficam
    // preservadas como histórico e não podem mascarar a desse run).
    const files = readdirSync(backupDir)
      .filter((file) => /\.(result|verify)\.json$/.test(file))
      .map((file) => ({ file, mtime: statSync(join(backupDir, file)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((entry) => entry.file);
    const resultFile = files.find((file) => file.endsWith('.result.json'));
    const verifyFile = files.find((file) => file.endsWith('.verify.json'));
    report.artifacts = { resultFile, verifyFile };
    if (resultFile) report.drResult = JSON.parse(readFileSync(join(backupDir, resultFile), 'utf8'));
    if (verifyFile) {
      const verify = JSON.parse(readFileSync(join(backupDir, verifyFile), 'utf8'));
      report.verify = { result: verify.result, totalChecks: verify.totalChecks, failedChecks: verify.failedChecks };
      if (verify.result !== 'PASS') (report.failures as string[]).push('verificador estrito reprovou');
    } else {
      (report.failures as string[]).push('relatório do verificador ausente');
    }
  } else {
    (report.failures as string[]).push(`dr-e2e.sh exit ${run.status}`);
  }
} catch (error) {
  (report.failures as string[]).push(`fatal: ${String(error)}`);
} finally {
  if (provisioned) report.teardown = teardownIsolatedEnv(ctx, { stopServices: true, dropDatabase: true });
  report.finishedAt = new Date().toISOString();
  report.result = (report.failures as string[]).length === 0 ? 'PASS' : 'FAIL';
  writeFileSync(join(evidenceDir, 'sa-010-dr-run.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[sa010] ${report.result}`);
  process.exit(report.result === 'PASS' ? 0 : 1);
}
}

void main();
