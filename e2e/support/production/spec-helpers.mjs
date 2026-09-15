// Helpers de identidade do run para specs de produção.
// Carregam o harness AAA (TS) via import dinâmico sob o loader tsx.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

export async function runIdentity() {
  process.env.CVG_PROGRAM_DIR = process.env.CVG_PROGRAM_DIR
    || resolve(REPO_ROOT, 'docs', 'producao-2026-09-13');
  const runContext = await import('../aaa/run-context.ts');
  const pg = await import('../aaa/pg.ts');
  const ctx = runContext.getRunContext();
  const markerRow = pg.queryOne(
    ctx,
    "SELECT run_id || '|' || source_revision FROM aaa_environment_marker WHERE run_id = '" + ctx.runId.replace(/'/g, "''") + "'",
  );
  const [markerRunId, markerRevision] = markerRow.split('|');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  return {
    runId: ctx.runId,
    databaseName: ctx.databaseName,
    ports: ctx.ports,
    markerRunId,
    markerRevision,
    head,
  };
}
