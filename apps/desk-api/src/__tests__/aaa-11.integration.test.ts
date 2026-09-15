import './integration-mocks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, schema, getPool } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

/**
 * AAA-11 — paginação por cursor de `GET /conversations` (C06) e seleção da
 * última mensagem/última inbound no banco (achado A10), em PostgreSQL real do
 * run `aaa-20260912-a11` (DATABASE_URL obrigatório, sem fallback 5432).
 *
 * Negativos discriminantes:
 *  - empate de timestamp: varredura completa por páginas sem repetir/perder;
 *  - cursor inválido e cursor de outro escopo/setor -> 400 sem detalhe;
 *  - fronteira de setor: nenhuma conversa de B em nenhuma página de A, mesmo
 *    com B mais recente (autorização precede a paginação);
 *  - teto de página: limit 1..100; 101/0/texto -> 400;
 *  - consulta de última mensagem limitada ao tamanho da página (sem histórico).
 *
 * O DTO existente é preservado (`conversations` + `nextCursor` novo).
 */

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const DB_MARKER = 'aaa-20260912-a11';
const password = 'ChatRoutePass!42';
const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
const runId = `aaa11-${Date.now()}`;
const previousRateLimitMax = process.env.RATE_LIMIT_MAX;

interface Actor {
  id: string;
  email: string;
  token: string;
}

interface CapturedQuery {
  text: string;
  rowCount: number;
}

interface ConversationListItem {
  id: string;
  status: string;
  statusV2: string;
  currentHandler: string;
  unreadCount: number;
  updatedAt: string;
  contactId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  lastMessage: { id: string; content: string; direction: string } | null;
  lastInboundMessage: { id: string; content: string; direction: string } | null;
}

interface ConversationListResponse {
  /** Nome canônico de C06. */
  items: ConversationListItem[];
  /** Alias legado preservado para o frontend atual. */
  conversations: ConversationListItem[];
  nextCursor: string | null;
}

