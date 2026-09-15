#!/usr/bin/env node
/**
 * PROD-02 — gate de evidência vinculado ao candidato (C10).
 *
 * Regras centrais:
 * - Toda prova é um manifesto por check com comando, ambiente, horário,
 *   resultado, hashes (log/payload, lockfile, source) e escopo declarado.
 * - O manifesto só vale se o candidato (commit, lockfileSha256, sourceSha256 e,
 *   quando exigido, imageDigest) for idêntico ao candidato avaliado.
 * - JSON vazio/truncado, PASS sem log/artefato, conjunto de queries vazio e
 *   status FAIL/BLOCKED/NOT_RUN/SKIPPED reprovam o check.
 * - Ausência de check requerido = MISSING → estado não-VERIFIED e exit != 0.
 * - TRIPLE_AAA_CERTIFIED nunca é emitido aqui: exige política de release e
 *   verificação de tag/assinatura em fluxo dedicado (nunca só status local).
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

export const SCHEMA_VERSION = 1;
export const MANIFEST_STATUSES = Object.freeze(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN', 'SKIPPED']);
export const TERMINAL_FAIL_STATUSES = Object.freeze(['FAIL', 'BLOCKED', 'NOT_RUN', 'SKIPPED']);
export const GATE_STATES = Object.freeze(['VERIFIED_CANDIDATE', 'FAILED']);
export const CERTIFICATION_POLICY = Object.freeze({
  state: 'NOT_ELIGIBLE_LOCAL',
  reason:
    'TRIPLE_AAA_CERTIFIED não pode ser emitido pelo gate local: exige política de release ratificada e verificação de tag/assinatura em fluxo dedicado.',
  requiredForCertification: [
    'política de release definida e aprovada',
    'tag de release assinada verificada no SHA do candidato',
    'agregador CI no mesmo SHA (VERIFIED_CANDIDATE) com artefato de imagem conferido',
  ],
});
export const QUERY_PERFORMANCE_BUDGET = Object.freeze({ maxTotalCost: 1000, maxPlanRows: 100000 });

const DEFAULT_SOURCE_EXCLUDES = [
  '.git',
  'node_modules',
  'artifacts',
  'docs/producao-2026-09-13/evidencias',
  'docs/execucao-aaa-2026-09-12/runtime',
];

// Pathspecs equivalentes entregues ao git (M1): o hash de fonte cobre
// código/configuração de produto — tracked + untracked não ignorados — mas
// nunca as evidências geradas dentro do repo, senão cada nova prova
// invalidaria o próprio selo a cada run.
const GIT_EXCLUDE_PATHSPECS = [
  ':(exclude)docs/producao-2026-09-13/evidencias',
  ':(exclude)docs/execucao-aaa-2026-09-12/runtime',
];

export function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

export function sha256File(path) {
  return sha256Hex(readFileSync(path));
}

export function toPosix(path) {
  return path.split(sep).join('/');
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseJsonStrict(text, label = 'JSON') {
  const trimmed = String(text ?? '').trim();
  if (trimmed.length === 0) {
    return { ok: false, value: null, error: `${label} vazio` };
  }
  try {
    const value = JSON.parse(trimmed);
    if (value === null || typeof value !== 'object') {
      return { ok: false, value: null, error: `${label} sem objeto/array raiz` };
    }
    return { ok: true, value, error: null };
  } catch (error) {
    return { ok: false, value: null, error: `${label} truncado/inválido: ${error.message}` };
  }
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

function isCommitSha(value) {
  return typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);
}

function normalizeExcludes(root, excludes = []) {
  const absolute = [];
  for (const entry of [...DEFAULT_SOURCE_EXCLUDES, ...excludes]) {
    if (!entry) continue;
    const abs = resolve(root, entry);
    absolute.push(abs);
    absolute.push(`${abs}${sep}`);
  }
  return absolute;
}

function isExcluded(absPath, excludes) {
  return excludes.some((ex) => absPath === ex || absPath.startsWith(ex.endsWith(sep) ? ex : `${ex}${sep}`));
}

function listGitFiles(root) {
  try {
    const output = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.', ...GIT_EXCLUDE_PATHSPECS],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    return output.split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

function walkFiles(root, excludes, current = root, acc = []) {
  for (const name of readdirSync(current, { withFileTypes: true })) {
    const abs = join(current, name.name);
    if (isExcluded(abs, excludes)) continue;
    if (name.isDirectory()) {
      walkFiles(root, excludes, abs, acc);
    } else if (name.isFile()) {
      acc.push(toPosix(relative(root, abs)));
    }
  }
  return acc;
}

/**
 * Hash estável do source do candidato.
 * Repositório git: arquivos rastreados + untracked não ignorados (conteúdo no
 * disco, incluindo edições locais), excluídas as evidências geradas dentro do
 * repo (M1). Diretório não-git: caminhada de arquivos.
 */
export function computeSourceHash(root, { excludes = [] } = {}) {
  const absoluteRoot = resolve(root);
  const excludesAbs = normalizeExcludes(absoluteRoot, excludes);
  const listed = listGitFiles(absoluteRoot);
  const files = [...new Set(listed ?? walkFiles(absoluteRoot, excludesAbs))]
    .filter((rel) => {
      const abs = resolve(absoluteRoot, rel);
      return !isExcluded(abs, excludesAbs) && existsSync(abs);
    })
    .sort();
  const hash = createHash('sha256');
  for (const rel of files) {
    const abs = resolve(absoluteRoot, rel);
    hash.update(`file\0${toPosix(rel)}\0${sha256File(abs)}\0`);
  }
  return { sourceSha256: hash.digest('hex'), files: files.length };
}

function normalizeRunId(value) {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  return null;
}

function normalizeAttempt(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  return Number.isSafeInteger(Number(normalized)) ? normalized : null;
}

function readExecutionIdentity(value) {
  const root = isPlainObject(value) ? value : {};
  const nested = isPlainObject(root.execution) ? root.execution : {};
  const environment = isPlainObject(root.environment) ? root.environment : {};
  const sources = [root, nested, environment];
  const runIdValue = sources.find((source) => source.runId !== undefined)?.runId;
  const attemptValue = sources.find((source) => source.attempt !== undefined)?.attempt;
  return {
    runId: normalizeRunId(runIdValue),
    attempt: normalizeAttempt(attemptValue),
  };
}

export function resolveCandidate({
  root,
  commit,
  repository = null,
  expectedImageDigest = null,
  excludes = [],
  runId = null,
  attempt = null,
} = {}) {
  const absoluteRoot = resolve(root);
  let resolvedCommit = commit ?? null;
  if (!resolvedCommit) {
    try {
      resolvedCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: absoluteRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      resolvedCommit = null;
    }
  }
  const lockfile = join(absoluteRoot, 'pnpm-lock.yaml');
  const { sourceSha256, files } = computeSourceHash(absoluteRoot, { excludes });
  return {
    repository,
    commit: resolvedCommit,
    lockfileSha256: existsSync(lockfile) ? sha256File(lockfile) : null,
    sourceSha256,
    sourceFileCount: files,
    imageDigest: expectedImageDigest,
    runId: normalizeRunId(runId),
    attempt: normalizeAttempt(attempt),
    sealedAt: new Date().toISOString(),
  };
}

export function sealCandidate(evidenceDir, candidate) {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, 'candidate.json'), `${JSON.stringify(candidate, null, 2)}\n`);
}

export function readSealedCandidate(evidenceDir) {
  const file = join(evidenceDir, 'candidate.json');
  if (!existsSync(file)) {
    return { ok: false, candidate: null, error: 'candidate.json ausente (candidato não selado)' };
  }
  const parsed = parseJsonStrict(readFileSync(file, 'utf8'), 'candidate.json');
  if (!parsed.ok) return { ok: false, candidate: null, error: parsed.error };
  if (!isPlainObject(parsed.value)) {
    return { ok: false, candidate: null, error: 'candidate.json sem objeto raiz' };
  }
  return { ok: true, candidate: parsed.value, error: null };
}

