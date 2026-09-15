// Suporte do programa de producao (docs/producao-2026-09-13).
// Somente evidencia sintetica; nunca toca dados reais de outro projeto.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(HERE, '..', '..', '..');
export const PROGRAM_DIR = resolve(
  process.env.CVG_PROGRAM_DIR || join(REPO_ROOT, 'docs', 'producao-2026-09-13'),
);
export const EVIDENCE_DIR = join(PROGRAM_DIR, 'evidencias');
export const EVIDENCE_SEGMENT = process.env.CVG_EVIDENCE_SEGMENT?.trim() || null;

export function evidenceDir(...parts) {
  const dir = join(EVIDENCE_DIR, ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function productionEvidenceDir(...parts) {
  return evidenceDir('prod-00', ...(EVIDENCE_SEGMENT ? [EVIDENCE_SEGMENT] : []), ...parts);
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function sha256File(path) {
  return sha256(readFileSync(path));
}

export function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  }).trim();
}

// Variante sem trim: necessaria para preservar o formato porcelain v1
// (o primeiro caractere de status pode ser espaco).
export function gitRaw(args) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function run(command, args, options = {}) {
  try {
    const stdout = execFileSync(command, args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: options.timeoutMs ?? 20_000,
      env: { ...process.env, ...(options.env || {}) },
    });
    return { ok: true, status: 0, stdout: String(stdout).trim(), stderr: '' };
  } catch (error) {
    return {
      ok: false,
      status: typeof error.status === 'number' ? error.status : -1,
      stdout: String(error.stdout ?? '').trim(),
      stderr: String(error.stderr ?? error.message ?? '').trim(),
    };
  }
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function nowIso() {
  return new Date().toISOString();
}

export function hasFile(relativePath) {
  return existsSync(join(REPO_ROOT, relativePath));
}

export function sanitizeRunId(raw) {
  const clean = String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  if (!clean) {
    throw new Error(`runId invalido: "${raw}"`);
  }
  return clean;
}
