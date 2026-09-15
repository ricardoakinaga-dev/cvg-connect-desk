// Runner de suítes de integração contra PostgreSQL/Redis ISOLADOS (harness AAA).
// Uso:
//   node scripts/production/run-integration-isolated.mjs --run-id prod-verify \
//     --worker 12 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/...
// Opções: --keep (não derruba ao final), --skip-migrate, --skip-seed,
//         --with-storage-scanner (MinIO/ClamAV efêmeros do run),
//         --self-test-failure (controla falha de comando e prova cleanup próprio).
// Nunca usa o banco do host; recusa URL sem marcador cvg_aaa_*.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

function parseArgs(argv) {
  const options = {
    keep: false,
    skipMigrate: false,
    skipSeed: false,
    withStorageScanner: false,
    storageServices: ['minio', 'clamav'],
    selfTestFailure: false,
    runId: 'prod-verify',
    worker: 12,
    command: [],
  };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--keep') options.keep = true;
    else if (arg === '--skip-migrate') options.skipMigrate = true;
    else if (arg === '--skip-seed') options.skipSeed = true;
    else if (arg === '--with-storage-scanner') options.withStorageScanner = true;
    else if (arg === '--storage-services') options.storageServices = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--self-test-failure') options.selfTestFailure = true;
    else if (arg === '--run-id') options.runId = argv[++i];
    else if (arg === '--worker') options.worker = Number(argv[++i]);
    else if (arg === '--') {
      options.command = argv.slice(i + 1);
      break;
    } else throw new Error(`Argumento invalido: ${arg}`);
    i++;
  }
  if (options.command.length === 0 && !options.selfTestFailure) {
    throw new Error('Comando obrigatorio apos --');
  }
  return options;
}

// Remove segredos de qualquer saída antes de gravar em evidência.
export function sanitizeEvidenceText(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+):([^@\s/]+)@/gi, '$1:***@')
    .replace(/(redis:\/\/[^:\s/@]*):([^@\s/]+)@/gi, '$1:***@')
    .replace(/(password|passwd|pwd|secret|token|api[_-]?key|authorization)(["']?\s*[:=]\s*["']?)([^\s"',}]+)/gi, '$1$2***')
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1***')
    .replace(/(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g, '$1***$2');
}

// Somente nomes de variáveis permitidas são registrados; valores com segredo
// passam pelo sanitizador. Nada de `...process.env` cru em evidência.
const ENV_ALLOWLIST = [
  'NODE_ENV', 'DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'INTERNAL_EVENTS_SECRET',
  'USE_DATABASE_OUTBOX', 'AAA_RUN_ID', 'AAA_RUN_ROOT', 'AAA_WORKER_INDEX',
  'AAA_PG_PORT', 'AAA_REDIS_PORT', 'AAA_S3_PORT', 'AAA_S3_CONSOLE_PORT', 'AAA_CLAMAV_PORT',
  'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY',
  'MALWARE_SCANNER', 'CLAMAV_HOST', 'CLAMAV_PORT',
];

const MASKED_ENV = /SECRET|TOKEN|PASSWORD|ACCESS_KEY|API[_-]?KEY/i;

function allowedEnvSnapshot(env) {
  const snapshot = {};
  for (const name of ENV_ALLOWLIST) {
    if (env[name] === undefined) continue;
    snapshot[name] = MASKED_ENV.test(name) ? '***' : sanitizeEvidenceText(String(env[name]));
  }
  return snapshot;
}

