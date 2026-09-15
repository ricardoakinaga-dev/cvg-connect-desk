/**
 * PROD-13 — Budget durável + workflow seguro de ferramentas IA (C08, G05, G10).
 *
 * Prova real em PostgreSQL ISOLADO do harness AAA (runner
 * `scripts/production/run-integration-isolated.mjs`, run `prod13*`, worker 39,
 * banco `cvg_aaa_prod13_*`) usando o CÓDIGO DE PRODUÇÃO:
 *  - budget: `beginSecretaryInvocation`/`countConversationInvocations` reais
 *    sobre `secretary_invocations` (PG, atômico via advisory lock por conversa);
 *  - fluxo real do worker: `executeInboundSecretaryInvocation` (PROD-10) com
 *    bloqueio de orçamento → estado terminal `denied`;
 *  - gate de policy (`invokeSecretary`) com `priorInvocations` DURÁVEL e
 *    fail-closed quando o contador está indisponível;
 *  - ferramentas: hash canônico do payload ORIGINAL, expiração, CAS/uso único,
 *    revisor autorizado, deny-default (D05 OPEN) e sanitização recursiva.
 *
 * AC1 — budget durável/concorrente: contador cresce, limite exato nega,
 *       duas invocações simultâneas (limite 1) = 1 admitida/1 negada, persistência
 *       sobrevive a nova conexão e indisponibilidade do banco NÃO libera chamada.
 * AC2 — ferramentas: deny-default quando desabilitadas (403 AI_POLICY_DENIED),
 *       aprovação vinculada ao hash do payload original + escopo, revisor
 *       autorizado e expiração.
 * AC3 — auditoria de decisão sem PII; timeout tipado; limite exato nega.
 * AC4 — negativos: payload diferente nega, replay/duplo uso nega, expirada nega,
 *       sanitização não permite colisão.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RunContext } from '../../../../../e2e/support/aaa/run-context.ts';

interface PgQueryResult<R> {
  rows: R[];
  rowCount: number | null;
}

interface PgClientLike {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<PgQueryResult<R>>;
  end(): Promise<void>;
}

type PgPoolLike = PgClientLike;

interface PgRuntime {
  Pool: new (config: { connectionString: string; max?: number }) => PgPoolLike;
}

interface Harness {
  teardownIsolatedEnv: (
    ctx: RunContext,
    options?: { stopServices?: boolean; dropDatabase?: boolean },
  ) => Record<string, unknown>;
}

interface SecretaryInvocationRecordLike {
  id: string;
  invocationKey: string;
  conversationId: string;
  status: string;
  attemptCount: number;
  errorCode: string | null;
}

interface AIApprovalLike {
  id: string;
  status: string;
  consumedAt: Date | null;
  argsSanitized: Record<string, unknown>;
  scopeSanitized: Record<string, unknown>;
}

interface ToolVerdictLike {
  decision: 'allow' | 'deny' | 'require_approval';
  classification?: string;
  reason?: string;
  reasonCode?: string;
  statusCode?: number;
  code?: string;
  approvalId?: string;
}

interface AIDecisionLike {
  invocationId: string;
  decision: string;
  reason?: string;
}

interface SecretaryModuleLike {
  beginSecretaryInvocation(input: {
    invocationKey: string;
    conversationId: string;
    messageId: string;
    eventId: string;
    consumerId: string;
    action?: string;
    maxInvocations?: number;
  }): Promise<{ record: SecretaryInvocationRecordLike; alreadyCompleted: boolean }>;
  failSecretaryInvocation(invocationKey: string, options: {
    error: string;
    errorCode?: string;
    expectedAttemptCount?: number;
  }): Promise<SecretaryInvocationRecordLike>;
  countConversationInvocations(conversationId: string, options?: { excludeInvocationKey?: string }): Promise<number>;
  invokeSecretary(input: {
    conversationId: string;
    messageId?: string;
    action: 'classify' | 'respond' | 'handoff' | 'evaluate';
    content: string;
    sender: string;
    invocationId?: string;
  }): Promise<{ isOk(): boolean; isErr(): boolean; value?: unknown; error?: { statusCode?: number; code?: string; message?: string } }>;
  initializeSecretaryFromEnv(): { configured: boolean };
  getAIBudgetLimits(): { maxInvocationsPerConversation: number };
  invokeAITool(input: {
    invocationId: string;
    tool: string;
    args: Record<string, unknown>;
    scope?: Record<string, unknown>;
  }): Promise<ToolVerdictLike>;
  requestHumanApproval(input: {
    invocationId: string;
    tool: string;
    args: Record<string, unknown>;
    scope?: Record<string, unknown>;
    ttlMs?: number;
  }): Promise<AIApprovalLike>;
  decideApproval(input: { approvalId: string; reviewerId: string; approve: boolean }): Promise<AIApprovalLike | null>;
  setAIApprovalReviewerAuthorizer(authorizer: ((input: { reviewerId: string; approval: AIApprovalLike }) => boolean | Promise<boolean>) | null): void;
  hashToolArgs(tool: string, args: Record<string, unknown>, scope?: Record<string, unknown>): string;
  sanitizeAIArgs(args: Record<string, unknown>): Record<string, unknown>;
  getAIDecisions(): AIDecisionLike[];
  clearAIDecisions(): void;
  AIBudgetExhaustedError: new (message?: string) => Error & { errorCode: string; statusCode: number; permanent: boolean };
  AIToolDeniedError: new (reasonCode: string, message: string) => Error & { statusCode: number; code: string; reasonCode: string };
}

interface ChatModuleLike {
  executeInboundSecretaryInvocation(input: {
    eventId: string;
    correlationId?: string;
    conversationId: string;
    messageId: string;
    consumerId?: string;
  }): Promise<{ status: string; invocationId: string; deduplicated: boolean }>;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../..');
const PROGRAM_DIR = process.env.CVG_PROGRAM_DIR || join(REPO_ROOT, 'docs', 'producao-2026-09-13');
const EVIDENCE_SEGMENT = process.env.CVG_EVIDENCE_SEGMENT?.trim();
const EVIDENCE_DIR = join(
  PROGRAM_DIR,
  'evidencias',
  'prod-13',
  ...(EVIDENCE_SEGMENT ? [EVIDENCE_SEGMENT] : []),
);
const LOG_DIR = join(EVIDENCE_DIR, 'logs');
const RUNTIME_DIR = process.env.CVG_RUNTIME_DIR || join(EVIDENCE_DIR, 'runtime');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'database', 'supabase', 'migrations');
const RUN_ID = process.env.AAA_RUN_ID || 'prod13';
const WORKER_INDEX = Number(process.env.AAA_WORKER_INDEX || '39');
const SANDBOX_API_KEY = 'prod13-secretary-sandbox';

process.env.CVG_PROGRAM_DIR = PROGRAM_DIR;
process.env.CVG_RUNTIME_DIR = RUNTIME_DIR;
process.env.AAA_RUN_ID = RUN_ID;
process.env.AAA_WORKER_INDEX = String(WORKER_INDEX);
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;

const evidence: Array<Record<string, unknown>> = [];

interface SandboxState {
  mode: 'ok' | 'slow';
  delayMs: number;
  requests: number;
}

const sandbox: SandboxState = { mode: 'ok', delayMs: 0, requests: 0 };
let sandboxServer: Server | null = null;
let sandboxUrl = '';

let ctx: RunContext;
let isolatedEnv: { databaseName: string; marker: { runId: string } };
let pg: PgRuntime;
let harness: Harness;
let pool: PgPoolLike;
let databaseModulePool: { end(): Promise<void> } | undefined;
let secretary: SecretaryModuleLike;
let chat: ChatModuleLike;
let integrations: { initializeSecretaryClient(config: { baseUrl: string; apiKey: string; timeout?: number }): unknown };

function databaseUrl(): string {
  return `postgresql://cvg_aaa@127.0.0.1:${ctx.ports.postgres}/${isolatedEnv.databaseName}`;
}

function writeEvidenceJson(name: string, value: unknown): void {
  writeFileSync(join(EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

function startSandboxServer(): void {
  sandboxServer = createServer((request, response) => {
    if (request.url !== '/invoke' || request.method !== 'POST') {
      response.writeHead(404).end();
      return;
    }
    request.on('data', () => undefined);
    request.on('end', () => {
      sandbox.requests += 1;
      const reply = (): void => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          success: true,
          response: 'resposta-sandbox-prod13',
          classification: { category: 'general', priority: 'low', confidence: 0.9 },
        }));
      };
      if (sandbox.mode === 'slow' && sandbox.delayMs > 0) {
        const timer = setTimeout(reply, sandbox.delayMs);
        timer.unref();
      } else {
        reply();
      }
    });
  });
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const port = (server.address() as AddressInfo).port;
  return `http://127.0.0.1:${port}`;
}

async function count(query: string, params: unknown[] = []): Promise<number> {
  const result = await pool.query<{ n: number }>(query, params);
  return Number(result.rows[0]?.n ?? 0);
}

async function insertConversation(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    "INSERT INTO conversations (status, current_handler, is_active) VALUES ('open', 'bot', true) RETURNING id",
  );
  return result.rows[0]!.id;
}

async function insertMessage(conversationId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO messages (conversation_id, direction, content, sender, sender_type)
     VALUES ($1, 'inbound', 'conteudo-sintetico-prod13', '+5511900000000', 'contact')
     RETURNING id`,
    [conversationId],
  );
  return result.rows[0]!.id;
}

async function insertReviewer(): Promise<string> {
  const reviewerId = randomUUID();
  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, is_active)
     VALUES ($1, 'Reviewer PROD-13', $2, 'x', true)`,
    [reviewerId, `prod13-reviewer-${reviewerId}@example.com`],
  );
  return reviewerId;
}

async function beginWithKey(
  conversationId: string,
  invocationKey: string,
  maxInvocations: number,
): Promise<SecretaryInvocationRecordLike> {
  const messageId = await insertMessage(conversationId);
  const result = await secretary.beginSecretaryInvocation({
    invocationKey,
    conversationId,
    messageId,
    eventId: `prod13-evt-${randomUUID()}`,
    consumerId: 'prod13-test',
    action: 'classify',
    maxInvocations,
  });
  return result.record;
}

async function invocationRow(invocationKey: string): Promise<Record<string, unknown> | null> {
  const result = await pool.query<Record<string, unknown>>(
    'SELECT * FROM secretary_invocations WHERE invocation_key = $1',
    [invocationKey],
  );
  return result.rows[0] ?? null;
}

beforeAll(async () => {
  mkdirSync(LOG_DIR, { recursive: true });
  startSandboxServer();
  sandboxUrl = await listen(sandboxServer!);

  const runContextSpecifier = '../../../../../e2e/support/aaa/run-context.ts';
  const isolatedEnvSpecifier = '../../../../../e2e/support/aaa/isolated-env.ts';
  const pgSpecifier = 'pg';
  const runContextModule = (await import(/* @vite-ignore */ runContextSpecifier)) as {
    getRunContext: (workerIndex?: number) => RunContext;
  };
  const isolatedEnvModule = (await import(/* @vite-ignore */ isolatedEnvSpecifier)) as {
    provisionIsolatedEnv: (context: RunContext) => Promise<{ databaseName: string; marker: { runId: string } }>;
    teardownIsolatedEnv: Harness['teardownIsolatedEnv'];
  };
  const pgModule = (await import(/* @vite-ignore */ pgSpecifier)) as { default?: PgRuntime };
  pg = (pgModule.default ?? (pgModule as unknown as PgRuntime)) as PgRuntime;
  harness = { teardownIsolatedEnv: isolatedEnvModule.teardownIsolatedEnv };

  ctx = runContextModule.getRunContext(WORKER_INDEX);
  isolatedEnv = await isolatedEnvModule.provisionIsolatedEnv(ctx);
  if (isolatedEnv.marker.runId !== ctx.runId) {
    throw new Error(`marcador do run divergente: ${isolatedEnv.marker.runId} != ${ctx.runId}`);
  }
  process.env.DATABASE_URL = databaseUrl();
  pool = new pg.Pool({ connectionString: databaseUrl(), max: 8 });

  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(drizzle(pool as never) as never, { migrationsFolder: MIGRATIONS_DIR });

  secretary = (await import('../../../../../modules/secretary-adapter/src/index.ts')) as unknown as SecretaryModuleLike;
  chat = (await import('../../../../../modules/chat/src/index.ts')) as unknown as ChatModuleLike;
  integrations = (await import('../../../../../packages/integrations/src/index.ts')) as {
    initializeSecretaryClient(config: { baseUrl: string; apiKey: string; timeout?: number }): unknown;
  };
  const databaseModule = (await import('../../../../../packages/database/src/index.ts')) as {
    getPool: () => { end(): Promise<void> };
  };
  databaseModulePool = databaseModule.getPool();

  process.env.SECRETARY_URL = sandboxUrl;
  process.env.SECRETARY_API_KEY = SANDBOX_API_KEY;
  process.env.SECRETARY_MAX_RETRIES = '1';
  expect(secretary.initializeSecretaryFromEnv().configured).toBe(true);
});

