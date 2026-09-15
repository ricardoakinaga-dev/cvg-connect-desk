// Selfcheck dos guardas de isolamento do storage/scanner (SA-003/AC1 e AC3).
// Exercita: porta ocupada, marcador de outro projeto, runId inválido e
// teardown recusado fora do próprio run. Não usa fuser nem nomes fixos.
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { getRunContext } from './run-context.ts';
import {
  provisionStorageScanner,
  storageScannerContext,
  teardownStorageScanner,
  StorageScannerIsolationError,
} from './storage-scanner-env.ts';

interface CaseResult { name: string; expected: string | null; observed: string | null; ok: boolean }

async function expectCode(name: string, expected: string | null, fn: () => Promise<unknown> | unknown): Promise<CaseResult> {
  try {
    await fn();
    return { name, expected, observed: null, ok: expected === null };
  } catch (error) {
    const code = error instanceof StorageScannerIsolationError ? error.code : 'UNEXPECTED';
    return { name, expected, observed: code, ok: code === expected };
  }
}

async function occupyPort(port: number): Promise<() => Promise<void>> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port }, () => resolve());
  });
  return async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
}

async function main() {
  const ctx = getRunContext();
  const env = storageScannerContext(ctx);
  mkdirSync(ctx.runRoot, { recursive: true });
  const results: CaseResult[] = [];
  let release: (() => Promise<void>) | null = null;

  try {
    // 1) Porta do MinIO ocupada por outro alvo -> aborta sem tocar no recurso.
    release = await occupyPort(env.ports.s3);
    results.push(await expectCode('porta_ocupada_aborta', 'PORT_BUSY', () => provisionStorageScanner(ctx, { services: ['minio'] })));
    await release();
    release = null;

    // 2) Marcador pertencente a outro projeto -> aborta.
    if (existsSync(env.markerPath)) unlinkSync(env.markerPath);
    writeFileSync(env.markerPath, `${JSON.stringify({ project: 'cvg-aaa-outro-run' })}\n`);
    results.push(await expectCode('marcador_divergente_aborta', 'MARKER_CONFLICT', () => provisionStorageScanner(ctx, { services: ['minio'] })));

    // 3) Teardown nunca derruba projeto de outro run.
    const teardownCase = await expectCode('teardown_recusa_projeto_alheio', 'MARKER_CONFLICT', () => teardownStorageScanner(ctx));
    results.push(teardownCase);
    if (teardownCase.ok && existsSync(env.markerPath)) unlinkSync(env.markerPath);

    // 4) runId inválido não vira nome de projeto (guarda no nível do contexto,
    // independente da sanitização de getRunContext).
    results.push(await expectCode('runid_invalido_aborta', 'RUN_ID_INVALID', () => {
      return storageScannerContext({ ...ctx, runId: 'x; rm -rf /' });
    }));
    // 4b) getRunContext sanitiza entrada hostil antes de qualquer nome.
    const previous = process.env.AAA_RUN_ID;
    process.env.AAA_RUN_ID = 'x; rm -rf /';
    results.push(await expectCode('runid_sanitizado_pelo_contexto', null, () => {
      const sanitized = getRunContext(ctx.workerIndex);
      if (/[^a-z0-9-]/.test(sanitized.runId)) throw new StorageScannerIsolationError('RUN_ID_INVALID', 'sanitizacao falhou');
      return sanitized.runId;
    }));
    if (previous === undefined) delete process.env.AAA_RUN_ID; else process.env.AAA_RUN_ID = previous;
  } finally {
    if (release) await release();
    if (existsSync(env.markerPath)) {
      const marker = JSON.parse(readFileSync(env.markerPath, 'utf8')) as { project?: string };
      if (marker.project === 'cvg-aaa-outro-run') unlinkSync(env.markerPath);
    }
  }

  const summary = {
    runId: ctx.runId,
    checkedAt: new Date().toISOString(),
    result: results.every((r) => r.ok) ? 'PASS' : 'FAIL',
    results,
  };
  const out = process.env.AAA_SELFCHECK_OUT || join(ctx.runRoot, 'storage-scanner-selfcheck.json');
  writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.result === 'PASS' ? 0 : 1);
}

main().catch((error) => {
  console.error('[storage-scanner-selfcheck] falha fatal:', error);
  process.exit(1);
});
