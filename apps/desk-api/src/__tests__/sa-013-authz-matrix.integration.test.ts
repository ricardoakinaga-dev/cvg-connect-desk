import './integration-mocks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

/**
 * SA-013 — matriz de autorização HTTP (C02, B03/B14, gate G02).
 *
 * Executado com PostgreSQL real pelo runner isolado (SA-003):
 *   node scripts/production/run-integration-isolated.mjs --run-id <id> --worker <45-49> \
 *     --skip-seed -- pnpm --filter @cvg/desk-api exec vitest run \
 *     src/__tests__/sa-013-authz-matrix.integration.test.ts
 *
 * Cobre negativos reais da matriz (AUTORIZACAO-MATRIZ.md §2–§7):
 *  1. membership de A negado em recurso de B → 404 com corpo idêntico ao inexistente;
 *  2. papel customizado sem permissão → 403 independente da existência do recurso;
 *  3. revogação de permissão no meio da sessão → 403 na requisição seguinte;
 *  4. catálogo por papel: Manager sem notes:write, Veterinarian sem admin:read,
 *     Receptionist sem alerts:write;
 *  5. recurso órfão sem setor: somente dono explícito ou admin global;
 *  6. cruzamento de escopo (fronteira executável de "cross-tenant": o schema não
 *     tem tenant; o limite é setor + banco isolado do run) em leitura, escrita e
 *     diretório, sem revelar existência.
 *
 * A matriz documental é a fonte de leitura; este teste é a prova executável.
 */

const password = 'ChatRoutePass!42';
const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