beforeEach(() => {
  sandbox.mode = 'ok';
  sandbox.delayMs = 0;
  sandbox.requests = 0;
  secretary.clearAIDecisions();
  process.env.SECRETARY_MAX_INVOCATIONS_PER_CONVERSATION = '20';
  delete process.env.SECRETARY_AI_TOOLS_ENABLED;
  secretary.setAIApprovalReviewerAuthorizer(null);
});

afterEach(() => {
  delete process.env.SECRETARY_AI_TOOLS_ENABLED;
  delete process.env.SECRETARY_MAX_INVOCATIONS_PER_CONVERSATION;
  secretary.setAIApprovalReviewerAuthorizer(null);
});

afterAll(async () => {
  writeEvidenceJson('prod-13-evidence.json', {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    workerIndex: WORKER_INDEX,
    database: isolatedEnv?.databaseName,
    postgresPort: ctx?.ports.postgres,
    cases: evidence,
  });
  sandboxServer?.closeAllConnections?.();
  sandboxServer?.close();
  if (databaseModulePool) await databaseModulePool.end().catch(() => undefined);
  if (pool) await pool.end().catch(() => undefined);
  if (ctx && harness) {
    harness.teardownIsolatedEnv(ctx, { stopServices: true, dropDatabase: true });
  }
});

