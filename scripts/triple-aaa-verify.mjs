#!/usr/bin/env node
/**
 * Triple AAA master gate FINAL (§26) — PROD-02.
 *
 * Orquestra checks reais e avalia cada prova como manifesto vinculado ao
 * candidato (commit/lock/source e, quando exigido, imageDigest). Sem PASS
 * narrativo; FAIL/BLOCKED/NOT_RUN/SKIPPED/INVALID/MISSING reprovam.
 * Gera artifacts/triple-aaa-report.json + .md.
 *
 * Uso:
 *   node scripts/triple-aaa-verify.mjs [--run|--evaluate]
 *     [--root <dir>] [--checks-file <json>] [--evidence-dir <dir>]
 *     [--candidate <sha>] [--image-digest <sha256:...>]
 *     [--with-external-evidence]
 *
 * TRIPLE_AAA_CERTIFIED nunca é emitido aqui: exige política de release e
 * verificação de tag/assinatura em fluxo dedicado.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CERTIFICATION_POLICY,
  DEFAULT_CHECKS,
  evaluateGate,
  readChecksFile,
  readSealedCandidate,
  resolveCandidate,
  runCheck,
  sealCandidate,
  summarizeRejections,
  writeGateReports,
} from './production/evidence-gate.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(scriptDir, '..');

function parseArgs(argv) {
  const options = {
    mode: 'run',
    root: defaultRoot,
    checksFile: null,
    evidenceDir: null,
    artifactsDir: null,
    candidate: null,
    imageDigest: null,
    withExternal: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`valor ausente para ${arg}`);
      return argv[index];
    };
    if (arg === '--run') options.mode = 'run';
    else if (arg === '--evaluate' || arg === '--evidence-only') options.mode = 'evaluate';
    else if (arg === '--root') options.root = resolve(next());
    else if (arg === '--checks-file') options.checksFile = resolve(next());
    else if (arg === '--evidence-dir') options.evidenceDir = resolve(next());
    else if (arg === '--artifacts-dir') options.artifactsDir = resolve(next());
    else if (arg === '--candidate') options.candidate = next();
    else if (arg === '--image-digest') options.imageDigest = next();
    else if (arg === '--with-external-evidence') options.withExternal = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`argumento desconhecido: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(
    [
      'Uso: node scripts/triple-aaa-verify.mjs [--run|--evaluate] [opções]',
      '',
      '  --run                      executa os checks e grava manifestos (padrão)',
      '  --evaluate                 apenas avalia manifestos já selados',
      '  --root <dir>               raiz do candidato (default: raiz do repo)',
      '  --checks-file <json>       lista de checks (default: pipeline completo)',
      '  --evidence-dir <dir>       diretório de manifestos/logs (default: <root>/artifacts/evidence)',
      '  --artifacts-dir <dir>      diretório dos relatórios (default: <root>/artifacts)',
      '  --candidate <sha>          commit do candidato (default: git HEAD; obrigatório fora de git)',
      '  --image-digest <sha256:…>  digest esperado para checks com imagem',
      '  --with-external-evidence   torna checks externos (CI) requeridos',
      '',
      'Exit 0 somente com state=VERIFIED_CANDIDATE (todos os checks requeridos PASS vinculados ao mesmo candidato).',
    ].join('\n'),
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return 0;
  }
  const root = options.root;
  const artifactsDir = options.artifactsDir ?? join(root, 'artifacts');
  const evidenceDir = options.evidenceDir ?? join(artifactsDir, 'evidence');
  const checks = options.checksFile ? readChecksFile(options.checksFile) : DEFAULT_CHECKS;
  mkdirSync(evidenceDir, { recursive: true });

  const excludes = [evidenceDir, artifactsDir];
  const execution = {
    runId: process.env.GITHUB_RUN_ID ?? null,
    attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  };
  const liveBefore = resolveCandidate({
    root,
    commit: options.candidate ?? process.env.SHA ?? null,
    expectedImageDigest: options.imageDigest,
    excludes,
    ...execution,
  });
  if (!liveBefore.commit) {
    console.error('[gate] candidato sem commit: use --candidate <sha> fora de um repositório git');
    return 2;
  }

  let sealed;
  let sealMissing = false;
  if (options.mode === 'run') {
    sealCandidate(evidenceDir, liveBefore);
    for (const check of checks) {
      if (check.external || check.artifact) continue;
      process.stdout.write(`[gate] ${check.id}: executando… `);
      const manifest = runCheck(check, { root, evidenceDir, candidate: liveBefore });
      console.log(manifest.status);
    }
    sealed = readSealedCandidate(evidenceDir).candidate;
  } else {
    const sealedResult = readSealedCandidate(evidenceDir);
    if (sealedResult.ok) {
      sealed = sealedResult.candidate;
    } else {
      // Evidência ausente é estado inequívoco, não erro de uso: o relatório sai
      // com cada check MISSING e exit != 0.
      console.error(`[gate] ${sealedResult.error}`);
      sealed = liveBefore;
      sealMissing = true;
    }
  }

  const liveAfter = resolveCandidate({
    root,
    commit: options.candidate ?? process.env.SHA ?? null,
    expectedImageDigest: options.imageDigest,
    excludes,
    ...execution,
  });

  const report = evaluateGate({
    checks,
    evidenceDir,
    candidate: sealed,
    withExternal: options.withExternal,
    artifactDir: artifactsDir,
    root,
  });

  const drift = [];
  if (liveAfter.commit !== sealed.commit) drift.push(`commit (selo=${sealed.commit} atual=${liveAfter.commit})`);
  if (liveAfter.lockfileSha256 !== sealed.lockfileSha256) drift.push('lockfileSha256');
  if (liveAfter.sourceSha256 !== sealed.sourceSha256) drift.push('sourceSha256');
  if (liveAfter.imageDigest !== sealed.imageDigest) drift.push('imageDigest');
  if (liveAfter.runId !== sealed.runId) drift.push('runId');
  if (liveAfter.attempt !== sealed.attempt) drift.push('attempt');
  report.liveCandidate = {
    commit: liveAfter.commit,
    lockfileSha256: liveAfter.lockfileSha256,
    sourceSha256: liveAfter.sourceSha256,
    imageDigest: liveAfter.imageDigest,
    runId: liveAfter.runId,
    attempt: liveAfter.attempt,
    checkedAt: new Date().toISOString(),
  };
  report.sealMissing = sealMissing;
  report.candidateDrift = drift;
  if (sealMissing) {
    report.state = 'FAILED';
    report.final = 'FAILED';
    report.rejected = [
      ...report.rejected,
      {
        check: 'candidate-seal',
        status: 'MISSING',
        reasons: ['candidate.json ausente/inválido; evidência não pode ser avaliada sem selo do candidato'],
      },
    ];
    report.honesty = `${report.honesty} Selo do candidato ausente ou inválido.`;
  }
  if (drift.length > 0) {
    report.state = 'FAILED';
    report.final = 'FAILED';
    report.honesty = `${report.honesty} Drift do candidato entre selo e avaliação: ${drift.join(', ')}.`;
  }

  const { jsonPath, mdPath } = writeGateReports(artifactsDir, report);
  console.log(`\nFINAL: ${report.state}`);
  console.log(`Checks: ${JSON.stringify(report.counts)}`);
  if (report.rejected.length > 0) console.log(`Reprovados: ${summarizeRejections(report)}`);
  if (drift.length > 0) console.log(`Drift: ${drift.join(', ')}`);
  console.log(`Certificação: ${CERTIFICATION_POLICY.state} (${CERTIFICATION_POLICY.reason})`);
  console.log(`Reports: ${jsonPath} + ${mdPath}`);
  return report.state === 'VERIFIED_CANDIDATE' ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`[gate] erro fatal: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 2;
}
