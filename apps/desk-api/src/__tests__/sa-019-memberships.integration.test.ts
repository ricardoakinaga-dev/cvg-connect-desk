import './integration-mocks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

/**
 * SA-019 — memberships de setores, etiquetas e grupos (B12; gates G02/G05).
 *
 * Executar com PostgreSQL real pelo runner isolado (SA-003):
 *   node scripts/production/run-integration-isolated.mjs --run-id <id> --worker <44-49> \
 *     --skip-seed -- pnpm --filter @cvg/desk-api exec vitest run \
 *     src/__tests__/sa-019-memberships.integration.test.ts
 *
 * Cobertura pré-existente (citada, não repetida):
 *  - CRUD de setores/etiquetas/grupos e negativos de existência:
 *    sectors-routes.integration.test.ts, labels-routes.integration.test.ts,
 *    contact-groups-routes.integration.test.ts;
 *  - membership `read` em listagem/stats de setor, outsider 403 e auditoria de
 *    mudança de membership: sector-authz.integration.test.ts;
 *  - remoção de setor reflete na requisição seguinte (leitura):
 *    dynamic-permissions.integration.test.ts;
 *  - negativos crus de grupo/etiquetas entre setores (GET/POST/DELETE):
 *    aaa-04.integration.test.ts (describe "v6");
 *  - 404 de detalhe negado idêntico ao inexistente nas sub-rotas de contato:
 *    sa-013-authz-matrix.integration.test.ts (casos 7 e 8);
 *  - política vigente de contato sem vínculo (diretório autenticado, D01 OPEN):
 *    AUTORIZACAO-MATRIZ.md §4.1/§9.
 *
 * Lacunas cobertas aqui (SA-019/B12):
 *  AC1 — membership `write` vs `read` vs ausente na MESMA mutação setorizada
 *        (não apenas leitura), revogação no meio da sessão e repetição
 *        idempotente/concorrente sem efeito duplicado;
 *  AC2 — etiqueta/grupo como vínculo a CONTATO: próprio vs alheio,
 *        inexistente, duplicata idempotente e desvínculo;
 *  AC3 — listagem de membros/catálogo não expõe contato fora do escopo e a
 *        contagem é consistente com o que o ator enxerga.
 *
 * Guarda de ambiente: `DATABASE_URL` é sempre obrigatória; o marcador do run
 * (`aaa_environment_marker`) só é exigido quando `AAA_RUN_ID` está definido —
 * execução pelo runner isolado. Em ambiente CI-shaped (`pnpm test:ci`) o teste
 * roda contra o PostgreSQL do CI, sem exigir o marcador (padrão guard-aware).
 */

const password = 'ChatRoutePass!42';
const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

interface Actor {
  id: string;
  token: string;
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

let app: Awaited<ReturnType<typeof buildDeskApiApp>>;

const createdUserIds: string[] = [];
const createdRoleIds: string[] = [];
const createdSectorIds: string[] = [];
const createdConversationIds: string[] = [];
const createdContactIds: string[] = [];
const createdGroupIds: string[] = [];
const createdLabelIds: string[] = [];

async function createActor(
  label: string,
  roleId: string,
  memberships: Array<{ sectorId: string; accessLevel: 'read' | 'write' }> = [],
): Promise<Actor> {
  const id = randomUUID();
  const email = `sa019.${label}.${suffix}@example.com`;
  await db.insert(schema.users).values({ id, name: `SA019 ${label}`, email, passwordHash, isActive: true });
  createdUserIds.push(id);
  await db.insert(schema.userRoles).values({ userId: id, roleId });
  for (const membership of memberships) {
    await db.insert(schema.userSectors).values({
      userId: id,
      sectorId: membership.sectorId,
      accessLevel: membership.accessLevel,
    });
  }
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  expect(login.statusCode, `login de ${label}`).toBe(200);
  return { id, token: (login.json() as { token: string }).token };
}

async function countConversationLabels(conversationId: string, labelId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.conversationLabels.id })
    .from(schema.conversationLabels)
    .where(and(eq(schema.conversationLabels.conversationId, conversationId), eq(schema.conversationLabels.labelId, labelId)));
  return rows.length;
}