interface Actor {
  id: string;
  email: string;
  token: string;
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

const userIds: string[] = [];
const roleIds: string[] = [];
const sectorIds: string[] = [];
const conversationIds: string[] = [];
const taskIds: string[] = [];
const contactIds: string[] = [];

let app: Awaited<ReturnType<typeof buildDeskApiApp>>;

async function ensureRole(name: string): Promise<string> {
  const [existing] = await db.select().from(schema.roles).where(eq(schema.roles.name, name)).limit(1);
  if (existing) {
    return existing.id;
  }
  const [created] = await db.insert(schema.roles).values({ name }).returning();
  roleIds.push(created.id);
  return created.id;
}

async function grantPermission(roleId: string, permissionName: string): Promise<void> {
  const [permission] = await db
    .select()
    .from(schema.permissions)
    .where(eq(schema.permissions.name, permissionName))
    .limit(1);
  if (!permission) {
    throw new Error(`Permissão ausente no banco do run (migração 0025): ${permissionName}`);
  }
  await db.insert(schema.rolePermissions).values({ roleId, permissionId: permission.id });
}

async function createActor(
  label: string,
  roleId: string | null,
  memberships: Array<{ sectorId: string; accessLevel: 'read' | 'write' | 'admin' }> = [],
): Promise<Actor> {
  const id = randomUUID();
  const email = `sa013.${label}.${suffix}@example.com`;
  await db.insert(schema.users).values({ id, name: `SA013 ${label}`, email, passwordHash, isActive: true });
  userIds.push(id);

  if (roleId) {
    await db.insert(schema.userRoles).values({ userId: id, roleId });
  }
  for (const membership of memberships) {
    await db.insert(schema.userSectors).values({
      userId: id,
      sectorId: membership.sectorId,
      accessLevel: membership.accessLevel,
    });
  }

  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  expect(login.statusCode, `login de ${label}`).toBe(200);
  return { id, email, token: (login.json() as { token: string }).token };
}

describe('SA-013 — matriz de autorização HTTP (C02/C04, G02)', () => {
  let admin: Actor;
  let memberA: Actor;
  let outsider: Actor;
  let orphanOwner: Actor;
  let customVoid: Actor;
  let customTasks: Actor;
  let manager: Actor;
  let veterinarian: Actor;
  let receptionist: Actor;

  let sectorAId = '';
  let sectorBId = '';
  let convAId = '';
  let convBId = '';
  let convOrphanId = '';
  let taskOrphanId = '';
  let contactBId = '';
  let contactOrphanId = '';
  let customTasksRoleId = '';

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL ?? '';
    if (!databaseUrl) {
      throw new Error('SA-013 exige DATABASE_URL (use o runner isolado de SA-003).');
    }
    if (process.env.AAA_RUN_ID) {
      // Só exige o marcador quando executado pelo runner isolado; CI macro usa
      // connect_desk_db com migrações e sem marcador (mesmo padrão guard-aware).
      const marker = await db.execute(sql`SELECT run_id FROM aaa_environment_marker`);
      const rows = (marker as unknown as { rows: Array<{ run_id: string }> }).rows ?? [];
      if (rows.length !== 1 || rows[0].run_id !== process.env.AAA_RUN_ID) {
        throw new Error(
          `SA-013 exige o marcador do run ${process.env.AAA_RUN_ID} no banco informado: ${JSON.stringify(rows)}`,
        );
      }
    }

    app = await buildDeskApiApp();
    await app.ready();

    const [sectorA] = await db.insert(schema.sectors).values({ name: `SA013 A ${suffix}`, code: `sa013a${suffix}` }).returning();
    const [sectorB] = await db.insert(schema.sectors).values({ name: `SA013 B ${suffix}`, code: `sa013b${suffix}` }).returning();
    sectorAId = sectorA.id;
    sectorBId = sectorB.id;
    sectorIds.push(sectorAId, sectorBId);

    const adminRoleId = await ensureRole('Admin');
    const receptionistRoleId = await ensureRole('Receptionist');
    const managerRoleId = await ensureRole('Manager');
    const veterinarianRoleId = await ensureRole('Veterinarian');

    // Papel customizado SEM nenhuma permissão (instalação provisionada ⇒ vazio é autoritativo).
    const customVoidRoleId = await ensureRole(`sa013_void_${suffix}`);
    // Papel customizado COM tasks:read (revogado no caso 3).
    customTasksRoleId = await ensureRole(`sa013_tasks_${suffix}`);
    await grantPermission(customTasksRoleId, 'tasks:read');

    admin = await createActor('admin', adminRoleId);
    memberA = await createActor('member-a', receptionistRoleId, [{ sectorId: sectorAId, accessLevel: 'read' }]);
    outsider = await createActor('outsider', receptionistRoleId);
    orphanOwner = await createActor('orphan-owner', receptionistRoleId);
    customVoid = await createActor('custom-void', customVoidRoleId);
    customTasks = await createActor('custom-tasks', customTasksRoleId);
    manager = await createActor('manager', managerRoleId);
    veterinarian = await createActor('vet', veterinarianRoleId);
    receptionist = await createActor('receptionist', receptionistRoleId);

    const [convA] = await db.insert(schema.conversations).values({
      status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, sectorId: sectorAId,
    }).returning();
    const [convB] = await db.insert(schema.conversations).values({
      status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, sectorId: sectorBId,
    }).returning();
    const [convOrphan] = await db.insert(schema.conversations).values({
      status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, assignedUserId: orphanOwner.id,
    }).returning();
    convAId = convA.id;
    convBId = convB.id;
    convOrphanId = convOrphan.id;
    conversationIds.push(convAId, convBId, convOrphanId);

    const [taskOrphan] = await db.insert(schema.tasks).values({
      title: `SA013 task orfa ${suffix}`, createdBy: orphanOwner.id,
    }).returning();
    taskOrphanId = taskOrphan.id;
    taskIds.push(taskOrphanId);

    const [contactB] = await db.insert(schema.contacts).values({
      name: `SA013 contato B ${suffix}`, phone: `+5511${suffix}`,
    }).returning();
    const [contactOrphan] = await db.insert(schema.contacts).values({
      name: `SA013 contato orfao ${suffix}`, phone: `+5521${suffix}`,
    }).returning();
    contactBId = contactB.id;
    contactOrphanId = contactOrphan.id;
    contactIds.push(contactBId, contactOrphanId);
    await db.insert(schema.contactSectors).values({ contactId: contactBId, sectorId: sectorBId });
  });

