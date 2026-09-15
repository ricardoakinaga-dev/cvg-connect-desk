import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureEvidenceDir, getRunContext, PROGRAM_DIR, REPO_ROOT } from './run-context.ts';

interface PackageManifest {
  name?: string;
  scripts?: Record<string, string>;
}

interface WorkspaceCheck {
  package: string;
  path: string;
  lint: string;
  build: string;
  typecheck: string;
  test: string;
}

interface DeclaredCheck {
  task: string;
  command: string;
  availability: string;
  environment: string;
}

interface TaskLike {
  id: string;
  title: string;
  objective?: string;
  acceptance?: string[];
  checks?: DeclaredCheck[];
}

function classify(script: string | undefined): string {
  if (!script) {
    return 'MISSING';
  }
  if (/^echo\b/.test(script.trim())) {
    return 'PLACEHOLDER';
  }
  return 'REAL';
}

function readManifest(path: string): PackageManifest | null {
  const manifestPath = join(path, 'package.json');
  if (!existsSync(manifestPath)) {
    return null;
  }
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
}

function workspacePaths(): string[] {
  const paths = [REPO_ROOT];
  for (const group of ['apps', 'packages', 'modules', 'services']) {
    const groupPath = join(REPO_ROOT, group);
    if (!existsSync(groupPath)) {
      continue;
    }
    for (const entry of readdirSync(groupPath, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(groupPath, entry.name, 'package.json'))) {
        paths.push(join(groupPath, entry.name));
      }
    }
  }
  return paths;
}

const SERVICE_KEYWORDS: Array<{ service: string; pattern: RegExp }> = [
  { service: 'postgresql', pattern: /postgres|postgresql/i },
  { service: 'redis', pattern: /redis/i },
  { service: 'minio', pattern: /minio|s3|bucket|storage/i },
  { service: 'clamav', pattern: /clamav|clamd|scanner|antivirus|malware/i },
  { service: 'otel-collector', pattern: /otel|opentelemetry|tracing|trace/i },
  { service: 'prometheus', pattern: /prometheus|metrics|m[eé]tricas/i },
  { service: 'grafana', pattern: /grafana|dashboard de observabilidade/i },
  { service: 'browser-chromium', pattern: /playwright|browser|chromium/i },
  { service: 'load-generator', pattern: /k6|carga|load|benchmark/i },
  { service: 'disposable-database', pattern: /restore|restaura|disposable|descart/i },
  { service: 'external-provider', pattern: /provider|gateway|evolution|webhook externo/i },
];

function main() {
  const ctx = getRunContext();
  const evidenceDir = ensureEvidenceDir(ctx);

  const backlog = JSON.parse(readFileSync(join(PROGRAM_DIR, 'BACKLOG.json'), 'utf8')) as { tasks: TaskLike[] };

  const workspace: WorkspaceCheck[] = workspacePaths().map((path) => {
    const manifest = readManifest(path) ?? {};
    const scripts = manifest.scripts ?? {};
    return {
      package: manifest.name ?? path.slice(REPO_ROOT.length + 1),
      path: path.slice(REPO_ROOT.length + 1) || '.',
      lint: `${classify(scripts.lint)}: ${scripts.lint ?? '-'}`,
      build: `${classify(scripts.build)}: ${scripts.build ?? '-'}`,
      typecheck: `${classify(scripts.typecheck)}: ${scripts.typecheck ?? '-'}`,
      test: `${classify(scripts.test)}: ${scripts.test ?? '-'}`,
    };
  });

  const declaredChecks: DeclaredCheck[] = backlog.tasks.flatMap((task) =>
    (task.checks ?? []).map((check) => ({ task: task.id, ...check })),
  );

  const servicesByTask = backlog.tasks.map((task) => {
    const haystack = [task.title, task.objective ?? '', ...(task.acceptance ?? []), ...(task.checks ?? []).map((check) => check.command)]
      .join(' ')
      .toLowerCase();
    const services = SERVICE_KEYWORDS.filter((entry) => entry.pattern.test(haystack)).map((entry) => entry.service);
    return { task: task.id, services: [...new Set(services)] };
  });

  const gateServices = {
    generatedAt: new Date().toISOString(),
    runId: ctx.runId,
    availableNow: {
      postgresql: 'disponivel localmente via binarios PostgreSQL 16.15 (e2e/support/aaa/pg.ts)',
      redis: 'disponivel localmente (redis-server 7.0.15 do runtime local ou 8.10.1 compilado)',
      'browser-chromium': 'Playwright 1.59.1 + chromium 1243 em ~/.cache/ms-playwright',
      'load-generator': '/home/ricardo/.local/bin/k6',
      'otel-collector': '/tmp/opencode/otelcol/otelcol-contrib (binario local)',
      'osv-scanner': '/tmp/opencode/osv-scanner (binario local)',
    },
    blockedNow: {
      minio: 'sem binario local; Docker bloqueado por permissao no socket; provisionar binario estatico ou CI efemero antes dos cartoes de midia',
      clamav: 'sem clamscan/clamd local; provisionar antes dos cartoes de scanner',
      prometheus: 'sem binario local; compose/metricas previstos para cartoes de observabilidade',
      grafana: 'sem binario local; dashboards previstos para cartoes de observabilidade',
    },
    alias: {
      'disposable-database': 'postgresql isolado descartavel criado por teardown restrito',
      'external-provider': 'mock local e2e/support/mock-evolution-server.ts; sandbox real apenas se o cartao exigir',
      'browser-chromium': 'Playwright',
    },
    servicesByTask,
  };

  writeFileSync(join(evidenceDir, 'checks-inventory.json'), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    runId: ctx.runId,
    workspace,
    declaredChecks,
    summary: {
      packages: workspace.length,
      lintReal: workspace.filter((entry) => entry.lint.startsWith('REAL')).length,
      lintPlaceholder: workspace.filter((entry) => entry.lint.startsWith('PLACEHOLDER')).length,
      buildReal: workspace.filter((entry) => entry.build.startsWith('REAL')).length,
      buildPlaceholder: workspace.filter((entry) => entry.build.startsWith('PLACEHOLDER')).length,
      typecheckReal: workspace.filter((entry) => entry.typecheck.startsWith('REAL')).length,
      testReal: workspace.filter((entry) => entry.test.startsWith('REAL')).length,
    },
  }, null, 2)}\n`);

  writeFileSync(join(evidenceDir, 'gates-services.json'), `${JSON.stringify(gateServices, null, 2)}\n`);

  console.log(`[inventory] pacotes=${workspace.length}`);
  console.log(`[inventory] checks declarados=${declaredChecks.length}`);
  console.log(`[inventory] servicos bloqueados: ${Object.keys(gateServices.blockedNow).join(', ')}`);
}

main();