async function countContactLabels(contactId: string, labelId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.contactLabels.id })
    .from(schema.contactLabels)
    .where(and(eq(schema.contactLabels.contactId, contactId), eq(schema.contactLabels.labelId, labelId)));
  return rows.length;
}

async function countGroupMembers(groupId: string, contactId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.contactGroupMembers.id })
    .from(schema.contactGroupMembers)
    .where(and(eq(schema.contactGroupMembers.groupId, groupId), eq(schema.contactGroupMembers.contactId, contactId)));
  return rows.length;
}

describe('SA-019 — memberships de setores, etiquetas e grupos (B12, G02/G05)', () => {
  let writer: Actor;
  let reader: Actor;
  let outsider: Actor;
  let revoker: Actor;

  let sectorAId = '';
  let sectorBId = '';
  let conversationAId = '';
  let groupAId = '';
  let labelOneId = '';
  let labelTwoId = '';
  let labelThreeId = '';
  let contactOwnId = '';
  let contactForeignId = '';

  const contactForeignName = `SA019 contato alheio ${suffix}`;
  const contactForeignPhone = `+5521${Date.now().toString().slice(-8)}`;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL ?? '';
    if (!databaseUrl) {
      throw new Error('SA-019 exige DATABASE_URL (use o runner isolado de SA-003).');
    }
    if (process.env.AAA_RUN_ID) {
      // Só exige o marcador quando executado pelo runner isolado; o CI macro usa
      // seu próprio banco com migrações e sem marcador (mesmo padrão guard-aware).
      const marker = await db.execute(sql`SELECT run_id FROM aaa_environment_marker`);
      const rows = (marker as unknown as { rows: Array<{ run_id: string }> }).rows ?? [];
      if (rows.length !== 1 || rows[0].run_id !== process.env.AAA_RUN_ID) {
        throw new Error(
          `SA-019 exige o marcador do run ${process.env.AAA_RUN_ID} no banco informado: ${JSON.stringify(rows)}`,
        );
      }
    }

    app = await buildDeskApiApp();
    await app.ready();

    // Papel customizado com permissões de ação explícitas do banco (0025): o
    // conjunto resolvido é autoritativo, então o escopo de setor é o que decide.
    const [role] = await db.insert(schema.roles).values({ name: `sa019_member_${suffix}` }).returning();
    createdRoleIds.push(role.id);
    for (const permissionName of ['chat:read', 'chat:write']) {
      const [permission] = await db
        .select()
        .from(schema.permissions)
        .where(eq(schema.permissions.name, permissionName))
        .limit(1);
      if (!permission) {
        throw new Error(`Permissão ausente no banco do run (migração 0025): ${permissionName}`);
      }
      await db.insert(schema.rolePermissions).values({ roleId: role.id, permissionId: permission.id });
    }

    const [sectorA] = await db.insert(schema.sectors).values({ name: `SA019 A ${suffix}`, code: `sa019a${suffix}` }).returning();
    const [sectorB] = await db.insert(schema.sectors).values({ name: `SA019 B ${suffix}`, code: `sa019b${suffix}` }).returning();
    sectorAId = sectorA.id;
    sectorBId = sectorB.id;
    createdSectorIds.push(sectorAId, sectorBId);

    writer = await createActor('writer', role.id, [{ sectorId: sectorAId, accessLevel: 'write' }]);
    reader = await createActor('reader', role.id, [{ sectorId: sectorAId, accessLevel: 'read' }]);
    outsider = await createActor('outsider', role.id);
    revoker = await createActor('revoker', role.id, [{ sectorId: sectorAId, accessLevel: 'write' }]);

    const [conversationA] = await db
      .insert(schema.conversations)
      .values({ status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, sectorId: sectorAId })
      .returning();
    conversationAId = conversationA.id;
    createdConversationIds.push(conversationAId);

    const [groupA] = await db
      .insert(schema.contactGroups)
      .values({ name: `SA019 grupo A ${suffix}`, groupType: 'sector', sectorId: sectorAId })
      .returning();
    groupAId = groupA.id;
    createdGroupIds.push(groupAId);

    const [labelOne] = await db.insert(schema.labels).values({ name: `sa019-label-1-${suffix}` }).returning();
    const [labelTwo] = await db.insert(schema.labels).values({ name: `sa019-label-2-${suffix}` }).returning();
    const [labelThree] = await db.insert(schema.labels).values({ name: `sa019-label-3-${suffix}` }).returning();
    labelOneId = labelOne.id;
    labelTwoId = labelTwo.id;
    labelThreeId = labelThree.id;
    createdLabelIds.push(labelOneId, labelTwoId, labelThreeId);

    const [contactOwn] = await db
      .insert(schema.contacts)
      .values({ name: `SA019 contato próprio ${suffix}`, phone: `+5511${Date.now().toString().slice(-8)}` })
      .returning();
    const [contactForeign] = await db
      .insert(schema.contacts)
      .values({ name: contactForeignName, phone: contactForeignPhone })
      .returning();
    contactOwnId = contactOwn.id;
    contactForeignId = contactForeign.id;
    createdContactIds.push(contactOwnId, contactForeignId);
    await db.insert(schema.contactSectors).values({ contactId: contactOwnId, sectorId: sectorAId });
    await db.insert(schema.contactSectors).values({ contactId: contactForeignId, sectorId: sectorBId });
  });

  afterAll(async () => {
    if (!app) return;
    if (createdGroupIds.length > 0) {
      await db.delete(schema.contactGroupMembers).where(inArray(schema.contactGroupMembers.groupId, createdGroupIds));
      await db.delete(schema.contactGroups).where(inArray(schema.contactGroups.id, createdGroupIds));
    }
    if (createdConversationIds.length > 0) {
      await db.delete(schema.conversationLabels).where(inArray(schema.conversationLabels.conversationId, createdConversationIds));
      await db.delete(schema.conversations).where(inArray(schema.conversations.id, createdConversationIds));
    }
    if (createdContactIds.length > 0) {
      await db.delete(schema.contactLabels).where(inArray(schema.contactLabels.contactId, createdContactIds));
      await db.delete(schema.contactSectors).where(inArray(schema.contactSectors.contactId, createdContactIds));
      await db.delete(schema.contacts).where(inArray(schema.contacts.id, createdContactIds));
    }
    if (createdLabelIds.length > 0) {
      await db.delete(schema.labels).where(inArray(schema.labels.id, createdLabelIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.userId, createdUserIds));
      await db.delete(schema.sessions).where(inArray(schema.sessions.userId, createdUserIds));
      await db.delete(schema.userSectors).where(inArray(schema.userSectors.userId, createdUserIds));
      await db.delete(schema.userRoles).where(inArray(schema.userRoles.userId, createdUserIds));
      await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
    }
    if (createdRoleIds.length > 0) {
      await db.delete(schema.rolePermissions).where(inArray(schema.rolePermissions.roleId, createdRoleIds));
      await db.delete(schema.roles).where(inArray(schema.roles.id, createdRoleIds));
    }
    if (createdSectorIds.length > 0) {
      await db.delete(schema.sectors).where(inArray(schema.sectors.id, createdSectorIds));
    }
    await app.close();
  });

  describe('AC1 — membership de setor governa a mutação setorizada (write > read > none)', () => {
    it('AC1: writer anexa etiqueta à conversa do setor e a duplicata é idempotente (uma linha)', async () => {
      const first = await app.inject({
        method: 'POST',
        url: `/conversations/${conversationAId}/labels`,
        headers: bearer(writer.token),
        payload: { labelId: labelTwoId },
      });
      expect(first.statusCode, 'primeiro anexo').toBe(201);
      expect(first.json()).toMatchObject({ added: true });

      const duplicate = await app.inject({
        method: 'POST',
        url: `/conversations/${conversationAId}/labels`,
        headers: bearer(writer.token),
        payload: { labelId: labelTwoId },
      });
      expect(duplicate.statusCode, `duplicata não pode falhar: ${duplicate.body}`).toBeLessThan(300);
      await expect(countConversationLabels(conversationAId, labelTwoId)).resolves.toBe(1);
    });

    it('AC1: membership read recebe 403 no nível da ação e nada é gravado', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/conversations/${conversationAId}/labels`,
        headers: bearer(reader.token),
        payload: { labelId: labelThreeId },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: 'FORBIDDEN' });
      await expect(countConversationLabels(conversationAId, labelThreeId)).resolves.toBe(0);
    });

    it('AC1: ausência de vínculo recebe 404 idêntico ao de conversa inexistente (sem revelar existência)', async () => {
      const noMembership = await app.inject({
        method: 'POST',
        url: `/conversations/${conversationAId}/labels`,
        headers: bearer(outsider.token),
        payload: { labelId: labelThreeId },
      });
      const missing = await app.inject({
        method: 'POST',
        url: `/conversations/${randomUUID()}/labels`,
        headers: bearer(writer.token),
        payload: { labelId: labelThreeId },
      });
      expect(noMembership.statusCode).toBe(404);
      expect(missing.statusCode).toBe(404);
      expect(noMembership.json()).toEqual(missing.json());
      expect(noMembership.body).not.toContain(conversationAId);
      await expect(countConversationLabels(conversationAId, labelThreeId)).resolves.toBe(0);
    });

    it('AC1: revogação de membership nega a requisição seguinte na MESMA sessão', async () => {
      const before = await app.inject({
        method: 'POST',
        url: `/conversations/${conversationAId}/labels`,
        headers: bearer(revoker.token),
        payload: { labelId: labelOneId },
      });
      expect(before.statusCode, 'com write o anexo é autorizado').toBe(201);
      await expect(countConversationLabels(conversationAId, labelOneId)).resolves.toBe(1);

      await db.delete(schema.userSectors).where(eq(schema.userSectors.userId, revoker.id));

      const after = await app.inject({
        method: 'POST',
        url: `/conversations/${conversationAId}/labels`,
        headers: bearer(revoker.token),
        payload: { labelId: labelThreeId },
      });
      expect(after.statusCode, 'sem membership a próxima requisição é 404').toBe(404);
      await expect(countConversationLabels(conversationAId, labelThreeId)).resolves.toBe(0);
    });

    it('AC1: associação concorrente não duplica nem devolve 5xx', async () => {
      const [first, second] = await Promise.all([
        app.inject({
          method: 'POST',
          url: `/conversations/${conversationAId}/labels`,
          headers: bearer(writer.token),
          payload: { labelId: labelThreeId },
        }),
        app.inject({
          method: 'POST',
          url: `/conversations/${conversationAId}/labels`,
          headers: bearer(writer.token),
          payload: { labelId: labelThreeId },
        }),
      ]);
      const statuses = [first.statusCode, second.statusCode];
      expect(
        statuses.filter((status) => status >= 500),
        `corrida não pode virar 500: ${first.body} / ${second.body}`,
      ).toEqual([]);
      expect(statuses.some((status) => status < 300), 'ao menos uma associação deve confirmar').toBe(true);
      await expect(countConversationLabels(conversationAId, labelThreeId)).resolves.toBe(1);
    });
  });

  describe('AC2 — etiquetas de contato: próprio vs alheio, inexistente e duplicata', () => {
    it("AC2: writer anexa etiqueta a contato do próprio setor e a linha persiste", async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/contacts/${contactOwnId}/labels`,
        headers: bearer(writer.token),
        payload: { labelId: labelOneId },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ added: true });
      await expect(countContactLabels(contactOwnId, labelOneId)).resolves.toBe(1);
    });

    it('AC2: duplicata de anexo em contato é idempotente (uma linha, sem 5xx)', async () => {
      const duplicate = await app.inject({
        method: 'POST',
        url: `/contacts/${contactOwnId}/labels`,
        headers: bearer(writer.token),
        payload: { labelId: labelOneId },
      });
      expect(duplicate.statusCode, `duplicata não pode falhar: ${duplicate.body}`).toBeLessThan(300);
      await expect(countContactLabels(contactOwnId, labelOneId)).resolves.toBe(1);
    });

    it('AC2: membership read recebe 403 e ausência de vínculo recebe 404 sem vínculo criado', async () => {
      const readLevel = await app.inject({
        method: 'POST',
        url: `/contacts/${contactOwnId}/labels`,
        headers: bearer(reader.token),
        payload: { labelId: labelTwoId },
      });
      expect(readLevel.statusCode).toBe(403);
      expect(readLevel.json()).toMatchObject({ error: 'FORBIDDEN' });

      const noMembership = await app.inject({
        method: 'POST',
        url: `/contacts/${contactOwnId}/labels`,
        headers: bearer(outsider.token),
        payload: { labelId: labelTwoId },
      });
      expect(noMembership.statusCode).toBe(404);
      expect(noMembership.json()).toMatchObject({ error: 'NOT_FOUND' });
      expect(noMembership.body).not.toContain(contactOwnId);

      await expect(countContactLabels(contactOwnId, labelTwoId)).resolves.toBe(0);
    });

    it('AC2: contato de setor alheio recebe 404 sem vínculo e sem vazar dados do contato', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/contacts/${contactForeignId}/labels`,
        headers: bearer(writer.token),
        payload: { labelId: labelOneId },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: 'NOT_FOUND' });
      expect(response.body).not.toContain(contactForeignId);
      expect(response.body).not.toContain(contactForeignName);
      expect(response.body).not.toContain(contactForeignPhone);
      await expect(countContactLabels(contactForeignId, labelOneId)).resolves.toBe(0);
    });

    it('AC2: contato inexistente é recusado (404, não 500) e o corpo é igual ao do negado por escopo', async () => {
      const missingContactId = randomUUID();
      const deniedByScope = await app.inject({
        method: 'POST',
        url: `/contacts/${contactForeignId}/labels`,
        headers: bearer(writer.token),
        payload: { labelId: labelTwoId },
      });
      const missing = await app.inject({
        method: 'POST',
        url: `/contacts/${missingContactId}/labels`,
        headers: bearer(writer.token),
        payload: { labelId: labelTwoId },
      });
      expect(deniedByScope.statusCode).toBe(404);
      expect(missing.statusCode, `inexistente não pode virar 500: ${missing.body}`).toBe(404);
      expect(missing.json()).toEqual(deniedByScope.json());
      await expect(countContactLabels(missingContactId, labelTwoId)).resolves.toBe(0);
    });

    it('AC2: etiqueta inexistente é recusada sem criar vínculo', async () => {
      const missingLabelId = randomUUID();
      const response = await app.inject({
        method: 'POST',
        url: `/contacts/${contactOwnId}/labels`,
        headers: bearer(writer.token),
        payload: { labelId: missingLabelId },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: 'NOT_FOUND' });
      await expect(countContactLabels(contactOwnId, missingLabelId)).resolves.toBe(0);
    });

    it('AC2: desvincular etiqueta de contato próprio funciona (200 e linha some)', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/contacts/${contactOwnId}/labels/${labelOneId}`,
        headers: bearer(writer.token),
      });
      expect(response.statusCode, `desvínculo de contato próprio deve existir e ser autorizado: ${response.body}`).toBe(200);
      await expect(countContactLabels(contactOwnId, labelOneId)).resolves.toBe(0);
    });

    it('AC2: desvincular etiqueta de contato alheio é negado (404) e preserva a linha', async () => {
      await db
        .insert(schema.contactLabels)
        .values({ contactId: contactForeignId, labelId: labelOneId, createdBy: writer.id })
        .onConflictDoNothing();

      const response = await app.inject({
        method: 'DELETE',
        url: `/contacts/${contactForeignId}/labels/${labelOneId}`,
        headers: bearer(writer.token),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: 'NOT_FOUND' });
      await expect(countContactLabels(contactForeignId, labelOneId)).resolves.toBe(1);
    });
  });

  describe('AC2 — grupos de contatos: membro próprio vs alheio, inexistente e duplicata', () => {
    it('AC2: writer adiciona contato do próprio setor; duplicata é idempotente', async () => {
      const first = await app.inject({
        method: 'POST',
        url: `/contact-groups/${groupAId}/members`,
        headers: bearer(writer.token),
        payload: { contactId: contactOwnId },
      });
      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({ added: true });

      const duplicate = await app.inject({
        method: 'POST',
        url: `/contact-groups/${groupAId}/members`,
        headers: bearer(writer.token),
        payload: { contactId: contactOwnId },
      });
      expect(duplicate.statusCode, `duplicata não pode falhar: ${duplicate.body}`).toBeLessThan(300);
      await expect(countGroupMembers(groupAId, contactOwnId)).resolves.toBe(1);
    });

    it('AC2: contato de setor alheio é negado (404) sem anexar', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/contact-groups/${groupAId}/members`,
        headers: bearer(writer.token),
        payload: { contactId: contactForeignId },
      });
      expect(response.statusCode, `contato fora do escopo não pode entrar no grupo: ${response.body}`).toBe(404);
      expect(response.body).not.toContain(contactForeignName);
      expect(response.body).not.toContain(contactForeignPhone);
      await expect(countGroupMembers(groupAId, contactForeignId)).resolves.toBe(0);
    });

    it('AC2: contato inexistente é recusado (404, não 500) sem anexar', async () => {
      const missingContactId = randomUUID();
      const response = await app.inject({
        method: 'POST',
        url: `/contact-groups/${groupAId}/members`,
        headers: bearer(writer.token),
        payload: { contactId: missingContactId },
      });
      expect(response.statusCode, `contato inexistente não pode virar 500: ${response.body}`).toBe(404);
      await expect(countGroupMembers(groupAId, missingContactId)).resolves.toBe(0);
    });

    it('AC2: membership read recebe 403 e ausência de vínculo recebe 404 ao adicionar/remover', async () => {
      const readAdd = await app.inject({
        method: 'POST',
        url: `/contact-groups/${groupAId}/members`,
        headers: bearer(reader.token),
        payload: { contactId: contactOwnId },
      });
      expect(readAdd.statusCode).toBe(403);

      const outsiderAdd = await app.inject({
        method: 'POST',
        url: `/contact-groups/${groupAId}/members`,
        headers: bearer(outsider.token),
        payload: { contactId: contactOwnId },
      });
      expect(outsiderAdd.statusCode).toBe(404);

      const readRemove = await app.inject({
        method: 'DELETE',
        url: `/contact-groups/${groupAId}/members/${contactOwnId}`,
        headers: bearer(reader.token),
      });
      expect(readRemove.statusCode).toBe(403);

      const outsiderRemove = await app.inject({
        method: 'DELETE',
        url: `/contact-groups/${groupAId}/members/${contactOwnId}`,
        headers: bearer(outsider.token),
      });
      expect(outsiderRemove.statusCode).toBe(404);

      await expect(countGroupMembers(groupAId, contactOwnId)).resolves.toBe(1);
    });

    it('AC2: writer remove membro do próprio setor (200 e linha some)', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/contact-groups/${groupAId}/members/${contactOwnId}`,
        headers: bearer(writer.token),
      });
      expect(response.statusCode).toBe(200);
      await expect(countGroupMembers(groupAId, contactOwnId)).resolves.toBe(0);
    });

    it('AC2: remover contato de setor alheio é negado (404) e preserva a linha', async () => {
      await db
        .insert(schema.contactGroupMembers)
        .values({ groupId: groupAId, contactId: contactForeignId, addedBy: writer.id })
        .onConflictDoNothing();

      const response = await app.inject({
        method: 'DELETE',
        url: `/contact-groups/${groupAId}/members/${contactForeignId}`,
        headers: bearer(writer.token),
      });
      expect(response.statusCode, `desvínculo de contato fora do escopo deve ser negado: ${response.body}`).toBe(404);
      await expect(countGroupMembers(groupAId, contactForeignId)).resolves.toBe(1);
    });
  });

  describe('AC3 — listagens e contagens não vazam fora do escopo', () => {
    it('AC3: listagem de membros não expõe contato de setor alheio', async () => {
      await db
        .insert(schema.contactGroupMembers)
        .values({ groupId: groupAId, contactId: contactForeignId, addedBy: writer.id })
        .onConflictDoNothing();

      const response = await app.inject({
        method: 'GET',
        url: `/contact-groups/${groupAId}/members`,
        headers: bearer(writer.token),
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain(contactForeignId);
      expect(response.body).not.toContain(contactForeignName);
      expect(response.body).not.toContain(contactForeignPhone);
    });

    it('AC3: memberCount do catálogo é consistente com os membros visíveis ao ator', async () => {
      await db
        .insert(schema.contactGroupMembers)
        .values({ groupId: groupAId, contactId: contactForeignId, addedBy: writer.id })
        .onConflictDoNothing();

      const catalog = await app.inject({ method: 'GET', url: '/contact-groups', headers: bearer(writer.token) });
      expect(catalog.statusCode).toBe(200);
      const group = (catalog.json() as Array<{ id: string; memberCount: number }>).find((entry) => entry.id === groupAId);
      expect(group, 'grupo do próprio setor deve aparecer no catálogo').toBeDefined();

      const members = await app.inject({
        method: 'GET',
        url: `/contact-groups/${groupAId}/members`,
        headers: bearer(writer.token),
      });
      expect(members.statusCode).toBe(200);
      const visibleMembers = members.json() as Array<{ contactId: string }>;
      expect(group?.memberCount, 'contagem do catálogo deve refletir o que o ator enxerga').toBe(visibleMembers.length);
    });

    it('AC3: detalhe de etiquetas de contato alheio é indistinguível do inexistente', async () => {
      const foreign = await app.inject({
        method: 'GET',
        url: `/contacts/${contactForeignId}/labels`,
        headers: bearer(writer.token),
      });
      const missing = await app.inject({
        method: 'GET',
        url: `/contacts/${randomUUID()}/labels`,
        headers: bearer(writer.token),
      });
      expect(foreign.statusCode).toBe(404);
      expect(missing.statusCode).toBe(404);
      expect(foreign.json()).toEqual(missing.json());
      expect(foreign.body).not.toContain(contactForeignName);
      expect(foreign.body).not.toContain(contactForeignPhone);
    });
  });

  it('AC2 — contato legível mas sem escrita responde 403 (contrato de autorização), não 404', async () => {
    // Ator com ESCRITA no setor do grupo (B) e apenas LEITURA no setor do
    // contato (A): o gate de grupo passa e o de contato nega com 403 — a
    // matriz distingue 404 (sem vínculo) de 403 (lê mas não escreve).
    const [groupB] = await db
      .insert(schema.contactGroups)
      .values({ name: `SA019 grupo B ${suffix}`, groupType: 'sector', sectorId: sectorBId })
      .returning();
    createdGroupIds.push(groupB.id);
    const crossActor = await createActor('cross', createdRoleIds[0], [
      { sectorId: sectorBId, accessLevel: 'write' },
      { sectorId: sectorAId, accessLevel: 'read' },
    ]);

    const response = await app.inject({
      method: 'POST',
      url: `/contact-groups/${groupB.id}/members`,
      headers: bearer(crossActor.token),
      payload: { contactId: contactOwnId },
    });
    expect(response.statusCode).toBe(403);
    await expect(countGroupMembers(groupB.id, contactOwnId)).resolves.toBe(0);
  });
});