function bindingMismatches(manifestCandidate, candidate) {
  const reasons = [];
  if (!isPlainObject(manifestCandidate)) {
    return ['candidato do manifesto ausente'];
  }
  if (!isCommitSha(candidate?.commit)) reasons.push(`commit inválido no candidato (${candidate?.commit ?? 'ausente'})`);
  if (!isCommitSha(manifestCandidate.commit) || manifestCandidate.commit !== candidate.commit) {
    reasons.push(`commit divergente (manifesto=${manifestCandidate.commit ?? 'ausente'} atual=${candidate.commit ?? 'ausente'})`);
  }
  if (!isSha256(candidate?.lockfileSha256)) reasons.push('lockfileSha256 ausente/inválido no candidato');
  if (!isSha256(manifestCandidate.lockfileSha256) || manifestCandidate.lockfileSha256 !== candidate.lockfileSha256) {
    reasons.push(`lockfileSha256 divergente (manifesto=${manifestCandidate.lockfileSha256 ?? 'ausente'} atual=${candidate.lockfileSha256 ?? 'ausente'})`);
  }
  if (!isSha256(candidate?.sourceSha256)) reasons.push('sourceSha256 ausente/inválido no candidato');
  if (!isSha256(manifestCandidate.sourceSha256) || manifestCandidate.sourceSha256 !== candidate.sourceSha256) {
    reasons.push(`sourceSha256 divergente (manifesto=${manifestCandidate.sourceSha256 ?? 'ausente'} atual=${candidate.sourceSha256 ?? 'ausente'})`);
  }
  if (!isValidIso(candidate?.sealedAt) || !isValidIso(manifestCandidate.sealedAt) || manifestCandidate.sealedAt !== candidate.sealedAt) {
    reasons.push(`sealedAt divergente (manifesto=${manifestCandidate.sealedAt ?? 'ausente'} atual=${candidate?.sealedAt ?? 'ausente'})`);
  }
  if (candidate.imageDigest && manifestCandidate.imageDigest !== candidate.imageDigest) {
    reasons.push(`imageDigest divergente (manifesto=${manifestCandidate.imageDigest ?? 'ausente'} atual=${candidate.imageDigest})`);
  }
  const expectedExecution = readExecutionIdentity(candidate);
  const manifestExecution = readExecutionIdentity(manifestCandidate);
  if (!expectedExecution.runId) {
    reasons.push('candidato sem runId');
  } else if (manifestExecution.runId !== expectedExecution.runId) {
    reasons.push(`runId divergente (manifesto=${manifestExecution.runId ?? 'ausente'} atual=${expectedExecution.runId})`);
  }
  if (!expectedExecution.attempt) {
    reasons.push('candidato sem attempt');
  } else if (manifestExecution.attempt !== expectedExecution.attempt) {
    reasons.push(`attempt divergente (manifesto=${manifestExecution.attempt ?? 'ausente'} atual=${expectedExecution.attempt})`);
  }
  return reasons;
}

export function parseCoverageMetrics(text) {
  const marker = String(text ?? '').match(/(?:COVERAGE_METRICS|coverage-metrics)\s*=\s*(\{[^\n]+\})/);
  if (marker) {
    try {
      const parsed = JSON.parse(marker[1]);
      if (isPlainObject(parsed)) return parsed;
    } catch {
      // Fall through to the human-readable table parser.
    }
  }
  const match = String(text ?? '').match(
    /All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/,
  );
  if (!match) return null;
  return {
    source: 'measured',
    statements: Number(match[1]),
    branches: Number(match[2]),
    functions: Number(match[3]),
    lines: Number(match[4]),
  };
}

const COVERAGE_FIELDS = Object.freeze(['statements', 'branches', 'functions', 'lines']);

function coverageMetricsFromSummary(summary) {
  const total = isPlainObject(summary?.total) ? summary.total : summary;
  if (!isPlainObject(total)) return null;
  const metrics = { source: 'measured', denominators: {} };
  for (const field of COVERAGE_FIELDS) {
    const entry = total[field];
    if (!isPlainObject(entry)) return null;
    const skippedValue = entry.skipped === undefined ? 0 : entry.skipped;
    if (
      !isFiniteNumber(entry.pct) ||
      !isFiniteNumber(entry.total) ||
      !isFiniteNumber(entry.covered) ||
      !isFiniteNumber(skippedValue)
    ) {
      return null;
    }
    const values = {
      total: entry.total,
      covered: entry.covered,
      skipped: skippedValue,
      pct: entry.pct,
    };
    metrics[field] = values.pct;
    metrics.denominators[field] = {
      total: values.total,
      covered: values.covered,
      skipped: values.skipped,
    };
  }
  return metrics;
}

function coverageMetricReasons(metrics) {
  const reasons = [];
  if (!isPlainObject(metrics) || metrics.source !== 'measured') {
    return ['coverage sem origem de medição'];
  }
  if (!isPlainObject(metrics.denominators)) {
    reasons.push('coverage sem denominadores medidos');
  }
  for (const field of COVERAGE_FIELDS) {
    const percentage = metrics[field];
    const denominator = metrics.denominators?.[field];
    if (!isFiniteNumber(percentage) || percentage < 0 || percentage > 100) {
      reasons.push(`coverage.${field} inválido`);
      continue;
    }
    if (!isPlainObject(denominator)) {
      reasons.push(`coverage.${field} sem denominador`);
      continue;
    }
    const total = denominator.total;
    const covered = denominator.covered;
    const skipped = denominator.skipped === undefined ? 0 : denominator.skipped;
    const effectiveTotal = total - skipped;
    if (!isFiniteNumber(total) || !Number.isInteger(total) || total <= 0 || !isFiniteNumber(covered) || !Number.isInteger(covered) || covered < 0 || covered > total) {
      reasons.push(`coverage.${field} com denominador inválido`);
      continue;
    }
    if (!isFiniteNumber(skipped) || !Number.isInteger(skipped) || skipped < 0 || skipped > total || effectiveTotal <= 0) {
      reasons.push(`coverage.${field} com skipped inválido`);
      continue;
    }
    const measured = (covered / effectiveTotal) * 100;
    if (Math.abs(measured - percentage) > 0.11) {
      reasons.push(`coverage.${field} diverge do denominador`);
    }
  }
  return reasons;
}