  afterAll(async () => {
    if (conversationIds.length > 0) {
      await db.delete(schema.messages).where(inArray(schema.messages.conversationId, conversationIds));
      await db.delete(schema.conversationStatusHistory).where(inArray(schema.conversationStatusHistory.conversationId, conversationIds));
      await db.delete(schema.internalNotes).where(inArray(schema.internalNotes.conversationId, conversationIds));
      await db.delete(schema.alerts).where(inArray(schema.alerts.conversationId, conversationIds));
    }
    if (taskIds.length > 0) {
      await db.delete(schema.internalNotes).where(inArray(schema.internalNotes.taskId, taskIds));
      await db.delete(schema.alerts).where(inArray(schema.alerts.taskId, taskIds));
      await db.delete(schema.taskStatusHistory).where(inArray(schema.taskStatusHistory.taskId, taskIds));
      await db.delete(schema.tasks).where(inArray(schema.tasks.id, taskIds));
    }
    if (conversationIds.length > 0) {
      await db.delete(schema.conversations).where(inArray(schema.conversations.id, conversationIds));
    }
    if (contactIds.length > 0) {
      await db.delete(schema.contactSectors).where(inArray(schema.contactSectors.contactId, contactIds));
      await db.delete(schema.contacts).where(inArray(schema.contacts.id, contactIds));
    }
    if (userIds.length > 0) {
      await db.delete(schema.userSectors).where(inArray(schema.userSectors.userId, userIds));
      await db.delete(schema.userRoles).where(inArray(schema.userRoles.userId, userIds));
      await db.delete(schema.sessions).where(inArray(schema.sessions.userId, userIds));
      await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.userId, userIds));
      await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    }
    if (sectorIds.length > 0) {
      await db.delete(schema.sectors).where(inArray(schema.sectors.id, sectorIds));
    }
    if (roleIds.length > 0) {
      await db.delete(schema.rolePermissions).where(inArray(schema.rolePermissions.roleId, roleIds));
      await db.delete(schema.roles).where(inArray(schema.roles.id, roleIds));
    }
    await app.close();
  });

  it('caso 1 — membro do setor A recebe 404 idêntico ao inexistente em recurso do setor B', async () => {
    const missingConversationId = randomUUID();

    const foreignMessages = await app.inject({
      method: 'GET', url: `/conversations/${convBId}/messages`, headers: bearer(memberA.token),
    });
    const missingMessages = await app.inject({
      method: 'GET', url: `/conversations/${missingConversationId}/messages`, headers: bearer(memberA.token),
    });
    expect(foreignMessages.statusCode).toBe(404);
    expect(missingMessages.statusCode).toBe(404);
    expect(foreignMessages.json()).toEqual(missingMessages.json());
    expect(JSON.stringify(foreignMessages.json())).not.toContain(convBId);

    const foreignContext = await app.inject({
      method: 'GET', url: `/tasks?conversationId=${convBId}`, headers: bearer(memberA.token),
    });
    const missingContext = await app.inject({
      method: 'GET', url: `/tasks?conversationId=${missingConversationId}`, headers: bearer(memberA.token),
    });
    expect(foreignContext.statusCode).toBe(404);
    expect(missingContext.statusCode).toBe(404);
    expect(foreignContext.json()).toEqual(missingContext.json());

    const foreignNotes = await app.inject({
      method: 'GET', url: `/notes?conversationId=${convBId}`, headers: bearer(memberA.token),
    });
    expect(foreignNotes.statusCode).toBe(404);

    // Contraprova: o próprio setor é acessível e a lista não contém o setor alheio.
    const ownMessages = await app.inject({
      method: 'GET', url: `/conversations/${convAId}/messages`, headers: bearer(memberA.token),
    });
    expect(ownMessages.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/conversations', headers: bearer(memberA.token) });
    expect(list.statusCode).toBe(200);
    const listedIds = (list.json() as { conversations: Array<{ id: string }> }).conversations.map((c) => c.id);
    expect(listedIds).toContain(convAId);
    expect(listedIds).not.toContain(convBId);
  });

  it('caso 2 — papel customizado sem permissão recebe 403 independentemente da existência do recurso', async () => {
    const taskList = await app.inject({ method: 'GET', url: '/tasks', headers: bearer(customVoid.token) });
    expect(taskList.statusCode).toBe(403);
    expect(taskList.json()).toMatchObject({ error: 'FORBIDDEN' });

    const conversationList = await app.inject({ method: 'GET', url: '/conversations', headers: bearer(customVoid.token) });
    expect(conversationList.statusCode).toBe(403);

    const existing = await app.inject({
      method: 'GET', url: `/conversations/${convAId}/messages`, headers: bearer(customVoid.token),
    });
    const missing = await app.inject({
      method: 'GET', url: `/conversations/${randomUUID()}/messages`, headers: bearer(customVoid.token),
    });
    expect(existing.statusCode).toBe(403);
    expect(missing.statusCode).toBe(403);
    // A camada de ação decide antes de resolver o recurso: nenhuma distinção.
    expect(existing.json()).toEqual(missing.json());
  });

  it('caso 3 — permissão revogada no meio da sessão nega a requisição seguinte (sem re-login)', async () => {
    const before = await app.inject({ method: 'GET', url: '/tasks', headers: bearer(customTasks.token) });
    expect(before.statusCode).toBe(200);
    expect(Array.isArray(before.json())).toBe(true);

    // Com permissão de ação e sem membership: o escopo nega (404), não a ação.
    const scopedBefore = await app.inject({
      method: 'GET', url: `/tasks?conversationId=${convAId}`, headers: bearer(customTasks.token),
    });
    expect(scopedBefore.statusCode).toBe(404);

    await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, customTasksRoleId));

    const after = await app.inject({ method: 'GET', url: '/tasks', headers: bearer(customTasks.token) });
    expect(after.statusCode).toBe(403);
    expect(after.json()).toMatchObject({ error: 'FORBIDDEN' });

    const scopedAfter = await app.inject({
      method: 'GET', url: `/tasks?conversationId=${convAId}`, headers: bearer(customTasks.token),
    });
    expect(scopedAfter.statusCode).toBe(403);
  });

  it('caso 4 — catálogo por papel: Manager sem notes:write, Veterinarian sem admin:read, Receptionist sem alerts:write', async () => {
    const managerNotes = await app.inject({
      method: 'POST', url: '/notes', headers: bearer(manager.token), payload: { content: 'sa013 manager' },
    });
    expect(managerNotes.statusCode).toBe(403);

    const managerAdmin = await app.inject({ method: 'GET', url: '/admin/users', headers: bearer(manager.token) });
    expect(managerAdmin.statusCode).toBe(200);

    const vetAdmin = await app.inject({ method: 'GET', url: '/admin/users', headers: bearer(veterinarian.token) });
    expect(vetAdmin.statusCode).toBe(403);

    const receptionistAlerts = await app.inject({
      method: 'POST', url: '/alerts', headers: bearer(receptionist.token),
      payload: { type: 'message', title: 'sa013 sem permissão' },
    });
    expect(receptionistAlerts.statusCode).toBe(403);

    const contactList = await app.inject({ method: 'GET', url: '/contacts', headers: bearer(receptionist.token) });
    expect(contactList.statusCode).toBe(200);
  });

  it('caso 5 — recurso órfão sem setor: somente dono explícito ou admin global', async () => {
    const stranger = await app.inject({
      method: 'GET', url: `/conversations/${convOrphanId}/messages`, headers: bearer(outsider.token),
    });
    expect(stranger.statusCode).toBe(404);

    const owner = await app.inject({
      method: 'GET', url: `/conversations/${convOrphanId}/messages`, headers: bearer(orphanOwner.token),
    });
    expect(owner.statusCode).toBe(200);

    const adminOverride = await app.inject({
      method: 'GET', url: `/conversations/${convOrphanId}/messages`, headers: bearer(admin.token),
    });
    expect(adminOverride.statusCode).toBe(200);

    const orphanTaskStranger = await app.inject({
      method: 'GET', url: `/tasks/${taskOrphanId}`, headers: bearer(outsider.token),
    });
    expect(orphanTaskStranger.statusCode).toBe(404);

    const orphanTaskOwner = await app.inject({
      method: 'GET', url: `/tasks/${taskOrphanId}`, headers: bearer(orphanOwner.token),
    });
    expect(orphanTaskOwner.statusCode).toBe(200);

    // Sem vínculo não entra em lista contextual: outsider não herda escopo.
    const outsiderList = await app.inject({ method: 'GET', url: '/conversations', headers: bearer(outsider.token) });
    expect(outsiderList.statusCode).toBe(200);
    expect((outsiderList.json() as { conversations: unknown[] }).conversations).toHaveLength(0);
  });

  it('caso 6 — cruzamento de escopo em leitura, escrita e diretório não revela existência', async () => {
    // Fronteira executável de "cross-tenant": o schema não tem tenant; o limite é
    // o setor + o banco isolado do run. O teste fala com o banco da URL do run.
    const current = await db.execute(sql`SELECT current_database() AS name`);
    const rows = (current as unknown as { rows: Array<{ name: string }> }).rows ?? [];
    const expectedName = new URL(process.env.DATABASE_URL as string).pathname.replace(/^\//, '');
    expect(rows[0]?.name).toBe(expectedName);

    // Leitura: filtro explícito de setor alheio é 403 seco (escopo pedido pelo cliente).
    const explicitForeignSector = await app.inject({
      method: 'GET', url: `/conversations?sectorId=${sectorBId}`, headers: bearer(memberA.token),
    });
    expect(explicitForeignSector.statusCode).toBe(403);
    expect(explicitForeignSector.json()).toMatchObject({ error: 'FORBIDDEN' });

    // Escrita: criar task na conversa do setor B → 404 idêntico a UUID inexistente.
    const foreignCreate = await app.inject({
      method: 'POST', url: '/tasks', headers: bearer(memberA.token),
      payload: { title: 'sa013 cross', conversationId: convBId },
    });
    const missingCreate = await app.inject({
      method: 'POST', url: '/tasks', headers: bearer(memberA.token),
      payload: { title: 'sa013 cross', conversationId: randomUUID() },
    });
    expect(foreignCreate.statusCode).toBe(404);
    expect(missingCreate.statusCode).toBe(404);
    expect(foreignCreate.json()).toEqual(missingCreate.json());

    // Diretório: contato vinculado ao setor B é 404 e não vaza nome/telefone.
    const foreignContact = await app.inject({
      method: 'GET', url: `/contacts/${contactBId}`, headers: bearer(memberA.token),
    });
    expect(foreignContact.statusCode).toBe(404);
    expect(foreignContact.json()).toMatchObject({ error: 'NOT_FOUND' });
    expect(JSON.stringify(foreignContact.json())).not.toContain(contactBId);
    expect(JSON.stringify(foreignContact.json())).not.toContain('SA013 contato B');

    // Política vigente do diretório (D01 OPEN): contato SEM vínculo é visível a
    // qualquer autenticado com chat:read — documentado, não ratificado.
    const orphanContact = await app.inject({
      method: 'GET', url: `/contacts/${contactOrphanId}`, headers: bearer(memberA.token),
    });
    expect(orphanContact.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/contacts', headers: bearer(memberA.token) });
    expect(list.statusCode).toBe(200);
    const listedIds = (list.json() as Array<{ id: string }>).map((c) => c.id);
    expect(listedIds).toContain(contactOrphanId);
    expect(listedIds).not.toContain(contactBId);
  });

  it('caso 7 — detalhe negado (task/nota/alerta/contato) é indistinguível do inexistente', async () => {
    // Regressão do achado G02: antes, o detalhe negado revelava existência por
    // mensagem diferente da do recurso inexistente.
    const [taskB] = await db.insert(schema.tasks).values({
      title: `SA013 detalhe task B ${suffix}`, conversationId: convBId, createdBy: manager.id,
    }).returning();
    taskIds.push(taskB.id);

    const [noteB] = await db.insert(schema.internalNotes).values({
      referenceType: 'conversation', referenceId: convBId, conversationId: convBId,
      authorId: manager.id, content: `SA013 detalhe nota B ${suffix}`,
    }).returning();

    const [alertB] = await db.insert(schema.alerts).values({
      conversationId: convBId, type: 'system', title: `SA013 detalhe alerta B ${suffix}`, severity: 'warning', status: 'active',
    }).returning();

    const pairs: Array<{ name: string; deniedUrl: string; missingUrl: string }> = [
      { name: 'task', deniedUrl: `/tasks/${taskB.id}`, missingUrl: `/tasks/${randomUUID()}` },
      { name: 'note', deniedUrl: `/notes/${noteB.id}`, missingUrl: `/notes/${randomUUID()}` },
      { name: 'alert', deniedUrl: `/alerts/${alertB.id}`, missingUrl: `/alerts/${randomUUID()}` },
      { name: 'contact', deniedUrl: `/contacts/${contactBId}`, missingUrl: `/contacts/${randomUUID()}` },
    ];

    for (const pair of pairs) {
      const denied = await app.inject({ method: 'GET', url: pair.deniedUrl, headers: bearer(memberA.token) });
      const missing = await app.inject({ method: 'GET', url: pair.missingUrl, headers: bearer(memberA.token) });
      expect(denied.statusCode, `${pair.name}: status`).toBe(404);
      expect(missing.statusCode, `${pair.name}: status do inexistente`).toBe(404);
      expect(denied.json(), `${pair.name}: corpo idêntico (sem revelar existência)`).toEqual(missing.json());
      expect(JSON.stringify(denied.json())).not.toContain('SA013 detalhe');
    }
  });

  it('caso 8 — sub-rotas de contato e Kanban não distinguem negado de inexistente', async () => {
    // Achado do crítico: /contacts/:id/{groups,labels,transfers} respondiam 200 []
    // para contato INEXISTENTE e 404 para negado; o move do Kanban usava corpos
    // diferentes. Agora ambos são 404 com o MESMO corpo.
    const missingContactId = randomUUID();
    for (const suffixPath of ['groups', 'labels', 'transfers']) {
      const denied = await app.inject({
        method: 'GET', url: `/contacts/${contactBId}/${suffixPath}`, headers: bearer(memberA.token),
      });
      const missing = await app.inject({
        method: 'GET', url: `/contacts/${missingContactId}/${suffixPath}`, headers: bearer(memberA.token),
      });
      expect(denied.statusCode, `${suffixPath}: negado`).toBe(404);
      expect(missing.statusCode, `${suffixPath}: inexistente`).toBe(404);
      expect(denied.json(), `${suffixPath}: corpo idêntico`).toEqual(missing.json());
    }

    const deniedMove = await app.inject({
      method: 'PATCH', url: `/kanban/card/${convBId}/move`,
      headers: bearer(memberA.token), payload: { status: 'pendente' },
    });
    const missingMove = await app.inject({
      method: 'PATCH', url: `/kanban/card/${randomUUID()}/move`,
      headers: bearer(memberA.token), payload: { status: 'pendente' },
    });
    expect(deniedMove.statusCode).toBe(404);
    expect(missingMove.statusCode).toBe(404);
    expect(deniedMove.json()).toEqual(missingMove.json());
  });
});
