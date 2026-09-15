/**
 * PROD-04 — reprodução dos achados BE04/BE17 no candidato ANTES da correção.
 *
 * Roda contra PostgreSQL/Redis isolados do harness AAA (nunca o banco do host):
 *   AAA_RUN_ID=prod04-20260913 AAA_WORKER_INDEX=10 \
 *     pnpm exec tsx docs/producao-2026-09-13/evidencias/prod-04/repro.ts
 *
 * NÃO faz teardown: PostgreSQL/Redis permanecem ativos para a suíte
 * `prod-04.test.ts` reaproveitar o mesmo run e encerrar ao final.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const PROGRAM_DIR = process.env.CVG_PROGRAM_DIR || join(REPO_ROOT, 'docs', 'producao-2026-09-13');
const RUNTIME_DIR = process.env.CVG_RUNTIME_DIR || join(PROGRAM_DIR, 'evidencias', 'prod-04', 'runtime');

process.env.CVG_PROGRAM_DIR = PROGRAM_DIR;
process.env.CVG_RUNTIME_DIR = RUNTIME_DIR;
process.env.AAA_RUN_ID = process.env.AAA_RUN_ID || 'prod04-20260913';
process.env.AAA_WORKER_INDEX = process.env.AAA_WORKER_INDEX || '10';
process.env.RATE_LIMIT_MAX = '100000';
process.env.GATEWAY_API_KEY = process.env.GATEWAY_API_KEY || 'prod04-repro-service-key';

const password = 'ChatRoutePass!42';
const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
const suffix = Date.now().toString().slice(-6);

async function main() {
  const runContextModule = await import(pathToFileURL(join(REPO_ROOT, 'e2e/support/aaa/run-context.ts')).href);
  const isolatedEnvModule = await import(pathToFileURL(join(REPO_ROOT, 'e2e/support/aaa/isolated-env.ts')).href);
  const ctx = runContextModule.getRunContext(Number(process.env.AAA_WORKER_INDEX));
  const isolated = await isolatedEnvModule.provisionIsolatedEnv(ctx);

  const migrated = spawnSync('pnpm', ['--filter', '@cvg/database', 'run', 'db:migrate'], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: ctx.databaseUrl },
    encoding: 'utf8',
  });
  if (migrated.status !== 0) {
    throw new Error(`db:migrate falhou (exit ${migrated.status}): ${migrated.stderr || migrated.stdout}`);
  }

  process.env.DATABASE_URL = ctx.databaseUrl;
  process.env.REDIS_URL = ctx.redisUrl;

  const { db, schema } = await import(pathToFileURL(join(REPO_ROOT, 'packages/database/src/index.ts')).href);
  const appModule = await import(pathToFileURL(join(REPO_ROOT, 'apps/desk-api/src/app.ts')).href);
  const app = await appModule.buildDeskApiApp();
  await app.ready();

  const [sector] = await db.insert(schema.sectors).values({
    name: `PROD04 repro ${suffix}`, code: `p04repro${suffix}`.slice(0, 50), isActive: true,
  }).returning();
  const [conversation] = await db.insert(schema.conversations).values({
    status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, sectorId: sector.id,
  }).returning();
  await db.insert(schema.messages).values({
    conversationId: conversation.id,
    direction: 'inbound',
    content: `CONTEUDO-PROD04-REPRO-${suffix}`,
    sender: '+5511900000000',
    status: 'delivered',
  });

  let [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'Receptionist')).limit(1);
  if (!role) {
    [role] = await db.insert(schema.roles).values({ name: 'Receptionist' }).returning();
  }

  async function createActor(label: string, roleId: string | null, withMembership: boolean) {
    const id = randomUUID();
    const email = `prod04.repro.${suffix}.${label}@example.com`;
    await db.insert(schema.users).values({ id, name: `PROD04 repro ${label}`, email, passwordHash, isActive: true });
    if (roleId) await db.insert(schema.userRoles).values({ userId: id, roleId });
    if (withMembership) {
      await db.insert(schema.userSectors).values({ userId: id, sectorId: sector.id, accessLevel: 'read' });
    }
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    if (login.statusCode !== 200) throw new Error(`login ${label} falhou: ${login.statusCode}`);
    return { id, token: login.json().token as string };
  }

  const rolelessMember = await createActor('roleless-member', null, true);
  const staleMembership = await createActor('stale-membership', role.id, true);

  // Probe 1 — GET /conversations sem sectorId e sem role (achado BE04).
  const list = await app.inject({
    method: 'GET', url: '/conversations', headers: { authorization: `Bearer ${rolelessMember.token}` },
  });
  const listBody = list.json() as { conversations?: Array<{ id: string }>; items?: Array<{ id: string }> };
  const listIds = (listBody.conversations ?? listBody.items ?? []).map((c) => c.id);

  // Probe 2 — helper puro com ator SEM role (achado BE04: allowed:true).
  const { authorizeConversationResource } = await import(
    pathToFileURL(join(REPO_ROOT, 'packages/auth/src/index.ts')).href
  );
  const helperDecision = await authorizeConversationResource({
    actor: { id: rolelessMember.id, roles: [] },
    action: 'chat:read',
    conversation: { id: conversation.id, sectorId: sector.id },
    requiredLevel: 'read',
  });

  // Probe 3 — TOCTOU/BE17: membership revogada entre a checagem da rota e a query.
  // O repositório é chamado exatamente como a rota o chama (filtro userId), após
  // a revogação que a checagem antecipada já teria visto como membership viva.
  await db.delete(schema.userSectors).where(eq(schema.userSectors.userId, staleMembership.id));
  const { conversationRepository } = await import(
    pathToFileURL(join(REPO_ROOT, 'modules/chat/src/infrastructure/repositories/conversation.repository.ts')).href
  );
  const pageAfterRevocation = await conversationRepository.findPage({ userId: staleMembership.id }, 50);
  const leakedIds: string[] = pageAfterRevocation.items.map((item: { id: string }) => item.id);

  const result = {
    runId: ctx.runId,
    databaseName: isolated.databaseName,
    probes: {
      B_E04_rotaSemChatRead: {
        status: list.statusCode,
        conversasRetornadas: listIds,
        vazouConversaDoSetor: listIds.includes(conversation.id),
      },
      B_E04_helperSemRole: helperDecision,
      B_E17_membershipRevogadaNaQuery: {
        itensRetornados: leakedIds.length,
        vazouConversaDoSetor: leakedIds.includes(conversation.id),
      },
    },
  };

  console.error(JSON.stringify(result, null, 2));
  await app.close();
  console.log(`provisionado e mantido ativo: ${ctx.databaseUrl} / ${ctx.redisUrl}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
