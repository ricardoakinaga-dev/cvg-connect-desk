#!/usr/bin/env node
/**
 * Certification aggregator (§3–4, §28) — PROD-03.
 *
 * Consulta a API de runs/jobs do SHA com paginação, valida o evento
 * (pull_request | push | schedule | release) e calcula o estado REAL de
 * promoção. Regras:
 * - run fora do SHA, cancelada/stale, job duplicado/renomeado, skip indevido e
 *   payload malformado reprovam conforme a política do evento.
 * - check de imagem exige evidência de digest vinculada ao mesmo candidato.
 * - dependency-review (só PR) é dispensado em push/release SOMENTE com
 *   substituto explícito (audit) verde; nunca em silêncio.
 * - cobertura global e carga são inventário declarado; ausência bloqueia
 *   release com dono e motivo explícitos.
 * - TRIPLE_AAA_CERTIFIED não é emitido aqui: exige tag/política de release.
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveCandidate } from '../../scripts/production/evidence-gate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
export const REPOSITORY = 'ricardoakinaga-dev/cvg-connect-desk';

export const EVENTS = Object.freeze(['pull_request', 'push', 'schedule', 'release']);

/**
 * Inventário requerido. `wf` = nome do workflow, `match` = regex do job.
 * `events` = eventos em que o gate é requerido. `pending` marca gate ainda não
 * implementado, com dono e motivo — nunca dispensado em silêncio.
 * `image: true` exige artefato de digest no mesmo candidato.
 */
