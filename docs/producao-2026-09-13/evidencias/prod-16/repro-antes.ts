/**
 * PROD-16 — reprodução do ANTES (candidato 754f9ba) das falhas BK13:
 *
 *   1. `findOperationByRequestId` era um lookup GLOBAL por `request_id`
 *      (`erasure-operation.ts`), devolvido sem checar ator/contato/escopo
 *      (`privacy.controller.ts` GET/resume só exigiam `admin:read/write`);
 *      reusar um requestId de outro contato devolvia o relatório alheio.
 *   2. `resumeContactErasure(operationId)` não recebia ator/escopo: qualquer
 *      `admin:write` retomava operação de contato fora do seu escopo.
 *
 * O script roda com o runner isolado (nunca o banco do host):
 *
 *   node scripts/production/run-integration-isolated.mjs --run-id prod16-repro \
 *     --worker 25 -- pnpm --filter @cvg/privacy exec tsx \
 *     ../../docs/producao-2026-09-13/evidencias/prod-16/repro-antes.ts
 *
 * Ele (a) extrai do HEAD as linhas do código antigo via `git show`, (b) executa
 * a MESMA consulta global do código antigo contra um PostgreSQL isolado e
 * (c) confronta com o comportamento do código NOVO na mesma base.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '../../../..');
const BEFORE_DIR = join(HERE, 'before');
const OUT = join(HERE, 'repro-antes.json');
const DATABASE_URL = process.env.DATABASE_URL ?? '';

function fail(message: string): never {
  throw new Error(`BLOCKED (PROD-16 repro): ${message}`);
}

/**
 * Os arquivos de `before/` são a cópia fiel do módulo de privacidade no
 * worktree de produção ANTES do delta do PROD-16 (candidato 754f9ba +
 * worktree, prefixo preservado pelo programa). O git HEAD não contém o
 * worktree, por isso a cópia com sha256 é versionada como evidência.
 */
function beforeLines(file: string): string[] {
  return readFileSync(join(BEFORE_DIR, file), 'utf8').split('\n');
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(join(BEFORE_DIR, file))).digest('hex');
}

function oldLine(lines: string[], needle: string): { line: number; text: string } {
  const index = lines.findIndex((line) => line.includes(needle));
  return { line: index + 1, text: index >= 0 ? lines[index].trim() : '<não encontrada>' };
}

