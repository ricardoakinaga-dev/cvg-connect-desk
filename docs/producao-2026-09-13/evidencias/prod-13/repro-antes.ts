/**
 * PROD-13 — Reprodução dos defeitos ANTES do delta (candidato HEAD + worktree).
 *
 * Executa o CÓDIGO REAL de `invokeSecretary` / `ai-tools` contra PostgreSQL
 * ISOLADO do harness AAA (exige marcador `cvg_aaa_*`; nunca o banco do host).
 * O sandbox da Secretary é um HTTP local controlado pelo script.
 *
 * Defeitos reproduzidos (BE13/BE14/BE19, C08):
 *  A) budget por conversa NUNCA dispara: `invoke-secretary.use-case.ts` passa
 *     `priorInvocations: 0` fixo, então mesmo com invocações persistidas acima
 *     do limite a chamada externa acontece;
 *  B) hash de aprovação sobre args SANITIZADOS colide: dois payloads com
 *     telefones diferentes produzem o MESMO hash (o aprovado autorizaria o
 *     outro);
 *  C) aprovação sem uso único: depois de aprovada, a ferramenta é permitida
 *     repetidamente (sem consumo/CAS);
 *  D) registry de tools sem chamador produtivo (nenhum arquivo fora de teste
 *     chama `invokeAITool`) — enforcement inerte.
 *
 * Uso (runner isolado):
 * node scripts/production/run-integration-isolated.mjs --run-id prod13-repro \
 *   --worker 39 -- pnpm exec tsx docs/producao-2026-09-13/evidencias/prod-13/repro-antes.ts
 */
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from '@cvg/database';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../');
const DATABASE_URL = process.env.DATABASE_URL || '';

if (!/cvg_aaa_/.test(DATABASE_URL)) {
  throw new Error('[PROD-13 repro] DATABASE_URL sem marcador cvg_aaa_* — abortado');
}

const pool = getPool();
const result: Record<string, unknown> = {
  generatedAt: new Date().toISOString(),
  runId: process.env.AAA_RUN_ID || null,
  workerIndex: process.env.AAA_WORKER_INDEX || null,
  database: DATABASE_URL.replace(/:\/\/[^@]*@/, '://***@'),
  scenarios: {},
};

let secretaryCalls = 0;
const server: Server = createServer((request, response) => {
  if (request.url !== '/invoke') {
    response.writeHead(404).end();
    return;
  }
  request.on('data', () => undefined);
  request.on('end', () => {
    secretaryCalls += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      success: true,
      response: 'resposta-da-ia',
      classification: { category: 'general', priority: 'low', confidence: 0.9 },
    }));
  });
});

async function count(query: string, params: unknown[] = []): Promise<number> {
  const rows = (await pool.query(query, params)).rows as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}

/** Arquivos .ts de produção (sem testes) que IMPORTAM `invokeAITool`. */
function scanToolCallers(): string[] {
  const roots = ['modules', 'apps', 'packages'].map((entry) => join(REPO_ROOT, entry));
  const hits: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage' || entry === '__tests__') continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.endsWith('.ts') || entry.endsWith('.d.ts') || entry.endsWith('.test.ts')) continue;
      const text = readFileSync(full, 'utf8');
      const importsIt = /import[^;]*\binvokeAITool\b[^;]*from/.test(text);
      if (importsIt) hits.push(full.slice(REPO_ROOT.length + 1));
    }
  };
  for (const root of roots) visit(root);
  return hits;
}