describe('PROD-13 — budget durável e ferramentas IA (PG real)', () => {
  it('AC1 — contador durável cresce por conversa e não conta blocked/denied', async () => {
    const conversationId = await insertConversation();
    const otherConversationId = await insertConversation();

    await beginWithKey(conversationId, `prod13-count-1-${randomUUID()}`, 10);
    await beginWithKey(conversationId, `prod13-count-2-${randomUUID()}`, 10);
    await beginWithKey(conversationId, `prod13-count-3-${randomUUID()}`, 10);

    expect(await secretary.countConversationInvocations(conversationId)).toBe(3);
    expect(await secretary.countConversationInvocations(otherConversationId)).toBe(0);

    // Uma falha explícita deixa a invocação retryável; retomá-la não consome
    // orçamento de novo. Uma invocação ainda `processing` não seria reaberta.
    const key = `prod13-count-retry-${randomUUID()}`;
    const first = await beginWithKey(conversationId, key, 10);
    await secretary.failSecretaryInvocation(key, {
      error: 'falha sintética antes do retry',
      errorCode: 'SYNTHETIC_FAILURE',
      expectedAttemptCount: first.attemptCount,
    });
    const retried = await secretary.beginSecretaryInvocation({
      invocationKey: key,
      conversationId,
      messageId: first.id,
      eventId: `prod13-evt-${randomUUID()}`,
      consumerId: 'prod13-test',
      action: 'classify',
      maxInvocations: 10,
    });
    expect(retried.alreadyCompleted).toBe(false);
    expect(retried.record.attemptCount).toBe(2);
    expect(await secretary.countConversationInvocations(conversationId)).toBe(4);

    evidence.push({
      case: 'AC1-contador-duravel',
      conversationId,
      admitted: 4,
      otherConversation: 0,
      retryConsumesBudgetAgain: false,
    });
  });

  it('AC1 — limite exato nega com erro tipado e registro durável denied (sem PII)', async () => {
    const conversationId = await insertConversation();
    await beginWithKey(conversationId, `prod13-limit-a-${randomUUID()}`, 2);
    await beginWithKey(conversationId, `prod13-limit-b-${randomUUID()}`, 2);

    const deniedKey = `prod13-limit-c-${randomUUID()}`;
    let captured: unknown = null;
    try {
      await beginWithKey(conversationId, deniedKey, 2);
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(secretary.AIBudgetExhaustedError);
    const budgetError = captured as InstanceType<SecretaryModuleLike['AIBudgetExhaustedError']>;
    expect(budgetError.statusCode).toBe(403);
    expect(budgetError.errorCode).toBe('AI_BUDGET_EXHAUSTED');
    expect(budgetError.permanent).toBe(true);
    expect(await secretary.countConversationInvocations(conversationId)).toBe(2);

    const deniedRow = await invocationRow(deniedKey);
    expect(deniedRow?.status).toBe('denied');
    expect(deniedRow?.error_code).toBe('AI_BUDGET_EXHAUSTED');
    const detail = JSON.stringify(deniedRow?.detail ?? {});
    expect(detail).toContain('budget_exhausted');
    expect(detail).not.toContain('conteudo-sintetico');

    // Retry da MESMA mensagem bloqueada continua negada (estado terminal).
    await expect(secretary.beginSecretaryInvocation({
      invocationKey: deniedKey,
      conversationId,
      messageId: String(deniedRow?.message_id),
      eventId: `prod13-evt-${randomUUID()}`,
      consumerId: 'prod13-test',
      action: 'classify',
      maxInvocations: 2,
    })).rejects.toMatchObject({ errorCode: 'AI_BUDGET_EXHAUSTED' });

    evidence.push({
      case: 'AC1-limite-exato',
      limit: 2,
      admitted: 2,
      deniedStatus: deniedRow?.status,
      deniedErrorCode: deniedRow?.error_code,
      retryRejected: true,
    });
  });

  it('AC1 — concorrência: 2 invocações simultâneas com limite 1 = 1 admitida/1 negada', async () => {
    const conversationId = await insertConversation();
    const results = await Promise.allSettled([
      beginWithKey(conversationId, `prod13-conc-a-${randomUUID()}`, 1),
      beginWithKey(conversationId, `prod13-conc-b-${randomUUID()}`, 1),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      errorCode: 'AI_BUDGET_EXHAUSTED',
      statusCode: 403,
    });
    expect(await secretary.countConversationInvocations(conversationId)).toBe(1);
    expect(await count(
      "SELECT count(*)::int AS n FROM secretary_invocations WHERE conversation_id = $1 AND status = 'denied'",
      [conversationId],
    )).toBe(1);

    evidence.push({
      case: 'AC1-concorrencia-limite-1',
      admitted: 1,
      denied: 1,
      exactlyOneWinner: true,
    });
  });

  it('AC1 — orçamento persiste em nova conexão (restart não reseta) e nega de novo', async () => {
    const conversationId = await insertConversation();
    await beginWithKey(conversationId, `prod13-restart-a-${randomUUID()}`, 1);

    const secondPool = new pg.Pool({ connectionString: databaseUrl(), max: 2 });
    try {
      const persisted = await secondPool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM secretary_invocations WHERE conversation_id = $1 AND status <> $2',
        [conversationId, 'denied'],
      );
      expect(Number(persisted.rows[0]?.n ?? 0)).toBe(1);
    } finally {
      await secondPool.end();
    }

    await expect(beginWithKey(conversationId, `prod13-restart-b-${randomUUID()}`, 1))
      .rejects.toMatchObject({ errorCode: 'AI_BUDGET_EXHAUSTED' });

    evidence.push({ case: 'AC1-restart-nao-reseta', persistedAdmitted: 1, newAttemptDenied: true });
  });

  it('AC1/AC3 — fluxo do worker (PROD-10) bloqueia no limite com status denied', async () => {
    process.env.SECRETARY_MAX_INVOCATIONS_PER_CONVERSATION = '1';
    const conversationId = await insertConversation();
    await beginWithKey(conversationId, `prod13-worker-admitted-${randomUUID()}`, 1);

    const messageId = await insertMessage(conversationId);
    const output = await chat.executeInboundSecretaryInvocation({
      eventId: `prod13-worker-evt-${randomUUID()}`,
      correlationId: `prod13-worker-corr-${randomUUID()}`,
      conversationId,
      messageId,
      consumerId: 'prod13-worker-test',
    });

    expect(output.status).toBe('denied');
    const row = await invocationRow(`inbound:${messageId}`);
    expect(row?.status).toBe('denied');
    expect(row?.error_code).toBe('AI_BUDGET_EXHAUSTED');
    expect(sandbox.requests).toBe(0);
    expect(await count(
      "SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1 AND direction = 'outbound'",
      [conversationId],
    )).toBe(0);

    evidence.push({
      case: 'AC1-worker-denied',
      status: output.status,
      deniedRowStatus: row?.status,
      secretaryCalls: sandbox.requests,
      outboundReplies: 0,
    });
  });

  it('AC1/AC3 — invokeSecretary usa priorInvocations DURÁVEL e nega no limite exato', async () => {
    const conversationId = await insertConversation();
    await beginWithKey(conversationId, `prod13-policy-a-${randomUUID()}`, 10);
    await beginWithKey(conversationId, `prod13-policy-b-${randomUUID()}`, 10);

    process.env.SECRETARY_MAX_INVOCATIONS_PER_CONVERSATION = '2';
    const denied = await secretary.invokeSecretary({
      conversationId,
      action: 'classify',
      content: 'conteudo-policy',
      sender: '+5511900000000',
      invocationId: `prod13-policy-new-${randomUUID()}`,
    });
    expect(denied.isErr()).toBe(true);
    expect(denied.error?.statusCode).toBe(403);
    expect(denied.error?.code).toBe('AI_POLICY_DENIED');
    expect(denied.error?.message).toContain('invocation budget exhausted');
    expect(sandbox.requests).toBe(0);

    // Com um slot a mais, a MESMA conversa é permitida (contador não é 0 fixo).
    process.env.SECRETARY_MAX_INVOCATIONS_PER_CONVERSATION = '3';
    const allowed = await secretary.invokeSecretary({
      conversationId,
      action: 'classify',
      content: 'conteudo-policy',
      sender: '+5511900000000',
      invocationId: `prod13-policy-allowed-${randomUUID()}`,
    });
    expect(allowed.isOk()).toBe(true);
    expect(sandbox.requests).toBe(1);

    evidence.push({
      case: 'AC1-policy-duravel',
      priorPersisted: 2,
      limit: 2,
      deniedBeforeExternalCall: true,
      allowedWithLimit3: true,
      secretaryCalls: 1,
    });
  });

  it('AC3 — budget indisponível (PG) NÃO permite bypass: deny 403 sem chamar a IA', async () => {
    const before = sandbox.requests;
    const outcome = await secretary.invokeSecretary({
      conversationId: 'nao-e-uuid-prod13',
      action: 'classify',
      content: 'conteudo-budget-indisponivel',
      sender: '+5511900000000',
      invocationId: `prod13-unavailable-${randomUUID()}`,
    });
    expect(outcome.isErr()).toBe(true);
    expect(outcome.error?.statusCode).toBe(403);
    expect(outcome.error?.code).toBe('AI_POLICY_DENIED');
    expect(outcome.error?.message).toContain('budget store unavailable');
    expect(sandbox.requests).toBe(before);

    evidence.push({
      case: 'AC3-budget-indisponivel-fail-closed',
      decision: 'deny',
      statusCode: 403,
      secretaryCalls: sandbox.requests - before,
    });
  });

  it('AC3 — timeout da Secretary permanece tipado e a decisão é auditada sem PII', async () => {
    integrations.initializeSecretaryClient({ baseUrl: sandboxUrl, apiKey: SANDBOX_API_KEY, timeout: 50 });
    sandbox.mode = 'slow';
    sandbox.delayMs = 400;
    const conversationId = await insertConversation();
    const secretContent = 'conteudo-secreto-que-nao-pode-vazar';

    const outcome = await secretary.invokeSecretary({
      conversationId,
      action: 'classify',
      content: secretContent,
      sender: '+5511900000000',
      invocationId: `prod13-timeout-${randomUUID()}`,
    });
    expect(outcome.isErr()).toBe(true);
    expect(outcome.error?.code).toBe('SECRETARY_TIMEOUT');
    expect(sandbox.requests).toBeGreaterThanOrEqual(1);

    const decisions = secretary.getAIDecisions();
    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(decisions)).not.toContain(secretContent);
    expect(JSON.stringify(decisions)).not.toContain('5511900000000');

    integrations.initializeSecretaryClient({ baseUrl: sandboxUrl, apiKey: SANDBOX_API_KEY, timeout: 5000 });

    evidence.push({
      case: 'AC3-timeout-e-auditoria-sem-pii',
      errorCode: outcome.error?.code,
      secretaryCalls: sandbox.requests,
      decisionHasContent: false,
      decisionHasPhone: false,
    });
  });

  it('AC2 — deny-default: sem ratificação (D05 OPEN) toda ferramenta nega 403 AI_POLICY_DENIED', async () => {
    const tools = ['contact.lookup', 'note.create', 'contact.update', 'contact.delete'];
    for (const tool of tools) {
      const verdict = await secretary.invokeAITool({
        invocationId: `prod13-tools-off-${randomUUID()}`,
        tool,
        args: { id: 'c1' },
      });
      expect(verdict).toMatchObject({
        decision: 'deny',
        reasonCode: 'AI_TOOLS_DISABLED',
        statusCode: 403,
        code: 'AI_POLICY_DENIED',
      });
    }
    await expect(secretary.decideApproval({
      approvalId: randomUUID(),
      reviewerId: randomUUID(),
      approve: true,
    })).rejects.toMatchObject({ statusCode: 403, code: 'AI_POLICY_DENIED' });

    evidence.push({ case: 'AC2-deny-default', toolsDenied: tools.length, decideDenied: true });
  });

  it('AC4 — hash canônico do payload ORIGINAL: sanitização não colide e escopo vincula', async () => {
    const hashPhoneA = secretary.hashToolArgs('contact.delete', { contactId: 'c1', phone: '+5511999999999' });
    const hashPhoneB = secretary.hashToolArgs('contact.delete', { contactId: 'c1', phone: '+5511888888888' });
    expect(hashPhoneA).not.toBe(hashPhoneB);
    expect(secretary.hashToolArgs('contact.delete', { a: 1, b: 2 }))
      .toBe(secretary.hashToolArgs('contact.delete', { b: 2, a: 1 }));
    expect(secretary.hashToolArgs('contact.delete', { id: 'c1' }, { actorId: 'u1' }))
      .not.toBe(secretary.hashToolArgs('contact.delete', { id: 'c1' }, { actorId: 'u2' }));

    const sanitized = secretary.sanitizeAIArgs({
      contact: { phone: '+5511999999999', email: 'a@b.c', notes: [{ phone: '+5511777777777' }] },
    });
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain('5511999999999');
    expect(serialized).not.toContain('5511777777777');
    expect(serialized).not.toContain('a@b.c');

    evidence.push({
      case: 'AC4-hash-e-sanitizacao',
      phoneHashesDiffer: true,
      keyOrderStable: true,
      scopeBound: true,
      nestedPiiRedacted: true,
    });
  });

  it('AC2/AC4 — payload diferente nega, expirada nega, duplo decide/uso negam', async () => {
    process.env.SECRETARY_AI_TOOLS_ENABLED = 'true';
    secretary.setAIApprovalReviewerAuthorizer(({ reviewerId }) => reviewerId.length > 0);

    const invocationId = `prod13-approval-${randomUUID()}`;
    const argsA = { contactId: 'c-a', phone: '+5511900000011' };
    const argsB = { contactId: 'c-b', phone: '+5511900000022' };
    const first = await secretary.invokeAITool({ invocationId, tool: 'contact.delete', args: argsA });
    expect(first.decision).toBe('require_approval');
    if (first.decision !== 'require_approval' || !first.approvalId) throw new Error('expected require_approval');

    const reviewerId = await insertReviewer();
    const approved = await secretary.decideApproval({ approvalId: first.approvalId, reviewerId, approve: true });
    expect(approved?.status).toBe('APPROVED');
    // Duplo approve não vence.
    expect(await secretary.decideApproval({ approvalId: first.approvalId, reviewerId, approve: true })).toBeNull();

    // Payload diferente NÃO é autorizado pelo approve do payload A.
    const withB = await secretary.invokeAITool({ invocationId, tool: 'contact.delete', args: argsB });
    expect(withB.decision).not.toBe('allow');
    expect(withB.decision).toBe('require_approval');

    // Payload A autoriza UMA vez (uso único); replay nega.
    const withA = await secretary.invokeAITool({ invocationId, tool: 'contact.delete', args: argsA });
    expect(withA.decision).toBe('allow');
    const replay = await secretary.invokeAITool({ invocationId, tool: 'contact.delete', args: argsA });
    expect(replay).toMatchObject({ decision: 'deny', reasonCode: 'AI_APPROVAL_CONSUMED' });

    // Expiração: aprovação vencida NÃO autoriza.
    const expiredInvocation = `prod13-expired-${randomUUID()}`;
    const expiring = await secretary.requestHumanApproval({
      invocationId: expiredInvocation,
      tool: 'message.delete',
      args: { id: 'm-1' },
      ttlMs: 40,
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 70));
    const expiredDecision = await secretary.decideApproval({
      approvalId: expiring.id,
      reviewerId,
      approve: true,
    });
    expect(expiredDecision === null || expiredDecision.status === 'EXPIRED').toBe(true);
    const expiredVerdict = await secretary.invokeAITool({
      invocationId: expiredInvocation,
      tool: 'message.delete',
      args: { id: 'm-1' },
    });
    expect(expiredVerdict).toMatchObject({ decision: 'deny', reasonCode: 'AI_APPROVAL_EXPIRED' });

    // Revisor não autorizado não decide.
    secretary.setAIApprovalReviewerAuthorizer(() => false);
    const pending = await secretary.requestHumanApproval({
      invocationId: `prod13-reviewer-${randomUUID()}`,
      tool: 'contact.delete',
      args: { id: 'c-z' },
    });
    await expect(secretary.decideApproval({
      approvalId: pending.id,
      reviewerId,
      approve: true,
    })).rejects.toMatchObject({ statusCode: 403, code: 'AI_POLICY_DENIED' });

    evidence.push({
      case: 'AC2-AC4-aprovacao',
      differentPayloadDenied: true,
      singleUseEnforced: true,
      doubleDecisionNull: true,
      expiredDenied: true,
      unauthorizedReviewerDenied: true,
    });
  });
});