async function main(): Promise<void> {
  if (!DATABASE_URL.includes('cvg_aaa_')) {
    fail(`DATABASE_URL não é do run isolado do harness (recebido: ${DATABASE_URL || '<vazio>'}).`);
  }

  const oldErasure = beforeLines('erasure-operation.ts');
  const oldController = beforeLines('privacy.controller.ts');

  const oldFindLookup = oldLine(oldErasure, 'async function findOperationByRequestId');
  const oldGlobalReturn = oldLine(oldErasure, 'return { ok: true, report: { ...reportFromRow(existing), deduplicated: true } };');
  const oldResumeSignature = oldLine(oldErasure, 'export async function resumeContactErasure');
  const oldGetSignature = oldLine(oldErasure, 'export async function getPrivacyOperation');
  const oldControllerGet = oldLine(oldController, 'const report = await getPrivacyOperation(request.params.id);');
  const oldControllerResume = oldLine(oldController, 'const result = await resumeContactErasure(request.params.id);');

  const requireFromDatabase = createRequire(join(REPO_ROOT, 'packages/database/package.json'));
  const pgModule = (await import(pathToFileURL(requireFromDatabase.resolve('pg')).href)) as {
    Client: new (config: { connectionString: string }) => { connect(): Promise<void>; query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>; end(): Promise<void> };
    default?: { Client: new (config: { connectionString: string }) => { connect(): Promise<void>; query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>; end(): Promise<void> } };
  };
  const PgClient = (pgModule.default ?? pgModule).Client;
  const client = new PgClient({ connectionString: DATABASE_URL });
  await client.connect();

  const uA = randomUUID();
  const uB = randomUUID();
  const sectorA = randomUUID();
  const sectorB = randomUUID();
  const contactX = randomUUID();
  const contactY = randomUUID();
  const conversationY = randomUUID();
  const operationId = randomUUID();
  const requestId = `repro16-${randomUUID()}`;

  const report = {
    operationId,
    contactId: contactX,
    requestId,
    mode: 'dry-run',
    policyVersion: 'd02-pending-v1',
    status: 'planned',
    result: 'planned-dry-run',
    fullErasureClaimed: false,
    partial: true,
    checkpoint: 2,
    mutatedCopies: 0,
    steps: [
      { copy: 'contact', action: 'planned', affected: 1, residual: null },
      { copy: 'backup', action: 'residual', affected: 0, residual: null },
    ],
    residuals: [{ copy: 'backup', reason: 'external-backup-not-rewritten' }],
  };

  try {
    await client.query('INSERT INTO users (id, name, email, password_hash, is_active) VALUES ($1, $2, $3, $4, true)', [
      uA, 'Repro Ator A', `repro.a.${uA.slice(0, 8)}@example.com`, 'x',
    ]);
    await client.query('INSERT INTO users (id, name, email, password_hash, is_active) VALUES ($1, $2, $3, $4, true)', [
      uB, 'Repro Ator B', `repro.b.${uB.slice(0, 8)}@example.com`, 'x',
    ]);
    await client.query('INSERT INTO sectors (id, name, code) VALUES ($1, $2, $3)', [sectorA, 'Repro Setor A', `repro-a-${sectorA.slice(0, 6)}`]);
    await client.query('INSERT INTO sectors (id, name, code) VALUES ($1, $2, $3)', [sectorB, 'Repro Setor B', `repro-b-${sectorB.slice(0, 6)}`]);
    await client.query('INSERT INTO contacts (id, phone, name) VALUES ($1, $2, $3)', [contactX, '+551190160001', 'Titular do Setor A']);
    await client.query('INSERT INTO contacts (id, phone, name) VALUES ($1, $2, $3)', [contactY, '+551190160002', 'Titular do Setor B']);
    await client.query(
      `INSERT INTO conversations (id, contact_id, status, status_v2, current_handler, is_active, sector_id)
       VALUES ($1, $2, 'open', 'novo', 'bot', true, $3)`,
      [conversationY, contactY, sectorB],
    );
    await client.query(
      `INSERT INTO privacy_operations (id, request_id, contact_id, operation, mode, status, policy_version,
         scope, report, steps, checkpoint, actor_id)
       VALUES ($1, $2, $3, 'pseudonymize', 'dry-run', 'planned', 'd02-pending-v1', $4, $5, $6, 2, $7)`,
      [
        operationId,
        requestId,
        contactX,
        JSON.stringify({ all: false, sectorIds: [sectorA] }),
        JSON.stringify(report),
        JSON.stringify(report.steps),
        uA,
      ],
    );

    // (b) SEMÂNTICA ANTIGA: lookup global por request_id, sem ator/contato.
    const oldLookup = await client.query('SELECT * FROM privacy_operations WHERE request_id = $1', [requestId]);
    const oldWinner = oldLookup.rows[0];
    const oldLookupReport = oldWinner ? (JSON.parse(oldWinner.report) as { contactId: string }) : null;

    // (b') SEMÂNTICA ANTIGA: resume por id sem escopo (primeira query da função antiga).
    const oldResumeLookup = await client.query('SELECT * FROM privacy_operations WHERE id = $1', [operationId]);

    // (c) SEMÂNTICA NOVA na MESMA base: o módulo de produção.
    const privacy = await import('../../../../modules/privacy/src/index.ts');
    const newErasure = await privacy.runContactErasure({
      contactId: contactY,
      actor: { userId: uB, reason: 'repro-antes' },
      scope: { all: false, sectorIds: [sectorB] },
      requestId,
    });
    const newRead = await privacy.getPrivacyOperation(operationId, {
      actorId: uB,
      scope: { all: false, sectorIds: [sectorB] },
    });

    const result = {
      generatedAt: new Date().toISOString(),
      boundary: 'PostgreSQL isolado (runner AAA) + consultas com a semântica pré-delta + serviço NOVO',
      database: DATABASE_URL.replace(/:[^:@/]+@/, ':***@'),
      beforeFiles: {
        'erasure-operation.ts': { sha256: sha256('erasure-operation.ts') },
        'privacy.controller.ts': { sha256: sha256('privacy.controller.ts') },
      },
      oldCode: {
        findOperationByRequestId: oldFindLookup,
        globalDedupReturn: oldGlobalReturn,
        resumeSignature: oldResumeSignature,
        getSignature: oldGetSignature,
        controllerGetCall: oldControllerGet,
        controllerResumeCall: oldControllerResume,
      },
      oldRequestIdLeak: {
        callerActor: uB,
        callerScope: [sectorB],
        requestedContact: contactY,
        requestId,
        globalLookupReturnedOperationOf: oldLookupReport?.contactId ?? null,
        returnedOtherContactReport: oldLookupReport?.contactId === contactX,
        leakedContactId: oldLookupReport?.contactId ?? null,
        status: oldWinner?.status ?? null,
      },
      oldResumeWithoutScope: {
        operationOfContact: contactX,
        operationScope: [sectorA],
        lookupByIdReturnedOperation: oldResumeLookup.rows.length === 1,
        oldFunctionAcceptedOnly: 'operationId',
        scopeCheck: false,
      },
      newBehavior: {
        incompatibleRequestId: newErasure.ok ? { ok: true } : { ok: false, reason: newErasure.reason },
        outOfScopeRead: newRead.ok ? { ok: true } : { ok: false, reason: newRead.reason },
      },
    };

    writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));

    if (result.oldRequestIdLeak.returnedOtherContactReport !== true) {
      fail('repro não reproduziu o vazamento global de requestId esperado.');
    }
    if (result.newBehavior.incompatibleRequestId.reason !== 'conflict') {
      fail('código novo não bloqueou o reuso incompatível de requestId.');
    }
    if (result.newBehavior.outOfScopeRead.reason !== 'out_of_scope') {
      fail('código novo não negou a leitura fora do escopo.');
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
