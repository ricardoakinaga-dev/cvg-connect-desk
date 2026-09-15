import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureEvidenceDir, getRunContext, PROGRAM_DIR, REPO_ROOT } from './run-context.ts';

function run(command: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(command, args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function walkFiles(root: string, acc: string[] = []): string[] {
  if (!existsSync(root)) {
    return acc;
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, acc);
    } else if (entry.isFile()) {
      acc.push(full);
    }
  }
  return acc;
}

interface ManifestoPlanning {
  files_sha256: Record<string, string>;
  source_revision: string;
  audit_sha256: string;
}

function main() {
  const ctx = getRunContext();
  const evidenceDir = ensureEvidenceDir(ctx, 'baseline');

  const revision = run('git', ['rev-parse', 'HEAD']).stdout.trim();
  const branch = run('git', ['branch', '--show-current']).stdout.trim();
  const status = run('git', ['status', '--porcelain=v1']).stdout;
  const worktrees = run('git', ['worktree', 'list', '--porcelain']).stdout;
  const stash = run('git', ['stash', 'list']).stdout;

  const catalogPath = join(PROGRAM_DIR, 'BACKLOG.json');
  const reportPath = join(PROGRAM_DIR, '..', 'auditorias', '2026-09-12', 'RELATORIO.md');
  const backlog = JSON.parse(readFileSync(catalogPath, 'utf8')) as { audit_sha256: string; baseline_revision: string };

  const reportSha = sha256File(reportPath);
  const auditCheck = {
    expected: backlog.audit_sha256,
    actual: reportSha,
    match: backlog.audit_sha256 === reportSha,
  };

  const baseFiles = [
    'docs/auditorias/2026-09-12/RELATORIO.md',
    'docs/execucao-aaa-2026-09-12/BACKLOG.json',
    'docs/execucao-aaa-2026-09-12/QUALIDADE.json',
    'docs/execucao-aaa-2026-09-12/CONTRATOS.md',
    'docs/execucao-aaa-2026-09-12/DECISOES.md',
    'docs/execucao-aaa-2026-09-12/EXECUCAO_MULTIAGENTE.md',
    'docs/execucao-aaa-2026-09-12/plan.py',
    'package.json',
    'pnpm-lock.yaml',
    'turbo.json',
    'playwright.config.ts',
  ];

  const fileHashes: Record<string, string> = {};
  for (const relativePath of baseFiles) {
    const full = join(REPO_ROOT, relativePath);
    if (existsSync(full)) {
      fileHashes[relativePath] = sha256File(full);
    }
  }

  // Revalidar hashes do pacote de planejamento (manifesto-final.json).
  const manifestoPath = join(PROGRAM_DIR, 'evidencias', 'manifesto-final.json');
  const manifesto = JSON.parse(readFileSync(manifestoPath, 'utf8')) as ManifestoPlanning;
  const manifestChecks = Object.entries(manifesto.files_sha256).map(([relativePath, expected]) => {
    const full = join(REPO_ROOT, relativePath);
    const actual = existsSync(full) ? sha256File(full) : null;
    return { path: relativePath, expected, actual, match: actual === expected };
  });
  const manifestMismatches = manifestChecks.filter((check) => !check.match);

  // Preservação dos runs gauntlet anteriores (nenhuma escrita nesses diretórios).
  const preservedRoots = ['.gauntlet', '.gauntlet-v2-archive-20260912'];
  const preservation: Record<string, { files: number; sha256: Record<string, string> }> = {};
  for (const rootName of preservedRoots) {
    const root = join(REPO_ROOT, rootName);
    const files = walkFiles(root).sort();
    preservation[rootName] = {
      files: files.length,
      sha256: Object.fromEntries(files.map((file) => [file.slice(REPO_ROOT.length + 1), sha256File(file)])),
    };
  }

  // Descoberta de serviços vivos e ferramentas (sem tocar em dados alheios).
  const listeners = run('ss', ['-ltn']).stdout;
  const processes = run('ps', ['-eo', 'pid,comm,args']).stdout
    .split('\n')
    .filter((line) => /postgres|redis|docker-proxy|node|vite|tsx/.test(line))
    .slice(0, 120);

  const toolAvailability = {
    node: run('node', ['--version']).stdout.trim(),
    pnpm: run('pnpm', ['--version']).stdout.trim(),
    python3: run('python3', ['--version']).stdout.trim(),
    dockerClient: run('docker', ['--version']).stdout.trim(),
    dockerServer: run('docker', ['ps']).status === 0 ? 'acessivel' : 'BLOQUEADO (permission denied no socket)',
    k6: run('k6', ['version']).stdout.split('\n')[0].trim() || null,
    otelcolContrib: existsSync('/tmp/opencode/otelcol/otelcol-contrib') ? 'presente em /tmp/opencode/otelcol/otelcol-contrib' : 'ausente',
    osvScanner: existsSync('/tmp/opencode/osv-scanner') ? 'presente em /tmp/opencode/osv-scanner' : 'ausente',
    minio: 'ausente (Docker bloqueado)',
    clamav: 'ausente (Docker bloqueado)',
  };

  const listening = listeners
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean);

  const manifest = {
    capturedAt: new Date().toISOString(),
    runId: ctx.runId,
    repository: REPO_ROOT,
    git: {
      revision,
      branch,
      statusPorcelain: status,
      worktrees,
      stash,
      clean: status.trim().length === 0,
      preexistingChanges: status
        .split('\n')
        .filter(Boolean)
        .map((line) => ({ status: line.slice(0, 2), path: line.slice(3) })),
    },
    audit: auditCheck,
    catalog: {
      baselineRevision: backlog.baseline_revision,
      catalogSha256: sha256File(catalogPath),
      catalogMatchesAudit: backlog.audit_sha256 === reportSha,
      planningManifestMismatches: manifestMismatches,
    },
    fileHashes,
    preservation,
    environment: {
      toolAvailability,
      listeningPorts: listening,
      relevantProcesses: processes,
      note: 'Serviços de outros projetos (cvg-his-v4) permanecem intocados; AAA usa faixa 56xxx/46xx/4373/8083.',
    },
  };

  writeFileSync(join(evidenceDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(evidenceDir, 'git-status.txt'), status);
  writeFileSync(
    join(evidenceDir, 'hash-before.txt'),
    Object.entries(fileHashes).map(([path, hash]) => `${hash}  ${path}`).join('\n') + '\n',
  );
  writeFileSync(
    join(evidenceDir, 'preservation.json'),
    `${JSON.stringify(preservation, null, 2)}\n`,
  );

  const hardFailures: string[] = [];
  if (!auditCheck.match) {
    hardFailures.push(`SHA-256 do relatorio divergente: ${auditCheck.actual}`);
  }
  if (manifestMismatches.length > 0) {
    hardFailures.push(`Manifesto de planejamento divergente em ${manifestMismatches.length} arquivo(s).`);
  }
  if (backlog.baseline_revision !== revision) {
    hardFailures.push(`Revisao do catalogo (${backlog.baseline_revision}) difere do HEAD (${revision}).`);
  }

  console.log(`[baseline] revision=${revision.slice(0, 8)} branch=${branch}`);
  console.log(`[baseline] audit sha match=${auditCheck.match} catalog mismatches=${manifestMismatches.length}`);
  console.log(`[baseline] preservados: ${preservedRoots.map((root) => `${root}(${preservation[root].files})`).join(' ')}`);
  if (hardFailures.length > 0) {
    console.error(`[baseline] FALHA: ${hardFailures.join(' | ')}`);
    process.exit(1);
  }
  console.log('[baseline] PASS');
}

main();
