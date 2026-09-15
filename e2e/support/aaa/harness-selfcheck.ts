import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { assertIsolatedDatabaseUrl, IsolationError } from './pg.ts';
import { provisionIsolatedEnv } from './isolated-env.ts';
import { ensureEvidenceDir, getRunContext, type RunContext } from './run-context.ts';

interface GuardCase {
  name: string;
  url: string;
  expectCode: string | null;
  expected: { port?: number; databaseName?: string };
}

interface SpecResult {
  title: string;
  ok: boolean;
  statuses: string[];
}

interface PlaywrightReport {
  stats?: { expected?: number; skipped?: number; unexpected?: number; flaky?: number };
  suites?: unknown[];
}

function collectSpecs(suites: unknown[], acc: SpecResult[] = []): SpecResult[] {
  if (!Array.isArray(suites)) {
    return acc;
  }
  for (const node of suites as Array<Record<string, unknown>>) {
    if (Array.isArray(node.specs)) {
      for (const spec of node.specs as Array<Record<string, unknown>>) {
        const tests = Array.isArray(spec.tests) ? spec.tests as Array<Record<string, unknown>> : [];
        const statuses = tests.flatMap((test) => {
          const results = Array.isArray(test.results) ? test.results as Array<Record<string, unknown>> : [];
          return results.map((result) => String(result.status));
        });
        acc.push({
          title: String(spec.title ?? ''),
          ok: spec.ok === true,
          statuses,
        });
      }
    }
    if (Array.isArray(node.suites)) {
      collectSpecs(node.suites, acc);
    }
  }
  return acc;
}

function readReport(path: string): { report: PlaywrightReport; specs: SpecResult[] } {
  const raw = readFileSync(path, 'utf8');
  const report = JSON.parse(raw) as PlaywrightReport;
  return { report, specs: collectSpecs(report.suites ?? []) };
}

async function waitForHttp(url: string, timeoutMs = 240_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw lastError instanceof Error ? lastError : new Error(`timeout aguardando ${url}`);
}