function readCoverageSummary(root, startedAt) {
  const candidates = [
    join(root, 'packages', 'shared', 'coverage', 'coverage-summary.json'),
    join(root, 'coverage', 'coverage-summary.json'),
    join(root, 'coverage-summary.json'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const stats = statSync(path);
    if (!stats.isFile() || stats.mtimeMs < startedAt.getTime()) continue;
    const parsed = parseJsonStrict(readFileSync(path, 'utf8'), path);
    if (!parsed.ok) continue;
    const metrics = coverageMetricsFromSummary(parsed.value);
    if (metrics) return { path, raw: readFileSync(path), metrics };
  }
  return null;
}

function validateManifestShape(manifest, check, candidate) {
  const reasons = [];
  if (!isPlainObject(manifest)) return ['manifesto sem objeto raiz'];
  if (manifest.schemaVersion !== SCHEMA_VERSION) reasons.push(`schemaVersion inesperado (${manifest.schemaVersion})`);
  if (manifest.check !== check.id) reasons.push(`check divergente (${manifest.check ?? 'ausente'} != ${check.id})`);
  if (typeof manifest.scope !== 'string' || manifest.scope.trim() === '') reasons.push('escopo ausente');
  if (typeof check.scope === 'string' && manifest.scope !== check.scope) {
    reasons.push(`escopo divergente (manifesto=${manifest.scope} esperado=${check.scope})`);
  }
  if (typeof manifest.command !== 'string' || manifest.command.trim() === '') reasons.push('comando ausente');
  if (typeof check.command === 'string' && manifest.command !== check.command) {
    reasons.push(`comando divergente (manifesto=${manifest.command} esperado=${check.command})`);
  }
  if (!MANIFEST_STATUSES.includes(manifest.status)) reasons.push(`status inválido (${manifest.status ?? 'ausente'})`);
  if (!isPlainObject(manifest.environment) || Object.keys(manifest.environment).length === 0) reasons.push('ambiente ausente');
  if (isPlainObject(manifest.environment)) {
    const execution = readExecutionIdentity(manifest.environment);
    if (!execution.runId) {
      reasons.push('ambiente sem runId');
    }
    if (!execution.attempt) {
      reasons.push('ambiente sem attempt');
    }
    const expectedExecution = readExecutionIdentity(candidate);
    if (expectedExecution.runId && execution.runId !== expectedExecution.runId) {
      reasons.push(`ambiente runId divergente (manifesto=${execution.runId ?? 'ausente'} atual=${expectedExecution.runId})`);
    }
    if (expectedExecution.attempt && execution.attempt !== expectedExecution.attempt) {
      reasons.push(`ambiente attempt divergente (manifesto=${execution.attempt ?? 'ausente'} atual=${expectedExecution.attempt})`);
    }
  }
  if (!isPlainObject(manifest.hashes)) {
    reasons.push('hashes ausentes');
  } else {
    if (!isSha256(manifest.hashes.lockfileSha256) || manifest.hashes.lockfileSha256 !== candidate?.lockfileSha256) {
      reasons.push('hash do lockfile ausente/divergente');
    }
    if (!isSha256(manifest.hashes.sourceSha256) || manifest.hashes.sourceSha256 !== candidate?.sourceSha256) {
      reasons.push('hash do source ausente/divergente');
    }
  }
  if (!Array.isArray(manifest.artifacts)) reasons.push('artefatos ausentes');
  const startedAt = isValidIso(manifest.startedAt) ? Date.parse(manifest.startedAt) : null;
  const finishedAt = isValidIso(manifest.finishedAt) ? Date.parse(manifest.finishedAt) : null;
  if (startedAt === null) reasons.push(`startedAt inválido (${manifest.startedAt ?? 'ausente'})`);
  if (finishedAt === null) reasons.push(`finishedAt inválido (${manifest.finishedAt ?? 'ausente'})`);
  if (startedAt !== null && startedAt > Date.now() + MANIFEST_FUTURE_SKEW_MS) reasons.push('startedAt no futuro fora da janela');
  if (finishedAt !== null && finishedAt > Date.now() + MANIFEST_FUTURE_SKEW_MS) reasons.push('finishedAt no futuro fora da janela');
  if (isValidIso(candidate?.sealedAt)) {
    const sealedAt = Date.parse(candidate.sealedAt);
    if (startedAt !== null && startedAt < sealedAt) reasons.push('startedAt anterior ao selo do candidato (STALE)');
    if (finishedAt !== null && finishedAt < sealedAt) reasons.push('finishedAt anterior ao selo do candidato (STALE)');
  } else {
    reasons.push('candidato sem sealedAt válido para a janela temporal');
  }
  if (startedAt !== null && finishedAt !== null && finishedAt < startedAt) reasons.push('janela temporal invertida');
  if (!isFiniteNumber(manifest.durationMs) || !Number.isInteger(manifest.durationMs) || manifest.durationMs < 0) reasons.push('durationMs inválido');
  if (manifest.status === 'PASS' && !check.artifact && !check.external) {
    if (manifest.exitCode !== 0) reasons.push(`exitCode inválido para PASS (${manifest.exitCode ?? 'ausente'})`);
    if (manifest.signal !== null && manifest.signal !== undefined) reasons.push(`signal inesperado para PASS (${manifest.signal})`);
    if (manifest.error !== null && manifest.error !== undefined) reasons.push('erro inesperado para PASS');
  }
  return reasons;
}

function isValidIso(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  const time = Date.parse(value);
  return Number.isFinite(time);
}

// Evidência futura não pertence ao candidato. A validação ocorre depois da
// emissão do artefato, portanto não há tolerância que possa transformar uma
// medição ainda não observada em PASS.
const PAYLOAD_FUTURE_SKEW_MS = 0;
const MANIFEST_FUTURE_SKEW_MS = 0;

function pickNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

/**
 * Identidade C10 do payload: fonte/lock/commit (e imagem quando exigida).
 * Aceita os campos canônicos no topo, aninhados em `candidate` ou os atalhos
 * `lock`/`source` (string ou objeto com `sha256`).
 */
function extractPayloadIdentity(payload) {
  const root = isPlainObject(payload) ? payload : {};
  const nested = isPlainObject(root.candidate) ? root.candidate : {};
  const lock = isPlainObject(root.lock) ? root.lock : {};
  const source = isPlainObject(root.source) ? root.source : {};
  return {
    commit: pickNonEmptyString(root.commit, nested.commit, root.repository?.commit, root.head_sha),
    lockfileSha256: pickNonEmptyString(
      root.lockfileSha256,
      nested.lockfileSha256,
      lock.sha256,
      typeof root.lock === 'string' ? root.lock : null,
    ),
    sourceSha256: pickNonEmptyString(
      root.sourceSha256,
      nested.sourceSha256,
      source.sha256,
      typeof root.source === 'string' ? root.source : null,
    ),
    imageDigest: pickNonEmptyString(root.imageDigest, root.image?.digest, nested.imageDigest),
  };
}

function payloadAuthoredAt(payload) {
  if (!isPlainObject(payload)) return null;
  for (const value of [payload.finishedAt, payload.generatedAt, payload.startedAt]) {
    if (isValidIso(value)) return value;
  }
  return null;
}

function payloadWindowReasons(payload, candidate, { now = Date.now() } = {}) {
  const reasons = [];
  const timestamps = ['startedAt', 'finishedAt', 'generatedAt'];
  const valid = new Map();
  const hasTimestamp = isPlainObject(payload) && timestamps.some((field) => payload[field] !== undefined);
  if (!hasTimestamp) {
    reasons.push('payload sem horário válido (generatedAt/finishedAt/startedAt ausente ou inválido)');
  }
  for (const field of timestamps) {
    if (!isPlainObject(payload) || payload[field] === undefined) continue;
    if (!isValidIso(payload[field])) {
      reasons.push(`payload.${field} inválido`);
      continue;
    }
    valid.set(field, Date.parse(payload[field]));
  }
  if (valid.size === 0 && hasTimestamp) {
    reasons.push('payload sem horário válido (generatedAt/finishedAt/startedAt ausente ou inválido)');
  }
  if (!isValidIso(candidate?.sealedAt)) {
    reasons.push('candidato sem sealedAt válido para a janela temporal');
  } else {
    const sealedAt = Date.parse(candidate.sealedAt);
    for (const [field, time] of valid) {
      if (time < sealedAt) {
        reasons.push(`payload.${field} anterior ao selo do candidato (STALE: ${payload[field]} < ${candidate.sealedAt})`);
      }
      if (time > now + PAYLOAD_FUTURE_SKEW_MS) {
        reasons.push(`payload.${field} com horário no futuro fora da janela do candidato (${payload[field]})`);
      }
    }
  }
  if (valid.has('startedAt') && valid.has('finishedAt') && valid.get('finishedAt') < valid.get('startedAt')) {
    reasons.push('janela temporal do payload invertida');
  }
  const authoredAt = payloadAuthoredAt(payload);
  return { reasons, authoredAt };
}

function measurementWindowReasons(measuredAt, candidate, { now = Date.now() } = {}) {
  const reasons = [];
  if (!isValidIso(measuredAt)) {
    reasons.push('medição sem horário válido');
    return reasons;
  }
  const time = Date.parse(measuredAt);
  if (!isValidIso(candidate?.sealedAt)) {
    reasons.push('candidato sem sealedAt válido para a janela temporal');
  } else if (time < Date.parse(candidate.sealedAt)) {
    reasons.push(`medição anterior ao selo do candidato (STALE: ${measuredAt} < ${candidate.sealedAt})`);
  }
  if (time > now + PAYLOAD_FUTURE_SKEW_MS) {
    reasons.push(`medição com horário no futuro fora da janela do candidato (${measuredAt})`);
  }
  return reasons;
}

function safeEvidencePath(evidenceDir, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') return null;
  const base = resolve(evidenceDir);
  const absolute = resolve(base, relativePath);
  if (absolute === base || !absolute.startsWith(`${base}${sep}`)) return null;
  return absolute;
}

export function validateArtifactPayload(check, { evidenceDir, candidate }) {
  const rule = check.evidence;
  const file = safeEvidencePath(evidenceDir, rule?.file);
  if (!file) {
    return {
      ok: false,
      status: 'INVALID',
      reasons: ['payload com caminho de evidência inválido'],
      payload: null,
      payloadSha256: null,
      identity: null,
    };
  }
  if (!existsSync(file)) {
    return { ok: false, status: 'MISSING', reasons: [`payload ausente (${rule.file})`], payload: null, payloadSha256: null, identity: null };
  }
  const parsed = parseJsonStrict(readFileSync(file, 'utf8'), rule.file);
  if (!parsed.ok) {
    return { ok: false, status: 'INVALID', reasons: [parsed.error], payload: null, payloadSha256: sha256File(file), identity: null };
  }
  const payload = parsed.value;
  const payloadSha256 = sha256File(file);
  const reasons = [];
  const identity = extractPayloadIdentity(payload);
  const execution = readExecutionIdentity(payload);
  const expectedExecution = readExecutionIdentity(candidate);

  if (!execution.runId) {
    reasons.push('payload sem runId válido');
  } else if (!expectedExecution.runId) {
    reasons.push('candidato sem runId esperado para o payload');
  } else if (execution.runId !== expectedExecution.runId) {
    reasons.push(`runId divergente no payload (payload=${execution.runId} atual=${expectedExecution.runId})`);
  }
  if (!execution.attempt) {
    reasons.push('payload sem attempt válido');
  } else if (!expectedExecution.attempt) {
    reasons.push('candidato sem attempt esperado para o payload');
  } else if (execution.attempt !== expectedExecution.attempt) {
    reasons.push(`attempt divergente no payload (payload=${execution.attempt} atual=${expectedExecution.attempt})`);
  }

  if (!isCommitSha(identity.commit)) {
    reasons.push('payload sem vínculo de candidato (commit ausente)');
  } else if (identity.commit !== candidate.commit) {
    reasons.push(`commit divergente (payload=${identity.commit} atual=${candidate.commit})`);
  }
  if (!isSha256(candidate?.lockfileSha256) || !isSha256(identity.lockfileSha256)) {
    reasons.push('lockfileSha256 ausente no payload (identidade C10 obrigatória)');
  } else if (identity.lockfileSha256 !== candidate.lockfileSha256) {
    reasons.push(
      `lockfileSha256 divergente no payload (payload=${identity.lockfileSha256} atual=${candidate.lockfileSha256 ?? 'ausente'})`,
    );
  }
  if (!isSha256(candidate?.sourceSha256) || !isSha256(identity.sourceSha256)) {
    reasons.push('sourceSha256 ausente no payload (identidade C10 obrigatória)');
  } else if (identity.sourceSha256 !== candidate.sourceSha256) {
    reasons.push(
      `sourceSha256 divergente no payload (payload=${identity.sourceSha256} atual=${candidate.sourceSha256 ?? 'ausente'})`,
    );
  }
  if (check.image) {
    if (!isSha256(String(candidate?.imageDigest ?? '').replace(/^sha256:/i, ''))) {
      reasons.push('candidato sem imageDigest (imagem esperada não definida)');
    } else if (typeof identity.imageDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/i.test(identity.imageDigest)) {
      reasons.push('imageDigest ausente no payload (imagem testada não comprovada)');
    } else if (candidate.imageDigest && identity.imageDigest !== candidate.imageDigest) {
      reasons.push(`imageDigest divergente (payload=${identity.imageDigest} atual=${candidate.imageDigest})`);
    }
  }

  reasons.push(...payloadWindowReasons(payload, candidate).reasons);

  const result = pickNonEmptyString(payload.result, payload.status);
  if (!result || result.toUpperCase() !== 'PASS') {
    reasons.push(`resultado do payload não é PASS (${result ?? 'ausente'})`);
  }

  if (rule.kind === 'coverage') {
    reasons.push(...coverageMetricReasons(payload.metrics));
  }

  if (rule.kind === 'queries') {
    if (!isPlainObject(payload.profile) || typeof payload.profile.name !== 'string' || payload.profile.name.trim() === '') {
      reasons.push('query-performance sem perfil');
    }
    if (!isPlainObject(payload.profile) || typeof payload.profile.dataset !== 'string' || payload.profile.dataset.trim() === '') {
      reasons.push('query-performance sem dataset');
    }
    const budget = payload.budget;
    const frozenBudget = rule.budget;
    const frozenBudgetValid =
      isPlainObject(frozenBudget) &&
      isFiniteNumber(frozenBudget.maxTotalCost) &&
      frozenBudget.maxTotalCost > 0 &&
      isFiniteNumber(frozenBudget.maxPlanRows) &&
      Number.isInteger(frozenBudget.maxPlanRows) &&
      frozenBudget.maxPlanRows > 0;
    if (!frozenBudgetValid) {
      reasons.push('query-performance sem orçamento congelado na regra');
    }
    const budgetValid =
      isPlainObject(budget) &&
      isFiniteNumber(budget.maxTotalCost) &&
      budget.maxTotalCost > 0 &&
      isFiniteNumber(budget.maxPlanRows) &&
      Number.isInteger(budget.maxPlanRows) &&
      budget.maxPlanRows > 0;
    if (!isPlainObject(budget) || !isFiniteNumber(budget.maxTotalCost) || budget.maxTotalCost <= 0) {
      reasons.push('query-performance sem orçamento de custo');
    }
    if (!isPlainObject(budget) || !isFiniteNumber(budget.maxPlanRows) || !Number.isInteger(budget.maxPlanRows) || budget.maxPlanRows <= 0) {
      reasons.push('query-performance sem orçamento de linhas');
    }
    if (frozenBudgetValid && (!budgetValid || budget.maxTotalCost !== frozenBudget.maxTotalCost || budget.maxPlanRows !== frozenBudget.maxPlanRows)) {
      reasons.push('query-performance com orçamento divergente do orçamento congelado');
    }
    const queries = payload.queries;
    const entries = Array.isArray(queries)
      ? queries.map((entry, index) => [String(entry?.name ?? entry?.id ?? index), entry])
      : isPlainObject(queries)
        ? Object.entries(queries)
        : null;
    const minEntries = rule.minEntries ?? 1;
    if (!Number.isInteger(minEntries) || minEntries <= 0) {
      reasons.push('query-performance com minEntries inválido');
    }
    if (!Array.isArray(rule.expectedEntries) || rule.expectedEntries.length === 0) {
      reasons.push('query-performance sem conjunto de queries esperado');
    }
    if (!entries || entries.length === 0 || entries.length < minEntries) {
      reasons.push(`conjunto de queries vazio ou insuficiente (${entries ? entries.length : 'ausente'} < ${minEntries})`);
    } else {
      const present = new Set();
      entries.forEach(([key, entry], index) => {
        if (!isPlainObject(entry)) {
          reasons.push(`query[${index}] sem objeto`);
          return;
        }
        const name = typeof entry.name === 'string' ? entry.name.trim() : '';
        if (!name) {
          reasons.push(`query[${index}] sem identidade/name`);
          return;
        }
        if (present.has(name)) {
          reasons.push(`query duplicada (${name})`);
        }
        present.add(name);
        if (typeof entry.sql !== 'string' || entry.sql.trim() === '') reasons.push(`query[${name}] sem SQL`);
        if (!((typeof entry.plan === 'string' && entry.plan.trim() !== '') || (isPlainObject(entry.plan) && Object.keys(entry.plan).length > 0))) {
          reasons.push(`query[${name}] sem plano`);
        }
        if (typeof entry.totalCost !== 'number' || !Number.isFinite(entry.totalCost) || entry.totalCost < 0) {
          reasons.push(`query[${name}] sem custo numérico medido`);
        }
        if (typeof entry.planRows !== 'number' || !Number.isFinite(entry.planRows) || !Number.isInteger(entry.planRows) || entry.planRows < 0) {
          reasons.push(`query[${name}] sem linhas inteiras medidas`);
        }
        reasons.push(...measurementWindowReasons(entry.measuredAt, candidate).map((reason) => `query[${name}] ${reason}`));
        if (!isPlainObject(entry.budget) || !isFiniteNumber(entry.budget.maxTotalCost) || !isFiniteNumber(entry.budget.maxPlanRows) || !Number.isInteger(entry.budget.maxPlanRows)) {
          reasons.push(`query[${name}] sem orçamento congelado`);
        } else {
          if (!budgetValid || entry.budget.maxTotalCost !== budget.maxTotalCost || entry.budget.maxPlanRows !== budget.maxPlanRows) {
            reasons.push(`query[${name}] orçamento divergente do orçamento congelado`);
          }
        }
        if (entry.acceptable !== true) reasons.push(`query[${name}] não aceitável`);
        const measuredWithinBudget =
          isFiniteNumber(entry.totalCost) &&
          isFiniteNumber(entry.planRows) &&
          Number.isInteger(entry.planRows) &&
          budgetValid &&
          entry.totalCost <= (frozenBudget?.maxTotalCost ?? budget.maxTotalCost) &&
          entry.planRows <= (frozenBudget?.maxPlanRows ?? budget.maxPlanRows);
        if (entry.withinBudget !== measuredWithinBudget) {
          reasons.push(`query[${name}] aderência ao orçamento contraditória`);
        }
        if (!measuredWithinBudget) reasons.push(`query[${name}] fora do orçamento`);
        if (entry.error) reasons.push(`query[${index}] com erro`);
      });
      for (const expected of rule.expectedEntries ?? []) {
        if (!present.has(expected)) reasons.push(`query obrigatória ausente (${expected})`);
      }
    }
  }

  return {
    ok: reasons.length === 0,
    status: reasons.length === 0 ? 'PASS' : 'INVALID',
    reasons,
    payload,
    payloadSha256,
    identity,
    execution,
  };
}

export function deriveArtifactManifest(check, { evidenceDir, candidate }) {
  const evaluated = validateArtifactPayload(check, { evidenceDir, candidate });
  const file = safeEvidencePath(evidenceDir, check.evidence?.file);
  const stat = file && existsSync(file) ? statSync(file) : null;
  const fallbackTime = stat ? stat.mtime.toISOString() : new Date().toISOString();
  const payload = evaluated.payload ?? {};
  const authoredAt = payloadWindowReasons(payload, candidate).authoredAt;
  const execution = evaluated.execution ?? readExecutionIdentity(payload);
  const startedAt = isValidIso(payload.startedAt) ? payload.startedAt : fallbackTime;
  const finishedAt = authoredAt ?? fallbackTime;
  const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
  return {
    schemaVersion: SCHEMA_VERSION,
    check: check.id,
    scope: check.scope,
    command: `artifact:${check.evidence.file}`,
    status: evaluated.ok ? 'PASS' : evaluated.status,
    startedAt,
    finishedAt,
    durationMs: Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0,
    environment: {
      kind: 'external-artifact',
      producer: check.producer ?? 'unknown',
      runId: execution.runId,
      attempt: execution.attempt,
    },
    // Campos do payload sem fallback silencioso para o candidato: ausência de
    // identidade no artefato precisa aparecer no relatório (M2).
    candidate: {
      ...(evaluated.identity ?? {}),
      runId: execution.runId,
      attempt: execution.attempt,
      sealedAt: candidate.sealedAt ?? null,
    },
    hashes: {
      payload: evaluated.payloadSha256,
      lockfileSha256: candidate.lockfileSha256 ?? null,
      sourceSha256: candidate.sourceSha256 ?? null,
      log: null,
    },
    artifacts: [{ path: check.evidence?.file ?? null, sha256: evaluated.payloadSha256 }],
    metrics: null,
    reasons: evaluated.reasons,
  };
}

export function runCheck(check, { root, evidenceDir, candidate, env = {}, defaultTimeoutMs = 1_500_000 }) {
  const startedAt = new Date();
  const logDir = join(evidenceDir, 'logs');
  mkdirSync(logDir, { recursive: true });
  const logRel = `logs/${check.id}.log`;
  const logPath = join(evidenceDir, logRel);
  const timeoutMs = Number(check.timeoutMs ?? defaultTimeoutMs);
  const executionEnv = { ...process.env, ...env, ...(check.env ?? {}) };
  const result = spawnSync('/bin/sh', ['-c', check.command], {
    cwd: root,
    env: executionEnv,
    encoding: 'buffer',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  const finishedAt = new Date();
  const stdout = result.stdout ?? Buffer.alloc(0);
  const stderr = result.stderr ?? Buffer.alloc(0);
  const output = Buffer.concat([stdout, stderr]).toString('utf8');
  const logBody = [
    `$ ${check.command}`,
    `# scope: ${check.scope}`,
    `# startedAt: ${startedAt.toISOString()}`,
    `# finishedAt: ${finishedAt.toISOString()}`,
    '',
    output,
  ].join('\n');
  writeFileSync(logPath, logBody);

  let status;
  let error = null;
  if (result.error && result.error.code === 'ETIMEDOUT') {
    status = 'BLOCKED';
    error = `timeout após ${timeoutMs}ms`;
  } else if (result.error) {
    status = 'BLOCKED';
    error = `falha ao executar: ${result.error.message}`;
  } else if (result.status === 0) {
    status = 'PASS';
  } else {
    status = 'FAIL';
    error = `exit=${result.status}${result.signal ? ` signal=${result.signal}` : ''}`;
  }

  const isCoverage = check.evidence?.kind === 'coverage' || check.metrics === 'coverage';
  let metrics = isCoverage ? parseCoverageMetrics(output) : null;
  let coverageArtifact = null;
  if (isCoverage) {
    const summary = readCoverageSummary(root, startedAt);
    if (summary) {
      metrics = summary.metrics;
      const summaryRel = `coverage/${check.id}-summary.json`;
      const summaryPath = join(evidenceDir, summaryRel);
      mkdirSync(join(evidenceDir, 'coverage'), { recursive: true });
      writeFileSync(summaryPath, summary.raw);
      coverageArtifact = { path: summaryRel, sha256: sha256File(summaryPath), kind: 'coverage-summary' };
    }
  }

  let payloadArtifact = null;
  if (check.evidence?.file) {
    const payloadPath = safeEvidencePath(evidenceDir, check.evidence.file);
    if (payloadPath && existsSync(payloadPath) && statSync(payloadPath).isFile()) {
      payloadArtifact = { path: check.evidence.file, sha256: sha256File(payloadPath), kind: 'payload' };
    }
  }

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    check: check.id,
    scope: check.scope,
    command: check.command,
    status,
    exitCode: result.status ?? null,
    signal: result.signal ?? null,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: resolve(root),
      ci: Boolean(executionEnv.CI),
      runId: executionEnv.GITHUB_RUN_ID ?? null,
      attempt: executionEnv.GITHUB_RUN_ATTEMPT ?? null,
    },
    candidate: { ...candidate },
    hashes: {
      log: sha256File(logPath),
      lockfileSha256: candidate.lockfileSha256,
      sourceSha256: candidate.sourceSha256,
      payload: payloadArtifact?.sha256 ?? null,
    },
    artifacts: [
      { path: logRel, sha256: sha256File(logPath), kind: 'log' },
      ...(coverageArtifact ? [coverageArtifact] : []),
      ...(payloadArtifact ? [payloadArtifact] : []),
    ],
    metrics,
    error,
  };
  const manifestPath = join(evidenceDir, `${check.id}.json`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function evaluateCheck(check, { evidenceDir, candidate, withExternal }) {
  if (check.external && !withExternal) {
    return {
      id: check.id,
      required: false,
      status: 'NOT_EVALUATED',
      reasons: ['check externo não incluído (--with-external-evidence ausente)'],
      manifestPath: null,
      metrics: null,
    };
  }
  const required = check.required !== false;

  const manifestPath = join(evidenceDir, `${check.id}.json`);
  if (check.artifact || check.external) {
    if (!existsSync(manifestPath)) {
      const derived = deriveArtifactManifest(check, { evidenceDir, candidate });
      return {
        id: check.id,
        required,
        status: derived.status,
        reasons: derived.reasons,
        manifestPath: null,
        metrics: derived.metrics,
        derivedManifest: derived,
      };
    }
  }

  if (!existsSync(manifestPath)) {
    return { id: check.id, required, status: 'MISSING', reasons: [`manifesto ausente (${check.id}.json)`], manifestPath: null, metrics: null };
  }
  const parsed = parseJsonStrict(readFileSync(manifestPath, 'utf8'), `${check.id}.json`);
  if (!parsed.ok) {
    return { id: check.id, required, status: 'INVALID', reasons: [parsed.error], manifestPath, metrics: null };
  }
  const manifest = parsed.value;
  const reasons = validateManifestShape(manifest, check, candidate);
  reasons.push(...bindingMismatches(manifest.candidate, candidate));

  if (check.image && !/^sha256:[0-9a-f]{64}$/i.test(String(candidate?.imageDigest ?? ''))) {
    reasons.push('candidato sem imageDigest válido (imagem esperada não definida)');
  }
  if (check.image && !/^sha256:[0-9a-f]{64}$/i.test(String(manifest.candidate?.imageDigest ?? ''))) {
    reasons.push('imageDigest ausente no manifesto (imagem testada não comprovada)');
  }
  if (check.image && manifest.candidate?.imageDigest !== candidate?.imageDigest) {
    reasons.push('imageDigest divergente no manifesto');
  }

  if (manifest.status !== 'PASS') {
    reasons.push(`status ${manifest.status} não aceito para check requerido`);
    const reported = MANIFEST_STATUSES.includes(manifest.status) ? manifest.status : 'INVALID';
    return { id: check.id, required, status: reported, reasons, manifestPath, metrics: manifest.metrics ?? null };
  }

  const logEntry = Array.isArray(manifest.artifacts)
    ? manifest.artifacts.find((entry) => entry?.kind === 'log' || /\.log$/.test(String(entry?.path ?? '')))
    : null;
  if (manifest.hashes?.log) {
    if (!logEntry) {
      reasons.push('artefato de log não declarado apesar de hash presente');
    } else {
      const logPath = safeEvidencePath(evidenceDir, logEntry.path);
      if (!logPath) {
        reasons.push(`caminho de log inválido (${logEntry.path ?? 'ausente'})`);
      } else if (!isSha256(manifest.hashes.log)) {
        reasons.push('hash do log inválido');
      } else if (logEntry.sha256 !== manifest.hashes.log) {
        reasons.push(`hash declarado no artefato de log divergente (${logEntry.path})`);
      } else if (!existsSync(logPath)) {
        reasons.push(`log ausente (${logEntry.path}) — PASS narrativo rejeitado`);
      } else if (!statSync(logPath).isFile() || statSync(logPath).size === 0) {
        reasons.push(`log vazio (${logEntry.path}) — PASS narrativo rejeitado`);
      } else if (sha256File(logPath) !== manifest.hashes.log) {
        reasons.push(`hash do log divergente (${logEntry.path})`);
      }
    }
  } else {
    reasons.push('hash do log ausente — PASS narrativo rejeitado');
  }

  if (isValidIso(manifest.finishedAt) && isValidIso(candidate.sealedAt) && Date.parse(manifest.finishedAt) < Date.parse(candidate.sealedAt)) {
    reasons.push('evidência anterior ao selo do candidato (STALE)');
  }

  if (check.evidence?.file) {
    const payload = validateArtifactPayload(check, { evidenceDir, candidate });
    reasons.push(...payload.reasons);
    if (payload.payloadSha256) {
      if (!isSha256(manifest.hashes?.payload) || manifest.hashes.payload !== payload.payloadSha256) {
        reasons.push('hash do payload ausente/divergente');
      }
      const payloadEntry = Array.isArray(manifest.artifacts)
        ? manifest.artifacts.find((entry) => entry?.path === check.evidence.file)
        : null;
      if (!payloadEntry) {
        reasons.push(`artefato de payload não declarado (${check.evidence.file})`);
      } else if (payloadEntry.sha256 !== payload.payloadSha256) {
        reasons.push(`hash do artefato de payload divergente (${check.evidence.file})`);
      }
    }
  }
  if (check.evidence?.kind === 'coverage' || check.metrics === 'coverage') {
    reasons.push(...coverageMetricReasons(manifest.metrics));
    const logPath = logEntry ? safeEvidencePath(evidenceDir, logEntry.path) : null;
    const measured = logPath && existsSync(logPath) ? parseCoverageMetrics(readFileSync(logPath, 'utf8')) : null;
    if (!measured) {
      reasons.push('coverage sem tabela de medição no log');
    } else {
      for (const field of COVERAGE_FIELDS) {
        if (Number(measured[field]) !== Number(manifest.metrics?.[field])) {
          reasons.push(`coverage.${field} diverge entre manifesto e log`);
        }
      }
    }
  }
  const status = reasons.length === 0 ? 'PASS' : 'INVALID';
  return {
    id: check.id,
    required,
    status,
    reasons,
    manifestPath,
    metrics: manifest.metrics ?? null,
    derivedManifest: null,
  };
}

export function evaluateGate({ checks, evidenceDir, candidate, withExternal = false, artifactDir = null, root = null }) {
  const safeCandidate = isPlainObject(candidate) ? candidate : {};
  const checkList = Array.isArray(checks) ? checks : [];
  const checkIds = checkList.map((check) => check?.id).filter((id) => typeof id === 'string');
  const inventoryReasons = [];
  if (checkList.length === 0) inventoryReasons.push('nenhum check definido; conjunto de evidências vazio');
  if (checkList.some((check) => !isPlainObject(check) || typeof check.id !== 'string' || check.id.trim() === '')) {
    inventoryReasons.push('check inválido no inventário');
  }
  if (new Set(checkIds).size !== checkIds.length) inventoryReasons.push('check duplicado no inventário');
  if (checkList.every((check) => check?.required === false)) inventoryReasons.push('nenhum check requerido no inventário');
  if (!checkList.some((check) => check?.required !== false && (!check.external || withExternal))) {
    inventoryReasons.push('nenhum check requerido foi avaliado');
  }
  const execution = readExecutionIdentity(safeCandidate);
  if (!isCommitSha(safeCandidate.commit)) inventoryReasons.push('candidato sem commit SHA válido');
  if (!isSha256(safeCandidate.lockfileSha256)) inventoryReasons.push('candidato sem lockfileSha256 válido');
  if (!isSha256(safeCandidate.sourceSha256)) inventoryReasons.push('candidato sem sourceSha256 válido');
  if (!execution.runId) inventoryReasons.push('candidato sem runId válido');
  if (!execution.attempt) inventoryReasons.push('candidato sem attempt válido');
  if (!isValidIso(safeCandidate.sealedAt)) inventoryReasons.push('candidato sem sealedAt válido');
  if (safeCandidate.imageDigest !== null && safeCandidate.imageDigest !== undefined && !/^sha256:[0-9a-f]{64}$/i.test(String(safeCandidate.imageDigest))) {
    inventoryReasons.push('candidato com imageDigest inválido');
  }

  const results = inventoryReasons.length > 0
    ? []
    : checkList.map((check) => evaluateCheck(check, { evidenceDir, candidate: safeCandidate, withExternal }));
  const gates = {};
  const manifestBase = root ? resolve(root) : resolve(evidenceDir, '..', '..');
  const counts = { pass: 0, fail: 0, blocked: 0, notRun: 0, skipped: 0, invalid: 0, missing: 0, notEvaluated: 0 };
  for (const result of results) {
    gates[result.id] = {
      required: result.required,
      status: result.status,
      reasons: result.reasons,
      manifest: result.manifestPath ? toPosix(relative(manifestBase, result.manifestPath)) : null,
      metrics: result.metrics ?? null,
    };
    if (result.status === 'PASS') counts.pass += 1;
    else if (result.status === 'FAIL') counts.fail += 1;
    else if (result.status === 'BLOCKED') counts.blocked += 1;
    else if (result.status === 'NOT_RUN') counts.notRun += 1;
    else if (result.status === 'SKIPPED') counts.skipped += 1;
    else if (result.status === 'INVALID') counts.invalid += 1;
    else if (result.status === 'MISSING') counts.missing += 1;
    else if (result.status === 'NOT_EVALUATED') counts.notEvaluated += 1;
  }
  if (inventoryReasons.length > 0) {
    gates['gate-contract'] = {
      required: true,
      status: 'INVALID',
      reasons: inventoryReasons,
      manifest: null,
      metrics: null,
    };
    counts.invalid += 1;
  }
  const requiredResults = results.filter((result) => result.required);
  const rejected = requiredResults.filter((result) => result.status !== 'PASS');
  if (inventoryReasons.length > 0) {
    rejected.push({ id: 'gate-contract', status: 'INVALID', reasons: inventoryReasons });
  }
  const state = rejected.length === 0 ? 'VERIFIED_CANDIDATE' : 'FAILED';
  const report = {
    schemaVersion: SCHEMA_VERSION,
    repository: safeCandidate.repository,
    commit: safeCandidate.commit,
    lockfileSha256: safeCandidate.lockfileSha256,
    sourceSha256: safeCandidate.sourceSha256,
    imageDigest: safeCandidate.imageDigest ?? null,
    runId: execution.runId,
    attempt: execution.attempt,
    sealedAt: safeCandidate.sealedAt,
    timestamp: new Date().toISOString(),
    evidenceDir: toPosix(resolve(evidenceDir)),
    withExternalEvidence: withExternal,
    counts,
    gates,
    final: state,
    state,
    rejected: rejected.map((result) => ({ check: result.id, status: result.status, reasons: result.reasons })),
    certification: { ...CERTIFICATION_POLICY },
    honesty:
      'Somente PASS vinculado ao mesmo candidato (commit/lock/source) com manifesto e log verificado. Ausência/FAIL/BLOCKED/NOT_RUN/SKIPPED/INVALID/MISSING de check requerido = FAILED, exit != 0. É vedado percentual de cobertura fixo: métricas vêm da medição.',
  };
  if (artifactDir) report.artifactDir = toPosix(resolve(artifactDir));
  return report;
}

export function renderGateMarkdown(report) {
  const lines = [
    `# Triple AAA Report — ${String(report.commit ?? 'sem-sha').slice(0, 12)}`,
    '',
    `- State: **${report.state}**`,
    `- Commit: ${report.commit ?? 'ausente'}`,
    `- lockfileSha256: ${report.lockfileSha256 ?? 'ausente'}`,
    `- sourceSha256: ${report.sourceSha256 ?? 'ausente'}`,
    `- imageDigest: ${report.imageDigest ?? 'não exigido'}`,
    `- Sealed at: ${report.sealedAt}`,
    `- External evidence: ${report.withExternalEvidence ? 'incluída' : 'não incluída (checks externos NOT_EVALUATED)'}`,
    '',
    '| Check | Required | Status | Detalhe |',
    '|---|---|---|---|',
  ];
  for (const [id, gate] of Object.entries(report.gates)) {
    const detail = gate.reasons.length > 0 ? gate.reasons.join('; ') : 'ok';
    lines.push(`| ${id} | ${gate.required ? 'sim' : 'não'} | ${gate.status} | ${detail} |`);
  }
  const measured = Object.entries(report.gates)
    .filter(([, gate]) => gate.metrics)
    .map(([id, gate]) => `${id}: ${JSON.stringify(gate.metrics)}`);
  lines.push('', `Métricas medidas: ${measured.length > 0 ? measured.join(' · ') : 'nenhuma'}`);
  lines.push('', `Certificação: ${report.certification.state} — ${report.certification.reason}`);
  lines.push('', `Honestidade: ${report.honesty}`);
  return `${lines.join('\n')}\n`;
}

export function writeGateReports(artifactsDir, report) {
  mkdirSync(artifactsDir, { recursive: true });
  const jsonPath = join(artifactsDir, 'triple-aaa-report.json');
  const mdPath = join(artifactsDir, 'triple-aaa-report.md');
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, renderGateMarkdown(report));
  return { jsonPath, mdPath };
}

export function readChecksFile(path) {
  const parsed = parseJsonStrict(readFileSync(path, 'utf8'), 'checks-file');
  if (!parsed.ok) throw new Error(parsed.error);
  if (!Array.isArray(parsed.value)) throw new Error('checks-file precisa ser um array');
  if (parsed.value.length === 0) throw new Error('checks-file não pode ser vazio');
  const ids = new Set();
  for (const check of parsed.value) {
    if (!isPlainObject(check) || typeof check.id !== 'string' || check.id.trim() === '') {
      throw new Error('check inválido: id obrigatório');
    }
    if (ids.has(check.id)) throw new Error(`check duplicado: ${check.id}`);
    ids.add(check.id);
    if (check.required !== undefined && typeof check.required !== 'boolean') {
      throw new Error(`check inválido (${check.id}): required precisa ser booleano`);
    }
    if (!check.external && !check.artifact && (typeof check.command !== 'string' || check.command.trim() === '')) {
      throw new Error('check inválido: id e comando (ou artifact/external) obrigatórios');
    }
    if ((check.external || check.artifact) && (!isPlainObject(check.evidence) || typeof check.evidence.file !== 'string' || check.evidence.file.trim() === '')) {
      throw new Error(`check inválido (${check.id}): artifact/external exige evidence.file`);
    }
    if (check.evidence?.kind === 'queries') {
      const budget = check.evidence.budget;
      if (!Number.isInteger(check.evidence.minEntries) || check.evidence.minEntries <= 0) {
        throw new Error(`check inválido (${check.id}): minEntries de queries inválido`);
      }
      if (!Array.isArray(check.evidence.expectedEntries) || check.evidence.expectedEntries.length === 0) {
        throw new Error(`check inválido (${check.id}): expectedEntries de queries ausente`);
      }
      if (!isPlainObject(budget) || !isFiniteNumber(budget.maxTotalCost) || budget.maxTotalCost <= 0 || !isFiniteNumber(budget.maxPlanRows) || !Number.isInteger(budget.maxPlanRows) || budget.maxPlanRows <= 0) {
        throw new Error(`check inválido (${check.id}): orçamento de queries inválido`);
      }
    }
  }
  if (parsed.value.every((check) => check.required === false)) throw new Error('checks-file não pode ter apenas checks opcionais');
  return parsed.value;
}

/**
 * Guarda de isolamento de banco (L2): os defaults nunca apontam para a
 * instância do host (`5432`/`connect_desk_db`). A prova só roda com um
 * DATABASE_URL de run descartável `cvg_aaa_<runId>` em porta dedicada local;
 * caso contrário falha com mensagem inequívoca antes de tocar o banco.
 */
export const DATABASE_ISOLATION_MARKER = 'cvg_aaa_';
export const DATABASE_ISOLATION_GUARD =
  'node -e "' +
  "const raw=process.env.DATABASE_URL||'';" +
  "const fail=(reason)=>{console.error('[gate] run isolado exige DATABASE_URL com banco cvg_aaa_<runId> em porta dedicada local; nunca 5432/connect_desk_db: '+reason);process.exit(78);};" +
  "let url=null;try{url=new URL(raw);}catch{fail('URL ausente/inválida '+JSON.stringify(raw));}" +
  "if(!url)process.exit(78);" +
  "if(!/^postgres(ql)?:$/.test(url.protocol))fail('protocolo '+url.protocol+' não é postgresql');" +
  "const db=decodeURIComponent(url.pathname.replace(/^\\//,''));" +
  "if(!/^cvg_aaa_[A-Za-z0-9_]+$/.test(db))fail('banco sem marcador cvg_aaa_*: '+db);" +
  "if(!url.port||url.port==='5432')fail('porta '+(url.port||'padrão 5432')+' é a instância do host');" +
  "if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))fail('host não local: '+url.hostname);" +
  "console.log('[gate] banco isolado ok: '+url.hostname+':'+url.port+'/'+db);" +
  '"';

export const DEFAULT_CHECKS = Object.freeze([
  {
    id: 'runtime',
    required: true,
    scope: 'runtime Node 24.x do candidato',
    command:
      'node -e "const v=process.versions.node; if (!v.startsWith(\'24.\')) { console.error(\'expected Node 24.x, got \'+v); process.exit(1); } console.log(\'node \'+v);"',
  },
  { id: 'install', required: true, scope: 'instalação com lockfile congelado', command: 'pnpm install --frozen-lockfile', timeoutMs: 1_200_000 },
  { id: 'lint', required: true, scope: 'lint repo-wide (turbo)', command: 'pnpm lint', timeoutMs: 1_200_000 },
  { id: 'typecheck', required: true, scope: 'typecheck por pacote (turbo)', command: 'pnpm typecheck', timeoutMs: 1_200_000 },
  {
    id: 'unit',
    required: true,
    scope: 'testes unitários/macro (test:ci) em banco isolado cvg_aaa_<runId>',
    command: `${DATABASE_ISOLATION_GUARD} && pnpm test:ci`,
    timeoutMs: 1_500_000,
  },
  {
    id: 'postgres-real',
    required: true,
    scope: 'suítes PostgreSQL reais em banco isolado cvg_aaa_<runId>',
    command: `${DATABASE_ISOLATION_GUARD} && pnpm test:postgres-real`,
    timeoutMs: 1_500_000,
  },
  {
    id: 'migration-check',
    required: true,
    scope: 'migrations em banco fresh isolado cvg_aaa_<runId>',
    command: `${DATABASE_ISOLATION_GUARD} && pnpm --filter @cvg/database db:check`,
    timeoutMs: 900_000,
  },
  { id: 'build', required: true, scope: 'build macro (turbo)', command: 'pnpm build', timeoutMs: 1_200_000 },
  { id: 'security-audit', required: true, scope: 'auditoria de dependências (high)', command: 'pnpm security:audit', timeoutMs: 300_000 },
  { id: 'security-audit-prod', required: true, scope: 'auditoria de dependências de produção (high)', command: 'pnpm security:audit:prod', timeoutMs: 300_000 },
  {
    id: 'coverage',
    required: true,
    scope: 'coverage medido do pacote shared (global pendente PROD-34; nenhum percentual fixo)',
    command: 'pnpm --filter @cvg/shared exec vitest run --coverage',
    timeoutMs: 600_000,
    evidence: { kind: 'coverage' },
    metrics: 'coverage',
  },
  {
    id: 'dr-e2e',
    required: true,
    artifact: true,
    scope: 'DR end-to-end (backup/restore) no mesmo candidato',
    producer: 'infra/scripts/dr-e2e.sh',
    evidence: { kind: 'json-result', file: 'artifacts/dr-e2e-report.json' },
  },
  {
    id: 'staging-otel',
    required: true,
    artifact: true,
    scope: 'staging real (MinIO+ClamAV+OTel) no mesmo candidato',
    producer: 'scripts/staging-smoke.mjs',
    evidence: { kind: 'json-result', file: 'artifacts/staging-otel.json' },
  },
  {
    id: 'query-performance',
    required: true,
    artifact: true,
    scope: 'query-performance com conjunto de queries não vazio',
    producer: 'infra/scripts/query-performance.mjs',
      evidence: {
        kind: 'queries',
        file: 'artifacts/query-performance.json',
        minEntries: 11,
        budget: QUERY_PERFORMANCE_BUDGET,
        expectedEntries: [
        'messages.byConv',
        'messages.latestByConvs',
        'conversations.forUser',
        'conversations.list',
        'tasks.byAssignee',
        'alerts.active',
        'audit.byEntity',
        'outbox.pending',
        'sessions.byToken',
        'contacts.byPhone',
        'dlq.pending',
      ],
    },
  },
  {
    id: 'external-codeql',
    required: true,
    external: true,
    scope: 'CodeQL no SHA (evidência CI)',
    evidence: { kind: 'json-result', file: 'artifacts/ci-evidence/codeql.json' },
  },
  {
    id: 'external-gitleaks',
    required: true,
    external: true,
    scope: 'Gitleaks no SHA (evidência CI)',
    evidence: { kind: 'json-result', file: 'artifacts/ci-evidence/gitleaks.json' },
  },
  {
    id: 'external-trivy',
    required: true,
    external: true,
    scope: 'Trivy no SHA (evidência CI)',
    evidence: { kind: 'json-result', file: 'artifacts/ci-evidence/trivy.json' },
  },
  {
    id: 'external-sbom',
    required: true,
    external: true,
    scope: 'SBOM no SHA (evidência CI)',
    evidence: { kind: 'json-result', file: 'artifacts/ci-evidence/sbom.json' },
  },
  {
    id: 'external-e2e',
    required: true,
    external: true,
    scope: 'E2E no SHA (evidência CI)',
    evidence: { kind: 'json-result', file: 'artifacts/ci-evidence/e2e.json' },
  },
]);

export function summarizeRejections(report) {
  return report.rejected.map((entry) => `${entry.check}=${entry.status} (${entry.reasons.join('; ')})`).join(' | ');
}