function runShell(command, args, env, label) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    env,
    stdio: 'pipe',
  });
  const stdout = sanitizeEvidenceText(result.stdout ?? '');
  const stderr = sanitizeEvidenceText(result.stderr ?? '');
  const output = `${stdout}\n${stderr}`;
  const finishedAt = new Date().toISOString();
  console.log(`[isolated-run] ${label} exit=${result.status}`);
  if (stdout) process.stdout.write(stdout.slice(-4000));
  if (stderr) process.stderr.write(stderr.slice(-4000));
  return {
    step: {
      label,
      command: [command, ...args].join(' '),
      startedAt,
      finishedAt,
      exitStatus: result.status ?? -1,
      signal: result.signal ?? null,
      // Tails maiores preservam os resumos por pacote do turbo/vitest sem
      // gravar a saída integral (que pode ter dezenas de MB).
      stdoutTail: stdout.slice(-8000),
      stderrTail: stderr.slice(-4000),
    },
    status: result.status ?? -1,
    output,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  process.env.CVG_PROGRAM_DIR = process.env.CVG_PROGRAM_DIR || join(REPO_ROOT, 'docs', 'programa-triplo-aaa-2026-09-14');
  process.env.CVG_RUNTIME_DIR = process.env.CVG_RUNTIME_DIR
    || join(process.env.CVG_PROGRAM_DIR, 'evidencias', 'integration-runs', options.runId);
  process.env.AAA_RUN_ID = options.runId;
  process.env.AAA_WORKER_INDEX = String(options.worker);
  process.env.AAA_RUN_ROOT = process.env.AAA_RUN_ROOT || join('/tmp', 'cvg-aaa-runs', options.runId);

  const isolated = await import('../../e2e/support/aaa/isolated-env.ts');
  const runContext = await import('../../e2e/support/aaa/run-context.ts');
  const ctx = runContext.getRunContext(options.worker);

  const evidenceDir = join(process.env.CVG_PROGRAM_DIR, 'evidencias', 'integration-runs', options.runId);
  mkdirSync(evidenceDir, { recursive: true });

  const env = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'test',
    DATABASE_URL: ctx.databaseUrl,
    REDIS_URL: ctx.redisUrl,
    JWT_SECRET: process.env.JWT_SECRET || 'isolated-runner-secret-not-for-production',
    INTERNAL_EVENTS_SECRET: process.env.INTERNAL_EVENTS_SECRET || 'isolated-runner-internal-secret',
  };

  let provision;
  let storageScanner = null;
  const steps = [];
  let exitCode = 1;
  let selfTest = null;
  try {
    provision = await isolated.provisionIsolatedEnv(ctx);
    console.log(`[isolated-run] provisionado ${ctx.databaseName} pg=${ctx.ports.postgres} redis=${ctx.ports.redis}`);

    if (options.withStorageScanner) {
      const storage = await import('../../e2e/support/aaa/storage-scanner-env.ts');
      storageScanner = await storage.provisionStorageScanner(ctx, { services: options.storageServices });
      await storage.waitForStorageScanner(storageScanner);
      Object.assign(env, {
        S3_ENDPOINT: storageScanner.s3Endpoint,
        S3_BUCKET: storageScanner.s3Bucket,
        S3_ACCESS_KEY_ID: storageScanner.s3AccessKey,
        S3_SECRET_ACCESS_KEY: storageScanner.s3SecretKey,
        MALWARE_SCANNER: 'clamav',
        CLAMAV_HOST: storageScanner.clamavHost,
        CLAMAV_PORT: String(storageScanner.clamavPort),
      });
      console.log(`[isolated-run] storage/scanner ${storageScanner.project} s3=${storageScanner.s3Endpoint} clamav=${storageScanner.clamavPort}`);
    }

    if (!options.skipMigrate) {
      const migrate = runShell('pnpm', ['--filter', '@cvg/database', 'db:types'], env, 'db:types');
      steps.push(migrate.step);
      if (migrate.status !== 0) throw new Error('db:types falhou');
      const migration = runShell('pnpm', ['--filter', '@cvg/database', 'db:migrate'], env, 'db:migrate');
      steps.push(migration.step);
      if (migration.status !== 0) throw new Error('db:migrate falhou');
    }
    if (!options.skipSeed) {
      const seed = runShell('pnpm', ['--filter', '@cvg/database', 'db:seed'], env, 'db:seed');
      steps.push(seed.step);
      if (seed.status !== 0) throw new Error('db:seed falhou');
    }

    if (options.selfTestFailure) {
      // Controle negativo: o comando falha de propósito e o runner deve
      // encerrar APENAS os recursos do próprio run (comprovado no finally).
      const failing = runShell(process.execPath, ['-e', 'process.exit(7)'], env, 'self-test-failure');
      steps.push(failing.step);
      selfTest = { expectedExit: 7, observedExit: failing.status, ok: failing.status === 7 };
      if (!selfTest.ok) throw new Error(`self-test: esperava 7, obteve ${failing.status}`);
      exitCode = 0; // o controle negativo passou; o exit do run comprova o cleanup
    } else {
      const result = runShell(options.command[0], options.command.slice(1), env, 'command');
      steps.push(result.step);
      exitCode = result.status;
    }
  } catch (error) {
    steps.push({
      label: 'error',
      message: sanitizeEvidenceText(error instanceof Error ? error.message : String(error)),
      finishedAt: new Date().toISOString(),
    });
    exitCode = 1;
  } finally {
    const summary = {
      runId: ctx.runId,
      workerIndex: ctx.workerIndex,
      databaseUrl: ctx.databaseUrl,
      redisUrl: ctx.redisUrl,
      storageScanner: storageScanner
        ? { project: storageScanner.project, s3Endpoint: storageScanner.s3Endpoint, clamavPort: storageScanner.clamavPort }
        : null,
      startedAt: steps[0]?.startedAt ?? new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      command: options.command.join(' '),
      allowedEnv: allowedEnvSnapshot(env),
      steps,
      selfTest,
      exitCode,
    };
    writeFileSync(join(evidenceDir, 'runner-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    writeFileSync(
      join(evidenceDir, 'runner-output.log'),
      sanitizeEvidenceText(steps.map((s) => `[${s.label}] exit=${s.exitStatus ?? 'n/a'}\n${s.stdoutTail ?? s.message ?? ''}\n${s.stderrTail ?? ''}`).join('\n---\n')),
    );

    if (!options.keep) {
      const cleanup = { provisioned: Boolean(provision), storageScanner: false, isolated: null };
      try {
        if (storageScanner) {
          const storage = await import('../../e2e/support/aaa/storage-scanner-env.ts');
          cleanup.storageScanner = true;
          cleanup.storageScannerResult = storage.teardownStorageScanner(ctx);
        }
      } catch (error) {
        cleanup.storageScannerError = sanitizeEvidenceText(String(error));
        exitCode = exitCode === 0 ? 1 : exitCode;
      }
      try {
        cleanup.isolated = isolated.teardownIsolatedEnv(ctx, { stopServices: true, dropDatabase: true });
      } catch (error) {
        cleanup.isolatedError = sanitizeEvidenceText(String(error));
        exitCode = exitCode === 0 ? 1 : exitCode;
      }
      writeFileSync(join(evidenceDir, 'runner-cleanup.json'), `${JSON.stringify(cleanup, null, 2)}\n`);
      console.log(`[isolated-run] cleanup ${JSON.stringify(cleanup)}`);
    }
    process.exitCode = exitCode === 0 ? 0 : 1;
  }
}

const invokedDirectly = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (invokedDirectly) {
  main().catch((error) => {
    console.error('[isolated-run] falha fatal:', sanitizeEvidenceText(String(error)));
    process.exitCode = 1;
  });
}