async function scenarioA(): Promise<void> {
  const conversationId = randomUUID();
  await pool.query('INSERT INTO conversations (id, status) VALUES ($1, $2)', [conversationId, 'open']);
  for (let index = 0; index < 3; index += 1) {
    await pool.query(
      `INSERT INTO secretary_invocations (invocation_key, conversation_id, action, status, attempt_count, completed_at)
       VALUES ($1, $2, 'classify', 'completed', 1, NOW())`,
      [`repro-prior-${index}-${conversationId}`, conversationId],
    );
  }
  process.env.SECRETARY_MAX_INVOCATIONS_PER_CONVERSATION = '1';

  const { invokeSecretary } = await import(
    '../../../../modules/secretary-adapter/src/application/use-cases/invoke-secretary.use-case.ts'
  );
  const outcome = await invokeSecretary({
    conversationId,
    action: 'classify',
    content: 'conteudo-repro-budget',
    sender: '+5511900000001',
    invocationId: `repro-invocation-${conversationId}`,
  });

  result.scenarios = {
    ...(result.scenarios as Record<string, unknown>),
    A_budget_ignorado: {
      priorInvocationsPersistidas: 3,
      limiteConfigurado: 1,
      chamadasSecretary: secretaryCalls,
      resultado: outcome.isOk() ? 'allow' : 'deny',
      defect: secretaryCalls === 1,
    },
  };
}

async function scenarioB(): Promise<void> {
  const { hashToolArgs } = await import('../../../../modules/secretary-adapter/src/application/ai-tools.ts');
  const hashA = hashToolArgs({ contactId: 'c1', phone: '+5511999999999' });
  const hashB = hashToolArgs({ contactId: 'c1', phone: '+5511888888888' });
  (result.scenarios as Record<string, unknown>).B_hash_colide_apos_sanitizacao = {
    hashPhoneA: hashA,
    hashPhoneB: hashB,
    mesmosArgsSanitizados: hashA === hashB,
    defect: hashA === hashB,
  };
}

async function scenarioC(): Promise<void> {
  const { requestHumanApproval, decideApproval, invokeAITool } = await import(
    '../../../../modules/secretary-adapter/src/application/ai-tools.ts'
  );
  const invocationId = `repro-double-use-${randomUUID()}`;
  const args = { contactId: 'c-9', phone: '+5511999999999' };
  const requested = await requestHumanApproval({ invocationId, tool: 'contact.delete', args });
  const reviewerId = randomUUID();
  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, is_active) VALUES ($1, 'Repro Reviewer', $2, 'x', true)`,
    [reviewerId, `repro-${invocationId}@example.com`],
  );
  await decideApproval({ approvalId: requested.id, reviewerId, approve: true });
  const firstUse = await invokeAITool({ invocationId, tool: 'contact.delete', args });
  const secondUse = await invokeAITool({ invocationId, tool: 'contact.delete', args });
  (result.scenarios as Record<string, unknown>).C_aprovacao_sem_uso_unico = {
    primeiraChamada: firstUse.decision,
    segundaChamada: secondUse.decision,
    defect: firstUse.decision === 'allow' && secondUse.decision === 'allow',
  };
}

async function main(): Promise<void> {
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const port = (server.address() as AddressInfo).port;
  const integrations = await import('../../../../packages/integrations/src/secretary-client.ts');
  integrations.initializeSecretaryClient({
    baseUrl: `http://127.0.0.1:${port}`,
    apiKey: 'prod13-repro',
    timeout: 5000,
  });

  await scenarioA();
  await scenarioB();
  await scenarioC();
  const callers = scanToolCallers();
  (result.scenarios as Record<string, unknown>).D_registry_sem_chamador = {
    arquivosDeProducaoComInvokeAITool: callers,
    defect: callers.length === 0,
  };

  const scenarios = result.scenarios as Record<string, { defect?: boolean }>;
  const defects = Object.values(scenarios).filter((scenario) => scenario.defect === true).length;
  result.verdict = defects > 0 ? 'DEFECT_REPRODUCED' : 'NO_DEFECT_OBSERVED';
  result.defectCount = defects;

  writeFileSync(join(HERE, 'repro-antes.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));

  server.closeAllConnections?.();
  server.close();
  // O cliente HTTP da Secretary mantém keep-alive; encerra explicitamente para
  // não deixar o processo do runner pendurado.
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