function runPlaywright(ctx: RunContext, project: 'aaa' | 'canary', reportPath: string, extraEnv: NodeJS.ProcessEnv) {
  const result = spawnSync(
    'pnpm',
    ['exec', 'playwright', 'test', '--config', 'playwright.aaa.config.ts', '--project', project],
    {
      cwd: ctx.repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        AAA_RUN_ID: ctx.runId,
        AAA_RUN_ROOT: ctx.runRoot,
        AAA_PLAYWRIGHT_JSON: reportPath,
        ...extraEnv,
      },
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  writeFileSync(reportPath.replace(/\.json$/, '.stdout.log'), `${result.stdout}\n${result.stderr}`);
  return result;
}

async function main() {
  const ctx = getRunContext();
  const harnessDir = ensureEvidenceDir(ctx, 'harness');
  const checks: Array<Record<string, unknown>> = [];
  const failures: string[] = [];

  console.log(`[selfcheck] run=${ctx.runId} root=${ctx.runRoot}`);

  // 1) Guarda de isolamento: rejeita banco sem marcador e aceita o banco do run.
  const guardCases: GuardCase[] = [
    {
      name: 'smoke_db_recusado',
      url: 'postgresql://connect_desk:root@localhost:55432/connect_desk_db',
      expectCode: 'DB_URL_NO_TEST_MARKER',
      expected: {},
    },
    {
      name: 'host_remoto_recusado',
      url: 'postgresql://cvg_aaa@db.example.com:56432/cvg_aaa_remote',
      expectCode: 'DB_URL_REMOTE_HOST',
      expected: {},
    },
    {
      name: 'porta_divergente_recusada',
      url: `postgresql://cvg_aaa@127.0.0.1:5432/${ctx.databaseName}`,
      expectCode: 'DB_URL_WRONG_PORT',
      expected: { port: ctx.ports.postgres },
    },
    {
      name: 'banco_sem_marcador_recusado',
      url: 'postgresql://cvg_aaa@127.0.0.1:56432/evolution',
      expectCode: 'DB_URL_NO_TEST_MARKER',
      expected: { databaseName: ctx.databaseName },
    },
    {
      name: 'banco_do_run_aceito',
      url: ctx.databaseUrl,
      expectCode: null,
      expected: { port: ctx.ports.postgres, databaseName: ctx.databaseName },
    },
  ];

  for (const guardCase of guardCases) {
    try {
      assertIsolatedDatabaseUrl(guardCase.url, guardCase.expected);
      checks.push({ name: guardCase.name, result: guardCase.expectCode === null ? 'passed' : 'failed', code: null });
      if (guardCase.expectCode !== null) {
        failures.push(`${guardCase.name}: esperava rejeicao ${guardCase.expectCode}, mas foi aceito.`);
      }
    } catch (error) {
      const code = error instanceof IsolationError ? error.code : 'UNEXPECTED';
      checks.push({ name: guardCase.name, result: code === guardCase.expectCode ? 'passed' : 'failed', code });
      if (code !== guardCase.expectCode) {
        failures.push(`${guardCase.name}: esperava ${guardCase.expectCode}, recebeu ${code}.`);
      }
    }
  }

  // 2) Provisionamento com marcador de teste.
  const isolated = await provisionIsolatedEnv(ctx);
  checks.push({
    name: 'marcador_de_teste',
    result: isolated.marker.runId === ctx.runId ? 'passed' : 'failed',
    marker: isolated.marker,
  });
  if (isolated.marker.runId !== ctx.runId) {
    failures.push('marcador_de_teste: run id divergente.');
  }

  // 3) Boot da stack isolada (fica viva para os dois runs Playwright).
  const stackLog = join(harnessDir, 'stack.log');
  mkdirSync(join(ctx.runRoot, 'stack'), { recursive: true });
  const stack: ChildProcess = spawn('pnpm', ['exec', 'tsx', 'e2e/support/aaa/start-aaa-stack.ts'], {
    cwd: ctx.repoRoot,
    detached: true,
    env: {
      ...process.env,
      AAA_RUN_ID: ctx.runId,
      AAA_RUN_ROOT: ctx.runRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stackChunks: Buffer[] = [];
  stack.stdout?.on('data', (chunk: Buffer) => stackChunks.push(chunk));
  stack.stderr?.on('data', (chunk: Buffer) => stackChunks.push(chunk));

  const webUrl = `http://127.0.0.1:${ctx.ports.web}`;
  try {
    await waitForHttp(`${webUrl}/login`);
    checks.push({ name: 'stack_isolada_pronta', result: 'passed', webUrl });
  } catch (error) {
    checks.push({ name: 'stack_isolada_pronta', result: 'failed', error: String(error) });
    failures.push(`stack_isolada_pronta: ${String(error)}`);
  } finally {
    writeFileSync(stackLog, Buffer.concat(stackChunks).toString('utf8'));
  }

  // 4) Controle negativo: harness deve rejeitar um caso comprovadamente ruim.
  const canaryReport = join(harnessDir, 'canary-report.json');
  const canary = runPlaywright(ctx, 'canary', canaryReport, { AAA_CANARY_MODE: 'fail' });
  let canaryOk = false;
  try {
    const { report, specs } = readReport(canaryReport);
    const stats = report.stats ?? {};
    const failedSpecs = specs.filter((spec) => !spec.ok && spec.title.includes('negative-control'));
    const skipped = Number(stats.skipped ?? 0);
    canaryOk = canary.status !== 0 && failedSpecs.length >= 1 && skipped === 0;
    checks.push({
      name: 'controle_negativo_rejeitado',
      result: canaryOk ? 'passed' : 'failed',
      exit: canary.status,
      stats,
      failedSpecs,
    });
    if (!canaryOk) {
      failures.push(
        `controle_negativo_rejeitado: exit=${canary.status} skipped=${skipped} failedSpecs=${failedSpecs.length}`,
      );
    }
  } catch (error) {
    checks.push({ name: 'controle_negativo_rejeitado', result: 'failed', error: String(error) });
    failures.push(`controle_negativo_rejeitado: ${String(error)}`);
  }

  // 5) Run de sanidade deve passar sem skip.
  const sanityReport = join(harnessDir, 'sanity-report.json');
  const sanity = runPlaywright(ctx, 'aaa', sanityReport, {});
  let sanityOk = false;
  try {
    const { report, specs } = readReport(sanityReport);
    const stats = report.stats ?? {};
    const skipped = Number(stats.skipped ?? 0);
    const expected = Number(stats.expected ?? 0);
    const unexpected = Number(stats.unexpected ?? 0);
    sanityOk = sanity.status === 0 && expected >= 3 && unexpected === 0 && skipped === 0;
    checks.push({ name: 'sanidade_verde', result: sanityOk ? 'passed' : 'failed', exit: sanity.status, stats, specs });
    if (!sanityOk) {
      failures.push(`sanidade_verde: exit=${sanity.status} expected=${expected} unexpected=${unexpected} skipped=${skipped}`);
    }
  } catch (error) {
    checks.push({ name: 'sanidade_verde', result: 'failed', error: String(error) });
    failures.push(`sanidade_verde: ${String(error)}`);
  }

  // 6) Encerrar stack (DB/Redis permanecem para inspeção).
  if (stack.pid && !stack.killed) {
    try {
      process.kill(-stack.pid, 'SIGTERM');
    } catch {
      // grupo ja encerrado
    }
  }

  const summary = {
    runId: ctx.runId,
    checkedAt: new Date().toISOString(),
    result: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
    checks,
    isolatedEnv: {
      databaseUrl: ctx.databaseUrl,
      redisUrl: ctx.redisUrl,
      marker: isolated.marker,
    },
  };

  writeFileSync(join(harnessDir, 'selfcheck.json'), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(
    join(harnessDir, 'selfcheck.txt'),
    [
      `AAA-00 harness selfcheck — run ${ctx.runId}`,
      `result: ${summary.result}`,
      ...checks.map((check) => `- ${String(check.name)}: ${String(check.result)}`),
      ...(failures.length ? ['failures:', ...failures.map((failure) => `  ! ${failure}`)] : []),
      '',
    ].join('\n'),
  );

  console.log(`[selfcheck] ${summary.result}`);
  void teardownIsolatedEnv;
  void ensureRunDirs;
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('[selfcheck] falha fatal:', error);
  process.exit(1);
});