describe('AAA-11 — cursor pagination + last message in database', () => {
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  const createdUserIds: string[] = [];
  const createdSectorIds: string[] = [];
  const createdConversationIds: string[] = [];

  let sectorA = '';
  let sectorB = '';
  let actorReadA: Actor;
  let actorAB: Actor;
  let actorNoSector: Actor;
  let admin: Actor;

  let heavyConversation = '';
  let emptyConversation = '';
  const sectorAConversationIds: string[] = [];
  const sectorBConversationIds: string[] = [];
  let expectedLastMessageId = '';
  let expectedLastInboundId = '';

  const TIE_LIMIT = 7;
  const TIE_CONVERSATIONS = 120;

  async function ensureRole(name: 'Admin' | 'Receptionist'): Promise<string> {
    const [existing] = await db.select().from(schema.roles).where(eq(schema.roles.name, name)).limit(1);
    if (existing) return existing.id;
    const [created] = await db.insert(schema.roles).values({ name }).returning();
    return created.id;
  }

  async function createActor(
    label: string,
    role: 'Admin' | 'Receptionist' | null,
    memberships: Array<{ sectorId: string; accessLevel: 'read' | 'write' | 'admin' }> = [],
  ): Promise<Actor> {
    const id = randomUUID();
    const email = `${runId}.${label}@example.com`;
    await db.insert(schema.users).values({ id, name: `AAA11 ${label}`, email, passwordHash, isActive: true });
    createdUserIds.push(id);
    if (role) {
      const roleId = await ensureRole(role);
      await db.insert(schema.userRoles).values({ userId: id, roleId });
    }
    for (const membership of memberships) {
      await db.insert(schema.userSectors).values({ userId: id, sectorId: membership.sectorId, accessLevel: membership.accessLevel });
    }
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    if (login.statusCode !== 200) {
      throw new Error(`login falhou para ${label}: ${login.statusCode} ${login.body}`);
    }
    return { id, email, token: (login.json() as { token: string }).token };
  }

  function auth(actor: Actor) {
    return { authorization: `Bearer ${actor.token}` };
  }

  async function createConversation(sectorId: string, updatedAt: Date, overrides: Partial<typeof schema.conversations.$inferInsert> = {}): Promise<string> {
    const [conv] = await db.insert(schema.conversations).values({
      status: 'open',
      statusV2: 'novo',
      currentHandler: 'bot',
      isActive: true,
      sectorId,
      updatedAt,
      createdAt: updatedAt,
      ...overrides,
    }).returning();
    createdConversationIds.push(conv.id);
    return conv.id;
  }

  async function listPage(actor: Actor, query: string): Promise<{ statusCode: number; body: ConversationListResponse; raw: string }> {
    const response = await app.inject({ method: 'GET', url: `/conversations${query}`, headers: auth(actor) });
    const raw = response.body;
    let body: ConversationListResponse = { items: [], conversations: [], nextCursor: null };
    try {
      body = response.json() as ConversationListResponse;
    } catch {
      // resposta de erro (400) não tem DTO
    }
    return { statusCode: response.statusCode, body, raw };
  }

  async function scanAllPages(actor: Actor, limit: number): Promise<{ ids: string[]; pages: number; lastNextCursor: string | null }> {
    const ids: string[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query = `?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = await listPage(actor, query);
      expect(page.statusCode).toBe(200);
      if (page.body.conversations.length > 0) {
        pages += 1;
        for (const item of page.body.conversations) {
          expect(seen.has(item.id), `id repetido entre páginas: ${item.id}`).toBe(false);
          seen.add(item.id);
          ids.push(item.id);
        }
      }
      cursor = page.body.nextCursor;
      if (cursor !== null) {
        expect(page.body.conversations.length).toBe(limit);
      }
      if (pages > 200) throw new Error('scanAllPages: laço de paginação não terminou');
    } while (cursor !== null);
    return { ids, pages, lastNextCursor: cursor };
  }

  async function withQueryCapture<T>(fn: () => Promise<T>): Promise<{ result: T; queries: CapturedQuery[] }> {
    const pool = getPool();
    const queries: CapturedQuery[] = [];
    const original = pool.query.bind(pool) as (...args: unknown[]) => Promise<unknown>;
    (pool as unknown as { query: unknown }).query = (...args: unknown[]) => {
      const first = args[0] as string | { text?: string } | undefined;
      const text = typeof first === 'string' ? first : first?.text;
      const promise = original(...args) as Promise<{ rowCount: number | null }>;
      if (!text) return promise;
      return promise.then((result) => {
        queries.push({ text, rowCount: result?.rowCount ?? 0 });
        return result;
      });
    };
    try {
      const result = await fn();
      return { result, queries };
    } finally {
      (pool as unknown as { query: unknown }).query = original;
    }
  }

  beforeAll(async () => {
    // Guarda de ambiente (C00): recusa URL sem o marcador do run a11 e porta
    // isolada; qualquer outro banco/porta (inclusive 5432) falha alto.
    if (!/cvg_aaa_[a-z0-9_]*a11/.test(DATABASE_URL) || !DATABASE_URL.includes('127.0.0.1:56432')) {
      throw new Error(`AAA-11 exige DATABASE_URL do run a11 em 127.0.0.1:56432; recebido: ${DATABASE_URL}`);
    }
    const markerResult = await db.execute(sql`SELECT run_id FROM aaa_environment_marker WHERE run_id = ${DB_MARKER}`);
    const markerRows = (markerResult as unknown as { rows: Array<{ run_id: string }> }).rows ?? [];
    if (markerRows.length === 0) {
      throw new Error(`Marcador do run ${DB_MARKER} ausente no banco informado.`);
    }

    process.env.GATEWAY_API_KEY = process.env.GATEWAY_API_KEY ?? 'aaa11-service-key';
    process.env.RATE_LIMIT_MAX = '100000';

    app = await buildDeskApiApp();
    await app.ready();

    const suffix = String(Date.now()).slice(-6);
    const [a] = await db.insert(schema.sectors).values({ name: `AAA11 A ${suffix}`, code: `a11a${suffix}` }).returning();
    const [b] = await db.insert(schema.sectors).values({ name: `AAA11 B ${suffix}`, code: `a11b${suffix}` }).returning();
    sectorA = a.id;
    sectorB = b.id;
    createdSectorIds.push(sectorA, sectorB);

    actorReadA = await createActor('read-a', 'Receptionist', [{ sectorId: sectorA, accessLevel: 'read' }]);
    actorAB = await createActor('ab', 'Receptionist', [
      { sectorId: sectorA, accessLevel: 'read' },
      { sectorId: sectorB, accessLevel: 'read' },
    ]);
    actorNoSector = await createActor('no-sector', 'Receptionist', []);
    admin = await createActor('admin', 'Admin', []);

    // --- Setor A: 120 conversas com o MESMO updated_at (empate de timestamp).
    // A ordenação total cai para o id (DESC); a paginação keyset precisa ser
    // estável exatamente nesse cenário.
    const tieTimestamp = new Date('2026-02-01T12:00:00.000Z');
    for (let i = 0; i < TIE_CONVERSATIONS; i += 1) {
      const conversationId = await createConversation(sectorA, tieTimestamp);
      sectorAConversationIds.push(conversationId);
    }
    emptyConversation = sectorAConversationIds[1];

    // Conversa "heavy": prioridade 1 (unread + human) para ficar na primeira
    // página; concentra o histórico que a listagem NÃO pode transferir.
    heavyConversation = sectorAConversationIds[0];
    await db.update(schema.conversations)
      .set({ unreadCount: 3, currentHandler: 'human' })
      .where(eq(schema.conversations.id, heavyConversation));

    const base = Date.now();
    const historyRows = Array.from({ length: 300 }, (_, index) => ({
      conversationId: heavyConversation,
      direction: (index % 3 === 0 ? 'outbound' : 'inbound') as 'outbound' | 'inbound',
      content: `historico ${index}`,
      status: 'delivered' as const,
      createdAt: new Date(base - (index + 1) * 1000),
    }));
    // Empate exato no topo: 4 mensagens com o MESMO created_at; o desempate
    // total (created_at DESC, id DESC) decide a "última".
    const tieAt = new Date(base);
    const tieRows = [
      { conversationId: heavyConversation, direction: 'inbound' as const, content: 'empate inbound 1', status: 'delivered' as const, createdAt: tieAt },
      { conversationId: heavyConversation, direction: 'inbound' as const, content: 'empate inbound 2', status: 'delivered' as const, createdAt: tieAt },
      { conversationId: heavyConversation, direction: 'outbound' as const, content: 'empate outbound 1', status: 'delivered' as const, createdAt: tieAt },
      { conversationId: heavyConversation, direction: 'outbound' as const, content: 'empate outbound 2', status: 'delivered' as const, createdAt: tieAt },
    ];
    await db.insert(schema.messages).values([...historyRows, ...tieRows]);

    const expectedLast = await db.execute(sql`
      SELECT id FROM messages WHERE conversation_id = ${heavyConversation}
      ORDER BY created_at DESC, id DESC LIMIT 1`);
    expectedLastMessageId = (expectedLast as unknown as { rows: Array<{ id: string }> }).rows[0].id;
    const expectedInbound = await db.execute(sql`
      SELECT id FROM messages WHERE conversation_id = ${heavyConversation} AND direction = 'inbound'
      ORDER BY created_at DESC, id DESC LIMIT 1`);
    expectedLastInboundId = (expectedInbound as unknown as { rows: Array<{ id: string }> }).rows[0].id;

    // --- Setor B: 30 conversas MAIS RECENTES que as de A. Se a paginação
    // ocorrer antes da autorização, a primeira página de A viria vazia.
    const newerTimestamp = new Date('2026-03-01T12:00:00.000Z');
    for (let i = 0; i < 30; i += 1) {
      sectorBConversationIds.push(await createConversation(sectorB, newerTimestamp));
    }
    await db.insert(schema.messages).values(sectorBConversationIds.map((conversationId) => ({
      conversationId,
      direction: 'inbound' as const,
      content: 'CONTEUDO-SETOR-B',
      status: 'delivered' as const,
      createdAt: newerTimestamp,
    })));
  });

  afterAll(async () => {
    if (createdConversationIds.length > 0) {
      await db.delete(schema.messages).where(inArray(schema.messages.conversationId, createdConversationIds));
      await db.delete(schema.conversationStatusHistory).where(inArray(schema.conversationStatusHistory.conversationId, createdConversationIds));
      await db.delete(schema.conversations).where(inArray(schema.conversations.id, createdConversationIds));
    }
    for (const userId of createdUserIds) {
      await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, userId));
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
      await db.delete(schema.userSectors).where(eq(schema.userSectors.userId, userId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
    for (const sectorId of createdSectorIds) {
      await db.delete(schema.sectors).where(eq(schema.sectors.id, sectorId));
    }
    if (previousRateLimitMax === undefined) {
      delete process.env.RATE_LIMIT_MAX;
    } else {
      process.env.RATE_LIMIT_MAX = previousRateLimitMax;
    }
    if (app) await app.close();
  });

  describe('contrato paginado compatível (C06)', () => {
    it('default 50 itens + nextCursor, DTO existente preservado', async () => {
      const page = await listPage(actorReadA, '');
      expect(page.statusCode).toBe(200);
      expect(Array.isArray(page.body.conversations)).toBe(true);
      expect(page.body.conversations).toHaveLength(50);
      expect(typeof page.body.nextCursor).toBe('string');
      expect((page.body.nextCursor as string).length).toBeGreaterThan(0);

      // C06: itens canônicos + alias legado com o mesmo conteúdo/ordem.
      expect(page.body.items).toHaveLength(50);
      expect(page.body.items.map((item) => item.id)).toEqual(page.body.conversations.map((item) => item.id));

      const first = page.body.conversations[0];
      expect(typeof first.id).toBe('string');
      expect(typeof first.statusV2).toBe('string');
      expect(typeof first.currentHandler).toBe('string');
      expect(typeof first.unreadCount).toBe('number');
      expect(first).toHaveProperty('lastMessage');
      expect(first).toHaveProperty('lastInboundMessage');
      expect(first).toHaveProperty('contactName');
      expect(first).toHaveProperty('contactPhone');

      const heavy = page.body.conversations.find((c) => c.id === heavyConversation);
      expect(heavy).toBeDefined();
      expect(heavy?.lastMessage?.id).toBe(expectedLastMessageId);
      expect(heavy?.lastInboundMessage?.id).toBe(expectedLastInboundId);
    });

    it('limit explícito respeitado e limit=100 no teto', async () => {
      const ten = await listPage(actorReadA, '?limit=10');
      expect(ten.statusCode).toBe(200);
      expect(ten.body.conversations).toHaveLength(10);

      const hundred = await listPage(actorReadA, '?limit=100');
      expect(hundred.statusCode).toBe(200);
      expect(hundred.body.conversations).toHaveLength(100);
    });

    it('limit fora do teto/ inválido -> 400', async () => {
      for (const query of ['?limit=101', '?limit=0', '?limit=-1', '?limit=abc']) {
        const response = await app.inject({ method: 'GET', url: `/conversations${query}`, headers: auth(actorReadA) });
        expect(response.statusCode, `query ${query}`).toBe(400);
      }
    });
  });

  describe('empate de timestamp e boundary de páginas', () => {
    it('varredura completa com empate: 120 ids únicos, sem repetir/perder, sem B', async () => {
      const { ids, pages } = await scanAllPages(actorReadA, TIE_LIMIT);
      expect(pages).toBe(Math.ceil(TIE_CONVERSATIONS / TIE_LIMIT));
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBeGreaterThanOrEqual(TIE_CONVERSATIONS);
      for (const sectorAId of sectorAConversationIds) {
        expect(ids, `conversa ausente na varredura: ${sectorAId}`).toContain(sectorAId);
      }
      for (const sectorBId of sectorBConversationIds) {
        expect(ids).not.toContain(sectorBId);
      }
    });

    it('última página não devolve nextCursor e conversa sem mensagens tem lastMessage null', async () => {
      const { ids } = await scanAllPages(actorReadA, TIE_LIMIT);
      expect(ids).toContain(emptyConversation);

      // Repete a varredura encontrando a conversa sem mensagens e conferindo o DTO.
      let cursor: string | null = null;
      let found: ConversationListItem | undefined;
      do {
        const page = await listPage(actorReadA, `?limit=${TIE_LIMIT}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        found = page.body.conversations.find((c) => c.id === emptyConversation) ?? found;
        cursor = page.body.nextCursor;
        if (cursor === null) {
          expect(page.body.nextCursor).toBeNull();
        }
      } while (cursor !== null && !found);
      expect(found).toBeDefined();
      expect(found?.lastMessage).toBeNull();
      expect(found?.lastInboundMessage).toBeNull();
    });

    it('inserção concorrente entre páginas não repete nem perde páginas', async () => {
      const page1 = await listPage(actorReadA, '?limit=10');
      expect(page1.statusCode).toBe(200);
      const page1Ids = page1.body.conversations.map((c) => c.id);
      const cursor = page1.body.nextCursor as string;

      const concurrentId = await createConversation(sectorA, new Date());
      sectorAConversationIds.push(concurrentId);
      await db.insert(schema.messages).values({
        conversationId: concurrentId,
        direction: 'inbound',
        content: 'concorrente',
        status: 'delivered',
        createdAt: new Date(),
      });

      const page2 = await listPage(actorReadA, `?limit=10&cursor=${encodeURIComponent(cursor)}`);
      expect(page2.statusCode).toBe(200);
      expect(page2.body.conversations).toHaveLength(10);
      const page2Ids = page2.body.conversations.map((c) => c.id);
      expect(page2Ids.filter((id) => page1Ids.includes(id))).toHaveLength(0);
      expect(page2Ids).not.toContain(concurrentId);

      const freshFirstPage = await listPage(actorReadA, '?limit=10');
      // heavy tem prioridade (unread/human) na frente; a nova conversa vem em
      // seguida, antes de todas as demais de mesmo timestamp fixo.
      expect(freshFirstPage.body.conversations[0]?.id).toBe(heavyConversation);
      expect(freshFirstPage.body.conversations[1]?.id).toBe(concurrentId);
    });
  });

  describe('cursor inválido e fronteira de escopo', () => {
    it('cursor malformado -> 400 seco, sem SQL/stack no corpo', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/conversations?limit=10&cursor=@@nao-e-cursor@@',
        headers: auth(actorReadA),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'INVALID_CURSOR', message: 'Invalid cursor' });
      expect(response.body).not.toMatch(/SELECT|INSERT|FROM |pg_|stack/i);
    });

    it('base64 válido mas shape errado -> 400; cursor de outro ator -> 400', async () => {
      const wrongShape = Buffer.from(JSON.stringify({ v: 1, t: 'x', i: 'y' }), 'utf8').toString('base64url');
      const response = await app.inject({
        method: 'GET',
        url: `/conversations?limit=10&cursor=${wrongShape}`,
        headers: auth(actorReadA),
      });
      expect(response.statusCode).toBe(400);

      const page = await listPage(actorAB, '?limit=5');
      const foreignCursor = page.body.nextCursor as string;
      expect(typeof foreignCursor).toBe('string');
      const otherActor = await app.inject({
        method: 'GET',
        url: `/conversations?limit=5&cursor=${encodeURIComponent(foreignCursor)}`,
        headers: auth(actorReadA),
      });
      expect(otherActor.statusCode).toBe(400);
    });

    it('cursor de um setor não atravessa para outro setor autorizado -> 400', async () => {
      const pageA = await listPage(actorAB, `?sectorId=${sectorA}&limit=5`);
      expect(pageA.statusCode).toBe(200);
      const cursorA = pageA.body.nextCursor as string;
      expect(typeof cursorA).toBe('string');

      const cross = await app.inject({
        method: 'GET',
        url: `/conversations?sectorId=${sectorB}&limit=5&cursor=${encodeURIComponent(cursorA)}`,
        headers: auth(actorAB),
      });
      expect(cross.statusCode).toBe(400);
      expect(cross.body).not.toContain('CONTEUDO-SETOR-B');
    });
  });

  describe('autorização precede a paginação', () => {
    it('B mais recente não ocupa a primeira página de A', async () => {
      const page = await listPage(actorReadA, '?limit=10');
      expect(page.statusCode).toBe(200);
      expect(page.body.conversations).toHaveLength(10);
      for (const item of page.body.conversations) {
        expect(sectorAConversationIds).toContain(item.id);
        expect(sectorBConversationIds).not.toContain(item.id);
      }
      expect(page.raw).not.toContain('CONTEUDO-SETOR-B');
    });

    it('não-membro com filtro de setor alheio continua 403; sem setores continua vazio paginado', async () => {
      const forbidden = await app.inject({
        method: 'GET',
        url: `/conversations?sectorId=${sectorB}`,
        headers: auth(actorReadA),
      });
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.body).not.toContain('CONTEUDO-SETOR-B');

      const empty = await listPage(actorNoSector, '');
      expect(empty.statusCode).toBe(200);
      expect(empty.body.conversations).toHaveLength(0);
      expect(empty.body.items).toHaveLength(0);
      expect(empty.body.nextCursor).toBeNull();
    });
  });

  describe('deep-link fora da primeira página', () => {
    it('conversa autorizada fora da página 1 continua acessível por id; alheia -> 404', async () => {
      const { ids } = await scanAllPages(actorReadA, TIE_LIMIT);
      const deepId = ids[ids.length - 1];
      expect(deepId).toBeDefined();

      const firstPage = await listPage(actorReadA, `?limit=${TIE_LIMIT}`);
      expect(firstPage.body.conversations.map((c) => c.id)).not.toContain(deepId);

      const deep = await app.inject({
        method: 'GET',
        url: `/conversations/${deepId}/messages?limit=5`,
        headers: auth(actorReadA),
      });
      expect(deep.statusCode).toBe(200);

      const cross = await app.inject({
        method: 'GET',
        url: `/conversations/${sectorBConversationIds[0]}/messages`,
        headers: auth(actorReadA),
      });
      expect(cross.statusCode).toBe(404);
      expect(cross.body).not.toContain('CONTEUDO-SETOR-B');

      const adminDeep = await app.inject({
        method: 'GET',
        url: `/conversations/${sectorBConversationIds[0]}/messages?limit=5`,
        headers: auth(admin),
      });
      expect(adminDeep.statusCode).toBe(200);
    });
  });

  describe('última mensagem selecionada no banco (A10)', () => {
    it('uma página não transfere histórico: rows de mensagens <= tamanho da página', async () => {
      const limit = 50;
      const captured = await withQueryCapture(() => listPage(actorReadA, `?limit=${limit}`));
      expect(captured.result.statusCode).toBe(200);
      expect(captured.result.body.conversations).toHaveLength(limit);

      const conversationRows = captured.queries
        .filter((q) => /from "?conversations"?/i.test(q.text))
        .map((q) => q.rowCount);
      expect(conversationRows.length).toBeGreaterThan(0);
      for (const rows of conversationRows) {
        expect(rows).toBeLessThanOrEqual(limit + 1);
      }

      const messageQueries = captured.queries.filter((q) => /from "?messages"?/i.test(q.text));
      // 2 seleções (qualquer direção + inbound) x (LATERAL de ids + hidratação).
      expect(messageQueries.length).toBe(4);
      for (const query of messageQueries) {
        expect(
          query.rowCount,
          `query de última mensagem transferiu ${query.rowCount} linhas (limite ${limit})`,
        ).toBeLessThanOrEqual(limit);
      }
      // A conversa heavy tem 304 mensagens; nenhuma query pode ter lido tudo.
      expect(Math.max(...messageQueries.map((q) => q.rowCount))).toBeLessThan(304);
      // A seleção de ids usa LATERAL com LIMIT 1 (uma sondagem por conversa).
      const lateralQueries = messageQueries.filter((q) => /JOIN LATERAL/i.test(q.text) && /LIMIT 1/i.test(q.text));
      expect(lateralQueries).toHaveLength(2);
    });

    it('desempate por (created_at, id): última e última inbound batem com o SQL', async () => {
      const page = await listPage(actorReadA, '?limit=50');
      const heavy = page.body.conversations.find((c) => c.id === heavyConversation);
      expect(heavy).toBeDefined();
      expect(heavy?.lastMessage?.id).toBe(expectedLastMessageId);
      expect(heavy?.lastInboundMessage?.id).toBe(expectedLastInboundId);
      expect(heavy?.lastInboundMessage?.direction).toBe('inbound');
    });
  });
});