export const REQUIRED = [
  // ---- qualidade (CI Quality Gate) ----
  { gate: 'lint', wf: 'CI Quality Gate', match: /Lint \(real/i, scope: 'lint', events: ['pull_request', 'push', 'release'] },
  { gate: 'typecheck', wf: 'CI Quality Gate', match: /Typecheck \(real/i, scope: 'typecheck', events: ['pull_request', 'push', 'release'] },
  { gate: 'unit', wf: 'CI Quality Gate', match: /Unit tests/i, scope: 'unit', events: ['pull_request', 'push', 'release'] },
  { gate: 'integration', wf: 'CI Quality Gate', match: /Integration tests/i, scope: 'integration', events: ['pull_request', 'push', 'release'] },
  { gate: 'contracts', wf: 'CI Quality Gate', match: /Contract tests/i, scope: 'contracts', events: ['pull_request', 'push', 'release'] },
  { gate: 'coverage-shared', wf: 'CI Quality Gate', match: /Coverage \(shared/i, scope: 'coverage-shared', events: ['pull_request', 'push', 'release'] },
  {
    gate: 'coverage-global',
    wf: 'CI Quality Gate',
    match: /Coverage \(global/i,
    scope: 'coverage-global',
    events: ['release'],
    pending: { owner: 'PROD-34', reason: 'coverage global por escopo ainda não implementado no CI (doc25: global≥75)' },
  },
  { gate: 'migrations-fresh', wf: 'CI Quality Gate', match: /Migration check \(fresh/i, scope: 'migrations-fresh', events: ['pull_request', 'push', 'release'] },
  { gate: 'build', wf: 'CI Quality Gate', match: /^Build \(real/i, scope: 'build', events: ['pull_request', 'push', 'release'] },
  { gate: 'audit', wf: 'CI Quality Gate', match: /Dependency audit/i, scope: 'audit', events: ['pull_request', 'push', 'release'] },
  // ---- docker/boot ----
  { gate: 'docker', wf: 'CI Quality Gate', match: /Docker build/i, scope: 'docker', events: ['pull_request', 'push', 'release'] },
  { gate: 'ci-aggregate', wf: 'CI Quality Gate', match: /Aggregate gate/i, scope: 'aggregate', events: ['pull_request', 'push', 'release'] },
  { gate: 'image-identity', wf: 'Triple AAA Gate', match: /Image identity/i, scope: 'docker-boot-image', events: ['pull_request', 'push', 'release'], image: true },
  { gate: 'boot-smoke', wf: 'Smoke E2E', match: /Smoke E2E Tests/i, scope: 'boot-e2e', events: ['pull_request', 'push', 'release'] },
  { gate: 'sbom-ci', wf: 'CI Quality Gate', match: /SBOM \(CycloneDX workspace\)/i, scope: 'sbom', events: ['pull_request', 'push', 'release'] },
  // ---- dados / migrations upgrade distinto ----
  { gate: 'postgres-real', wf: 'PostgreSQL Real Tests', match: /PostgreSQL Real Suites/i, scope: 'postgres-real', events: ['pull_request', 'push', 'release'] },
  { gate: 'migrations-upgrade', wf: 'Triple AAA Gate', match: /Migration upgrade/i, scope: 'migrations-upgrade', events: ['pull_request', 'push', 'release'] },
  // ---- segurança (Supply Chain Security) ----
  { gate: 'codeql', wf: 'Supply Chain Security', match: /CodeQL/i, scope: 'security-sast', events: ['pull_request', 'push', 'schedule', 'release'] },
  { gate: 'gitleaks', wf: 'Supply Chain Security', match: /Gitleaks|Secret scan/i, scope: 'security-secrets', events: ['pull_request', 'push', 'schedule', 'release'] },
  { gate: 'trivy', wf: 'Supply Chain Security', match: /Container scan/i, scope: 'security-containers', events: ['pull_request', 'push', 'schedule', 'release'] },
  { gate: 'sbom-security', wf: 'Supply Chain Security', match: /SBOM \(CycloneDX\)/i, scope: 'security-sbom', events: ['pull_request', 'push', 'schedule', 'release'] },
  { gate: 'pnpm-audit-security', wf: 'Supply Chain Security', match: /pnpm audit/i, scope: 'security-audit', events: ['pull_request', 'push', 'schedule', 'release'] },
  {
    gate: 'dependency-review',
    wf: 'Supply Chain Security',
    match: /Dependency review/i,
    scope: 'security-dependency-review',
    events: ['pull_request'],
    waiverFor: ['push', 'release'],
    substitute: 'audit',
  },
  { gate: 'critical-gates', wf: 'Triple AAA Gate', match: /Critical gates/i, scope: 'gate-critical', events: ['pull_request', 'push', 'release'] },
  { gate: 'security-gate', wf: 'Triple AAA Gate', match: /Security gate/i, scope: 'gate-security', events: ['pull_request', 'push', 'release'] },
  { gate: 'promotion-state', wf: 'Triple AAA Gate', match: /Promotion state/i, scope: 'gate-aggregate', events: ['pull_request', 'push', 'release'] },
  // ---- staging real ----
  {
    gate: 'staging-real',
    wf: 'Staging Integrations (MinIO + ClamAV + OTel Collector real)',
    match: /Real MinIO \+ ClamAV \+ Collector smoke/i,
    scope: 'staging-real',
    events: ['push', 'release'],
  },
  // ---- DR / carga ----
  { gate: 'dr-e2e', wf: 'DR End-to-End (backup/restore proof)', match: /Backup, destroy, restore, validate, smoke/i, scope: 'dr', events: ['schedule', 'release'] },
  {
    gate: 'load',
    wf: 'Load & SLO Evidence',
    match: /load|k6/i,
    scope: 'load',
    events: ['release'],
    pending: { owner: 'PROD-33', reason: 'perfil 10k/100k/100sessões 10+30min×3 ainda não implementado' },
  },
];

export const POLICIES = Object.freeze(
  Object.fromEntries(
    EVENTS.map((event) => {
      const required = REQUIRED.filter((descriptor) => descriptor.events.includes(event)).map((descriptor) => descriptor.gate);
      const waived = REQUIRED.filter((descriptor) => (descriptor.waiverFor ?? []).includes(event)).map((descriptor) => ({
        gate: descriptor.gate,
        substitute: descriptor.substitute,
        reason: `${descriptor.gate} não executa em ${event}; exige substituto ${descriptor.substitute} verde (nunca dispensa silenciosa)`,
      }));
      return [event, { event, required, waived, release: event === 'release' }];
    }),
  ),
);

export function asArray(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray(payload[key])) return payload[key];
  return [];
}

export function pickLatest(runs) {
  return runs
    .slice()
    .sort(
      (a, b) =>
        (Number(b?.run_number) || 0) - (Number(a?.run_number) || 0) ||
        String(b?.created_at || '').localeCompare(String(a?.created_at || '')),
    )[0];
}

/**
 * Coleta todas as páginas de um endpoint de listagem.
 * `fetchPage(page)` devolve o payload de uma página; o loop para quando o total
 * reportado foi atingido, quando a página vem vazia ou no limite de segurança.
 */
export function collectPages(fetchPage, key, { maxPages = 20, strict = false } = {}) {
  const all = [];
  let total = Infinity;
  for (let page = 1; page <= maxPages; page += 1) {
    let payload;
    try {
      payload = fetchPage(page);
    } catch (error) {
      if (strict) throw new Error(`falha na página ${page} de ${key}: ${error instanceof Error ? error.message : error}`);
      break;
    }
    if (strict && (payload === null || payload === undefined)) {
      throw new Error(`payload ausente na página ${page} de ${key}`);
    }
    if (strict && !Array.isArray(payload) && (!isPlainObject(payload) || !Array.isArray(payload[key]))) {
      throw new Error(`payload malformado na página ${page} de ${key}`);
    }
    const items = asArray(payload, key);
    all.push(...items);
    const reported = payload && typeof payload === 'object' ? Number(payload.total_count) : NaN;
    if (Number.isFinite(reported) && reported >= 0) total = reported;
    if (items.length === 0 || all.length >= total) break;
  }
  return all;
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isCommitSha(value) {
  return typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

function isValidIso(value) {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value));
}

function imageIdentityValues(evidence, field) {
  const values = [];
  for (const source of [evidence, evidence?.candidate, evidence?.execution]) {
    if (isPlainObject(source) && source[field] !== undefined && source[field] !== null) values.push(source[field]);
  }
  return values;
}

export function validateImageEvidence(evidence, sha, expectedCandidate = null, expectedExecution = null) {
  const reasons = [];
  if (!isPlainObject(evidence)) {
    return { ok: false, reasons: ['evidência de imagem ausente (artefato image-digests do SHA)'] };
  }

  for (const field of ['commit', 'lockfileSha256', 'sourceSha256']) {
    const occurrences = [evidence, evidence.candidate, evidence.execution]
      .filter(isPlainObject)
      .filter((source) => Object.prototype.hasOwnProperty.call(source, field));
    if (occurrences.some((source) => source[field] === null || source[field] === undefined)) {
      reasons.push(`${field} inválido/ausente no artefato de imagem`);
    }
    const values = imageIdentityValues(evidence, field);
    if (values.length === 0) {
      reasons.push(`${field} ausente no artefato de imagem`);
    } else if (new Set(values.map((value) => String(value))).size !== 1) {
      reasons.push(`${field} contraditório entre identidades do artefato de imagem`);
    }
  }
  const commit = imageIdentityValues(evidence, 'commit')[0] ?? null;
  if (!isCommitSha(commit) || commit !== sha) reasons.push(`commit da imagem divergente (${commit ?? 'ausente'} != ${sha})`);
  for (const field of ['lockfileSha256', 'sourceSha256']) {
    const value = imageIdentityValues(evidence, field)[0] ?? null;
    if (!isSha256(value)) {
      reasons.push(`${field} inválido/ausente no artefato de imagem`);
    } else if (expectedCandidate?.[field] && value !== expectedCandidate[field]) {
      reasons.push(`${field} da imagem divergente do candidato`);
    }
  }
  const runValues = imageIdentityValues(evidence, 'runId');
  const attemptValues = imageIdentityValues(evidence, 'attempt');
  for (const [field, values] of [['runId', runValues], ['attempt', attemptValues]]) {
    const occurrences = [evidence, evidence.candidate, evidence.execution]
      .filter(isPlainObject)
      .filter((source) => Object.prototype.hasOwnProperty.call(source, field));
    if (occurrences.some((source) => source[field] === null || source[field] === undefined)) {
      reasons.push(`${field} inválido/ausente no artefato de imagem`);
    }
    if (values.length > 0 && values.some((value) => (field === 'runId' ? !normalizeRunId(value) : !normalizeAttempt(value)))) {
      reasons.push(`${field} inválido no artefato de imagem`);
    }
  }
  const runId = normalizeRunId(runValues[0]);
  const attempt = normalizeAttempt(attemptValues[0]);
  if (runValues.length > 1 && new Set(runValues.map((value) => normalizeRunId(value))).size !== 1) {
    reasons.push('runId contraditório entre identidades do artefato de imagem');
  }
  if (attemptValues.length > 1 && new Set(attemptValues.map((value) => normalizeAttempt(value))).size !== 1) {
    reasons.push('attempt contraditório entre identidades do artefato de imagem');
  }
  if (!runId) reasons.push('runId ausente/inválido no artefato de imagem');
  if (!attempt) reasons.push('attempt ausente/inválido no artefato de imagem');
  const expectedRunId = normalizeRunId(expectedExecution?.runId ?? expectedCandidate?.runId);
  const expectedAttempt = normalizeAttempt(expectedExecution?.attempt ?? expectedCandidate?.attempt);
  if (expectedExecution || expectedCandidate?.runId !== undefined || expectedCandidate?.attempt !== undefined) {
    if (!expectedRunId) reasons.push('runId esperado ausente no candidato/run de imagem');
    else if (runId !== expectedRunId) reasons.push(`runId da imagem divergente (${runId ?? 'ausente'} != ${expectedRunId})`);
    if (!expectedAttempt) reasons.push('attempt esperado ausente no candidato/run de imagem');
    else if (attempt !== expectedAttempt) reasons.push(`attempt da imagem divergente (${attempt ?? 'ausente'} != ${expectedAttempt})`);
  }
  if (!isValidIso(evidence.generatedAt)) {
    reasons.push('generatedAt ausente/inválido no artefato de imagem');
  } else {
    const generatedAt = Date.parse(evidence.generatedAt);
    if (generatedAt > Date.now()) reasons.push('generatedAt futuro no artefato de imagem');
    const referenceTimes = [expectedExecution?.createdAt].filter(isValidIso).map(Date.parse);
    if (referenceTimes.some((time) => generatedAt < time)) reasons.push('generatedAt antigo para o run/candidato selecionado');
  }
  const images = Array.isArray(evidence.images) ? evidence.images : null;
  if (!images || images.length === 0) {
    reasons.push('nenhuma imagem registrada no artefato de digest');
  } else {
    const seen = new Map();
    const names = new Set();
    for (const image of images) {
      const name = image?.name ?? null;
      const digest = image?.digest ?? image?.manifestDigest ?? null;
      if (!name || typeof digest !== 'string' || !/^sha256:[0-9a-f]{64}$/i.test(digest)) {
        reasons.push(`imagem inválida no artefato (${name ?? 'sem nome'}:${digest ?? 'sem digest'})`);
        continue;
      }
      if (image?.digest !== undefined && image?.manifestDigest !== undefined && image.digest !== image.manifestDigest) {
        reasons.push(`digest contraditório para imagem ${name}`);
      }
      if (names.has(name)) reasons.push(`imagem duplicada (${name})`);
      names.add(name);
      if (seen.has(digest)) reasons.push(`digest duplicado entre imagens (${name} e ${seen.get(digest)})`);
      seen.set(digest, name);
    }
    const expectedImages = ['cvg-desk-api', 'cvg-desk-web', 'cvg-message-worker', 'cvg-realtime-service'];
    for (const expected of expectedImages) {
      if (!names.has(expected)) reasons.push(`imagem requerida ausente no artefato (${expected})`);
    }
    for (const name of names) {
      if (!expectedImages.includes(name)) reasons.push(`imagem não requerida no artefato (${name})`);
    }
    if (images.length !== expectedImages.length) reasons.push(`quantidade de imagens divergente (${images.length} != ${expectedImages.length})`);
  }
  return { ok: reasons.length === 0, reasons };
}

function workflowRunShapeReasons(run, sha) {
  const reasons = [];
  if (!isPlainObject(run)) return ['run de workflow malformado'];
  if (!normalizeRunId(run.id)) reasons.push('run sem id válido');
  if (typeof (run.name ?? run.workflow_name) !== 'string' || (run.name ?? run.workflow_name).trim() === '') reasons.push('run sem nome de workflow');
  if (run.head_sha !== sha) reasons.push(`run com SHA divergente (${run.head_sha ?? 'ausente'} != ${sha})`);
  if (!Number.isSafeInteger(run.run_number) || run.run_number <= 0) reasons.push('run_number ausente/inválido');
  if (!isValidIso(run.created_at)) reasons.push('created_at ausente/inválido no run');
  if (!normalizeAttempt(run.run_attempt ?? run.runAttempt ?? run.attempt)) reasons.push('run_attempt ausente/inválido');
  return reasons;
}

function jobsPayloadShapeReasons(payload) {
  if (Array.isArray(payload)) {
    return payload.every(isPlainObject) ? [] : ['lista de jobs contém entrada malformada'];
  }
  if (!isPlainObject(payload)) return ['jobs indisponíveis/malformados'];
  if (!Array.isArray(payload.jobs)) return ['payload de jobs sem lista jobs'];
  if (payload.jobs.some((entry) => !isPlainObject(entry))) return ['lista de jobs contém entrada malformada'];
  return [];
}

function jobSearchText(job) {
  const labels = Array.isArray(job?.labels) ? job.labels.join(' ') : '';
  return `${job?.name ?? ''} ${labels}`;
}

/**
 * Avalia o inventário requerido para um evento e SHA.
 * @param {typeof REQUIRED} required
 * @param {{
 *   runsPayload: unknown,
 *   getJobsPayload: (runId: number|string) => unknown,
 *   getImageEvidence?: (runId: number|string) => unknown,
 *   sha: string,
 *   event?: string,
 * }} io
 */
export function evaluateRequired(
  required,
  { runsPayload, getJobsPayload, getImageEvidence = () => null, sha, event = 'push', candidateIdentity = null },
) {
  const policy = POLICIES[event];
  if (!policy) {
    return {
      policy: event,
      sha,
      gates: {},
      failures: 1,
      missing: 0,
      invalid: 1,
      counts: { pass: 0, fail: 1, invalid: 1, notVerified: 0, waived: 0, pending: 0, notApplicable: 0 },
      state: 'FAILED',
      summary: `evento sem política: ${event}`,
      promotionEligible: false,
      releaseBlockers: [`evento sem política: ${event}; valores aceitos: ${EVENTS.join(', ')}`],
    };
  }
  const requiredList = Array.isArray(required) ? required : [];
  const requiredIds = requiredList.map((descriptor) => descriptor?.gate).filter((gate) => typeof gate === 'string');
  const inventoryReasons = [];
  if (requiredList.length === 0) inventoryReasons.push('inventário requerido vazio');
  if (requiredList.some((descriptor) => !isPlainObject(descriptor) || typeof descriptor.gate !== 'string' || !(descriptor.match instanceof RegExp) || typeof descriptor.wf !== 'string')) {
    inventoryReasons.push('inventário requerido malformado');
  }
  if (new Set(requiredIds).size !== requiredIds.length) inventoryReasons.push('gate duplicado no inventário requerido');
  for (const gate of policy.required) {
    if (!requiredIds.includes(gate)) inventoryReasons.push(`gate requerido ausente do inventário: ${gate}`);
  }
  if (inventoryReasons.length > 0) {
    return {
      policy: event,
      sha: sha ?? null,
      gates: { 'inventory-contract': { scope: 'required-inventory', required: true, status: 'INVALID', reasons: inventoryReasons } },
      failures: 1,
      missing: 0,
      invalid: 1,
      counts: { pass: 0, fail: 0, invalid: 1, notVerified: 0, waived: 0, pending: 0, notApplicable: 0 },
      state: 'FAILED',
      summary: `inventário inválido: ${inventoryReasons.join('; ')}`,
      promotionEligible: false,
      releaseBlockers: inventoryReasons,
    };
  }
  if (!isCommitSha(sha)) {
    return {
      policy: event,
      sha: sha ?? null,
      gates: { 'candidate-contract': { scope: 'candidate', required: true, status: 'INVALID', reasons: ['SHA ausente ou inválido: impossível certificar'] } },
      failures: 0,
      missing: 0,
      invalid: 1,
      counts: { pass: 0, fail: 0, invalid: 1, notVerified: 0, waived: 0, pending: 0, notApplicable: 0 },
      state: 'FAILED',
      summary: 'SHA ausente ou inválido: impossível certificar',
      promotionEligible: false,
      releaseBlockers: ['sha_ausente_ou_invalido'],
    };
  }

  const runs = asArray(runsPayload, 'workflow_runs');
  const payloadMalformed =
    runsPayload === null ||
    runsPayload === undefined ||
    (typeof runsPayload === 'object' && !Array.isArray(runsPayload) && !Array.isArray(runsPayload.workflow_runs)) ||
    (typeof runsPayload !== 'object' && !Array.isArray(runsPayload)) ||
    runs.some((run) => !isPlainObject(run));
  const byWorkflow = new Map();
  for (const run of runs) {
    const key = run?.name || run?.workflow_name;
    if (!key) continue;
    if (!byWorkflow.has(key)) byWorkflow.set(key, []);
    byWorkflow.get(key).push(run);
  }

  const gates = {};
  const perJob = {};
  let failures = 0;
  let missing = 0;
  let invalid = 0;
  const counts = { pass: 0, fail: 0, invalid: 0, notVerified: 0, waived: 0, pending: 0, notApplicable: 0 };
  const releaseBlockers = [];

  const setGate = (descriptor, status, reasons, extra = {}) => {
    gates[descriptor.gate] = { scope: descriptor.scope, required: policy.required.includes(descriptor.gate), status, reasons, ...extra };
    if (status === 'PASS') counts.pass += 1;
    else if (status === 'FAIL') {
      counts.fail += 1;
      failures += 1;
    } else if (status === 'INVALID') {
      counts.invalid += 1;
      invalid += 1;
      failures += 1;
    } else if (status === 'NOT_VERIFIED') {
      counts.notVerified += 1;
      missing += 1;
    } else if (status === 'WAIVED_WITH_SUBSTITUTE') counts.waived += 1;
    else if (status === 'PENDING_IMPLEMENTATION') counts.pending += 1;
    else if (status === 'NOT_APPLICABLE') counts.notApplicable += 1;
  };

  // Gates requeridos pelo evento.
  for (const descriptor of required.filter((entry) => policy.required.includes(entry.gate))) {
    if (descriptor.pending) {
      const reason = `gate pendente (${descriptor.pending.owner}): ${descriptor.pending.reason}`;
      setGate(descriptor, 'PENDING_IMPLEMENTATION', [reason]);
      releaseBlockers.push(`${descriptor.gate}: ${reason}`);
      continue;
    }
    const wfRuns = byWorkflow.get(descriptor.wf) ?? [];
    if (payloadMalformed) {
      const reason = 'payload de runs malformado/indisponível (API)';
      setGate(descriptor, 'INVALID', [reason]);
      releaseBlockers.push(`${descriptor.gate}: ${reason}`);
      continue;
    }
    const sameShaRuns = wfRuns.filter((run) => run?.head_sha === sha);
    const wrongShaRuns = wfRuns.filter((run) => run?.head_sha && run.head_sha !== sha);
    if (sameShaRuns.length === 0) {
      if (wrongShaRuns.length > 0) {
        setGate(descriptor, 'INVALID', [
          `sucesso antigo/outro SHA não conta: ${descriptor.wf} não executou em ${sha} (runs em ${wrongShaRuns.map((run) => run.head_sha).join(', ')})`,
        ]);
        releaseBlockers.push(`${descriptor.gate}: run em SHA divergente`);
      } else {
        setGate(descriptor, 'NOT_VERIFIED', [`workflow não executou no SHA (${descriptor.wf})`]);
        releaseBlockers.push(`${descriptor.gate}: workflow ausente no SHA`);
      }
      continue;
    }
    const latest = pickLatest(sameShaRuns);
    const runShape = workflowRunShapeReasons(latest, sha);
    if (runShape.length > 0) {
      setGate(descriptor, 'INVALID', runShape);
      releaseBlockers.push(`${descriptor.gate}: run malformado`);
      continue;
    }
    if (latest.status !== 'completed') {
      setGate(descriptor, 'FAIL', [`run ${latest.id} não concluído (status=${latest.status ?? 'ausente'})`]);
      releaseBlockers.push(`${descriptor.gate}: run não concluído`);
      continue;
    }
    if (latest.conclusion !== 'success') {
      setGate(descriptor, 'FAIL', [`run ${latest.id} com conclusion=${latest.conclusion ?? 'ausente'} no SHA`]);
      releaseBlockers.push(`${descriptor.gate}: conclusion=${latest.conclusion}`);
      continue;
    }
    const jobsPayload = (() => {
      try {
        return getJobsPayload(latest.id);
      } catch {
        return null;
      }
    })();
    const jobsShape = jobsPayloadShapeReasons(jobsPayload);
    if (jobsShape.length > 0) {
      setGate(descriptor, 'INVALID', jobsShape.map((reason) => `${reason} para o run ${latest.id}`));
      releaseBlockers.push(`${descriptor.gate}: jobs indisponíveis`);
      continue;
    }
    const jobs = asArray(jobsPayload, 'jobs');
    const relevant = jobs.filter((job) => descriptor.match.test(jobSearchText(job)));
    if (relevant.length === 0) {
      setGate(descriptor, 'NOT_VERIFIED', [`job não encontrado/renomeado (${descriptor.wf} / ${descriptor.match})`]);
      releaseBlockers.push(`${descriptor.gate}: job renomeado/ausente`);
      continue;
    }
    if (relevant.length > 1) {
      setGate(descriptor, 'INVALID', [
        `job duplicado no run ${latest.id}: ${relevant.map((job) => `${job.name}:${job.conclusion}`).join(', ')}`,
      ]);
      releaseBlockers.push(`${descriptor.gate}: job duplicado`);
      continue;
    }
    const job = relevant[0];
    if (job.conclusion !== 'success') {
      setGate(descriptor, 'FAIL', [`${job.name}:${job.conclusion}`]);
      releaseBlockers.push(`${descriptor.gate}: ${job.conclusion}`);
      continue;
    }
    if (descriptor.image) {
      const evidence = (() => {
        try {
          return getImageEvidence(latest.id);
        } catch {
          return null;
        }
      })();
      const imageCheck = validateImageEvidence(evidence, sha, candidateIdentity, {
        runId: latest.id,
        attempt: latest.run_attempt ?? latest.runAttempt ?? latest.attempt,
        createdAt: latest.created_at,
      });
      if (!imageCheck.ok) {
        setGate(descriptor, 'INVALID', imageCheck.reasons);
        releaseBlockers.push(`${descriptor.gate}: imagem não comprovada`);
        continue;
      }
    }
    setGate(descriptor, 'PASS', [], { runId: latest.id, job: job.name });
    perJob[descriptor.gate] = { runId: latest.id, jobs: relevant.map((entry) => entry.conclusion) };
  }

  // Gates com waiver no evento (ex.: dependency-review em push/release).
  for (const waiver of policy.waived) {
    const descriptor = required.find((entry) => entry.gate === waiver.gate);
    const substituteStatus = gates[waiver.substitute]?.status ?? null;
    const wfRuns = byWorkflow.get(descriptor.wf) ?? [];
    const sameSha = wfRuns.filter((run) => run?.head_sha === sha);
    let observed = null;
    if (sameSha.length > 0) {
      const latest = pickLatest(sameSha);
      const jobs = asArray((() => {
        try {
          return getJobsPayload(latest.id);
        } catch {
          return null;
        }
      })(), 'jobs');
      const relevant = jobs.filter((job) => descriptor.match.test(jobSearchText(job)));
      observed = relevant.length > 0 ? relevant.map((job) => job.conclusion).join(',') : 'ausente';
    }
    if (observed && observed.split(',').every((value) => value === 'success')) {
      setGate(descriptor, 'PASS', [], { waiver: 'executou no evento' });
      continue;
    }
    if (substituteStatus === 'PASS') {
      setGate(descriptor, 'WAIVED_WITH_SUBSTITUTE', [waiver.reason, `substituto ${waiver.substitute}=PASS`]);
    } else {
      setGate(descriptor, 'FAIL', [waiver.reason, `substituto ${waiver.substitute}=${substituteStatus ?? 'ausente'}`]);
      releaseBlockers.push(`${descriptor.gate}: sem substituto verde`);
    }
  }

  // Inventário não requerido no evento: registrar sem contar.
  for (const descriptor of required.filter((entry) => !policy.required.includes(entry.gate) && !policy.waived.some((waiver) => waiver.gate === entry.gate))) {
    setGate(descriptor, 'NOT_APPLICABLE', [`não requerido em ${event}`]);
  }

  const blocking = Object.entries(gates).filter(([, value]) => value.required && !['PASS', 'WAIVED_WITH_SUBSTITUTE'].includes(value.status));
  let state;
  if (blocking.length === 0) {
    state = 'VERIFIED_CANDIDATE';
  } else if (failures > 0) {
    state = 'FAILED';
  } else {
    state = policy.release ? 'BLOCKED' : 'CONDITIONAL';
  }
  const summary = Object.entries(gates)
    .map(([gate, value]) => `${gate}=${value.status}`)
    .join(' ');
  const report = {
    policy: event,
    sha,
    gates,
    failures,
    missing,
    invalid,
    counts,
    perJob,
    state,
    summary,
    promotionEligible: state === 'VERIFIED_CANDIDATE' && ['push', 'release'].includes(event),
    releaseBlockers,
  };
  return report;
}

function ghApiJson(endpoint) {
  try {
    return JSON.parse(execFileSync('gh', ['api', endpoint, '--jq', '.'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (error) {
    console.error(`[aggregator] gh api falhou (${endpoint}):`, error.stderr?.toString().slice(0, 300));
    return null;
  }
}

export function fetchRunsPaged(sha, fetchPage = (page) => ghApiJson(`/repos/${REPOSITORY}/actions/runs?head_sha=${sha}&per_page=100&page=${page}`)) {
  const first = fetchPage(1);
  if (first === null || first === undefined) throw new Error('API de runs indisponível');
  return collectPages((page) => (page === 1 ? first : fetchPage(page)), 'workflow_runs', { strict: true });
}

export function fetchJobsPaged(runId, fetchPage = (page) => ghApiJson(`/repos/${REPOSITORY}/actions/runs/${runId}/jobs?per_page=100&page=${page}`)) {
  return collectPages(fetchPage, 'jobs', { strict: true });
}

export function downloadImageEvidence(runId, sha) {
  const artifact = `image-digests-${sha}`;
  const dir = mkdtempSync(join(tmpdir(), 'aggregator-image-'));
  try {
    execFileSync('gh', ['run', 'download', String(runId), '-n', artifact, '-D', dir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    console.error(`[aggregator] imagem não comprovada (run ${runId}, artefato ${artifact}):`, error.stderr?.toString().slice(0, 300));
    return null;
  }
  const file = join(dir, 'image-digests.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export const CERTIFICATION_POLICY = Object.freeze({
  state: 'NOT_ELIGIBLE_LOCAL',
  reason:
    'O agregador emite no máximo VERIFIED_CANDIDATE; TRIPLE_AAA_CERTIFIED exige tag de release assinada e política aprovada em fluxo dedicado.',
});

export function main(env = process.env, io = {}) {
  const sha = env.SHA || execSync('git rev-parse HEAD').toString().trim();
  const requestedEvent = env.EVENT || env.GITHUB_EVENT_NAME || 'push';
  const event = requestedEvent;
  const candidateIdentity = io.candidateIdentity ?? resolveCandidate({ root, commit: sha });
  const artifactsDir = env.AGGREGATOR_ARTIFACTS_DIR || join(root, 'artifacts');
  mkdirSync(artifactsDir, { recursive: true });

  let runsPayload;
  if (io.runsPayload !== undefined) {
    runsPayload = io.runsPayload;
  } else {
    try {
      runsPayload = fetchRunsPaged(sha);
    } catch (error) {
      console.error('[aggregator] consulta de runs falhou:', error instanceof Error ? error.message : error);
      runsPayload = null;
    }
  }
  const jobsCache = new Map();
  const getJobsPayload =
    io.getJobsPayload ??
    ((runId) => {
      const key = String(runId);
      if (!jobsCache.has(key)) jobsCache.set(key, fetchJobsPaged(runId));
      return jobsCache.get(key);
    });
  const imageCache = new Map();
  const getImageEvidence =
    io.getImageEvidence ??
    ((runId) => {
      const key = String(runId);
      if (!imageCache.has(key)) imageCache.set(key, downloadImageEvidence(runId, sha));
      return imageCache.get(key);
    });

  const result = evaluateRequired(REQUIRED, { runsPayload, getJobsPayload, getImageEvidence, sha, event, candidateIdentity });

  const report = {
    repository: REPOSITORY,
    branch: event === 'pull_request' ? null : 'main',
    commit: sha,
    event,
    requestedEvent,
    timestamp: new Date().toISOString(),
    gateMode: 'github-actions-aggregator',
    policy: result.policy,
    gates: result.gates,
    promotionState: result.state,
    promotionEligible: result.promotionEligible,
    releaseBlockers: result.releaseBlockers,
    requiredChecks: POLICIES[event]?.required ?? [],
    waivedChecks: POLICIES[event]?.waived ?? [],
    counts: result.counts,
    perJob: result.perJob,
    branchProtection: {
      inspected: false,
      reason:
        'rulesets/branch protection remotos não acessíveis neste ambiente (gh/API indisponível); a política local por evento é a fonte testada e deve ser registrada no repositório.',
      requiredChecksByEvent: Object.fromEntries(EVENTS.map((eventName) => [eventName, POLICIES[eventName].required])),
    },
    certification: { ...CERTIFICATION_POLICY },
    honesty:
      'Nenhum PASS sem evidência no SHA correto; imagem exige digest do mesmo candidato; skip/duplicado/renomeado/cancelado/malformado reprovam; ausência de prova de release nunca é dispensada em silêncio.',
  };
  writeFileSync(join(artifactsDir, 'triple-aaa-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(
    join(artifactsDir, 'triple-aaa-report.md'),
    `# Triple AAA Certification Report — ${sha.slice(0, 8)}\n\n- Event: **${event}**\n- State: **${result.state}**\n- Promotion eligible: ${result.promotionEligible}\n- Timestamp: ${report.timestamp}\n\n| Gate | Required | Status | Detalhe |\n|---|---|---|---|\n${Object.entries(result.gates)
      .map(([gate, value]) => `| ${gate} | ${value.required ? 'sim' : 'não'} | ${value.status} | ${value.reasons.join('; ') || 'ok'} |`)
      .join('\n')}\n`,
  );

  console.log(`STATE=${result.state}`);
  console.log(`SUMMARY=${result.summary}`);
  if (result.releaseBlockers.length > 0) console.log(`BLOCKERS=${result.releaseBlockers.join(' | ')}`);
  writeFileSync(env.GITHUB_OUTPUT || '/dev/null', `state=${result.state}\nsummary=${result.summary}\npromotionEligible=${result.promotionEligible}\n`, { flag: 'a' });
  return report;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const report = main();
  process.exitCode = report.promotionState === 'VERIFIED_CANDIDATE' ? 0 : 1;
}
