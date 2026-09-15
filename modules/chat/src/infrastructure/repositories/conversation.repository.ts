import { db, schema, type DatabaseExecutor } from '@cvg/database';
import { createHash } from 'node:crypto';
import { eq, desc, and, count, inArray, sql, type SQL } from 'drizzle-orm';

export type Conversation = typeof schema.conversations.$inferSelect;
export type NewConversation = typeof schema.conversations.$inferInsert;

export interface ConversationListFilters {
  status?: string;
  statusV2?: string;
  queueId?: string;
  teamId?: string;
  sectorId?: string;
  assignedUserId?: string;
  userId?: string;
  /**
   * Papel global EXPLÍCITO (D01/C02): somente a rota, após verificar
   * `roles.includes('Admin')` ou `sectorPermissionService.isGlobalAdmin`,
   * pode marcar `true`. Ausência de memberships nunca é interpretada como
   * admin — quando `globalAdmin !== true` e o usuário não tem setores, a
   * consulta aplica condição sempre-falsa (deny-by-default).
   */
  globalAdmin?: boolean;
}

/** Posição keyset da ordenação total (unread, handler, updated_at, id), tudo DESC. */
export interface ConversationKeyset {
  unread: 0 | 1;
  handler: 0 | 1;
  /** `updated_at` exato do banco (timestamp sem fuso, microssegundos). */
  updatedAt: string;
  id: string;
}

export interface ConversationPage {
  items: Conversation[];
  /** Presente somente quando há próxima página. */
  nextKeyset: ConversationKeyset | null;
}

const CURSOR_VERSION = 1;
const CURSOR_MAX_LENGTH = 4096;
const CURSOR_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const unreadPriority = sql`CASE WHEN ${schema.conversations.unreadCount} > 0 THEN 1 ELSE 0 END`;
const handlerPriority = sql`CASE WHEN ${schema.conversations.currentHandler} = 'human' THEN 1 ELSE 0 END`;

/**
 * Escopo autorizado do cursor: liga o cursor ao ator e aos filtros da consulta.
 * Recalculado no servidor a cada página; um cursor de outro ator/setor/filtro
 * é recusado (C06: tentativa de atravessar setor não é aceita).
 */
export function conversationCursorScope(actorId: string | undefined, filters: ConversationListFilters): string {
  const scope = JSON.stringify({
    actor: actorId ?? null,
    status: filters.status ?? null,
    statusV2: filters.statusV2 ?? null,
    queueId: filters.queueId ?? null,
    teamId: filters.teamId ?? null,
    sectorId: filters.sectorId ?? null,
    assignedUserId: filters.assignedUserId ?? null,
    userId: filters.userId ?? null,
    globalAdmin: filters.globalAdmin ?? null,
  });
  return createHash('sha256').update(scope).digest('hex').slice(0, 16);
}

/** Serializa a posição keyset em cursor opaco (base64url). */
export function encodeConversationCursor(keyset: ConversationKeyset, scope: string): string {
  return Buffer.from(JSON.stringify({
    v: CURSOR_VERSION,
    u: keyset.unread,
    h: keyset.handler,
    t: keyset.updatedAt,
    i: keyset.id,
    s: scope,
  }), 'utf8').toString('base64url');
}

/**
 * Decodifica e valida o cursor. Retorna `null` para qualquer entrada
 * malformada, versão desconhecida ou escopo diferente — o chamador responde
 * 400 sem detalhar o motivo (não vaza conteúdo nem SQL).
 */
export function decodeConversationCursor(raw: string, expectedScope: string): ConversationKeyset | null {
  try {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > CURSOR_MAX_LENGTH) return null;
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (parsed.v !== CURSOR_VERSION) return null;
    if (parsed.u !== 0 && parsed.u !== 1) return null;
    if (parsed.h !== 0 && parsed.h !== 1) return null;
    if (typeof parsed.t !== 'string' || !CURSOR_TIMESTAMP_PATTERN.test(parsed.t)) return null;
    if (typeof parsed.i !== 'string' || !UUID_PATTERN.test(parsed.i)) return null;
    if (parsed.s !== expectedScope) return null;
    return { unread: parsed.u as 0 | 1, handler: parsed.h as 0 | 1, updatedAt: parsed.t, id: parsed.i };
  } catch {
    return null;
  }
}

async function buildConversationConditions(filters?: ConversationListFilters): Promise<SQL[]> {
  const conditions: SQL[] = [];

  if (filters?.status) conditions.push(eq(schema.conversations.status, filters.status as any));
  if (filters?.statusV2) conditions.push(eq(schema.conversations.statusV2, filters.statusV2 as any));
  if (filters?.queueId) conditions.push(eq(schema.conversations.queueId, filters.queueId));
  if (filters?.teamId) conditions.push(eq(schema.conversations.teamId, filters.teamId));
  if (filters?.sectorId) conditions.push(eq(schema.conversations.sectorId, filters.sectorId));
  if (filters?.assignedUserId) conditions.push(eq(schema.conversations.assignedUserId, filters.assignedUserId));

  // Filtro por setores do usuário (userId fornecido e não-admin explícito).
  // Deny-by-default (BE17/D01): ausência de memberships NUNCA significa admin
  // global; só o papel global explícito dispensa o filtro. A checagem da rota
  // pode ficar obsoleta entre a decisão e esta query (TOCTOU), por isso a
  // releitura de memberships manda — inclusive quando há `sectorId` explícito:
  // sem membership atual no setor pedido, a condição é sempre-falsa (F5).
  if (filters?.userId && filters.globalAdmin !== true) {
    const { userSectors } = schema;
    const userSectorIds = await db.select({ sectorId: userSectors.sectorId })
      .from(userSectors)
      .where(eq(userSectors.userId, filters.userId));
    const memberSectorIds = userSectorIds.map(s => s.sectorId);

    if (filters.sectorId) {
      // O `eq(sectorId)` já entrou acima; a interseção com as memberships
      // atuais vira deny quando o setor pedido não é mais do usuário.
      if (!memberSectorIds.includes(filters.sectorId)) {
        conditions.push(sql`false`);
      }
    } else {
      conditions.push(
        memberSectorIds.length > 0
          ? inArray(schema.conversations.sectorId, memberSectorIds)
          : sql`false`,
      );
    }
  }

  return conditions;
}

export const conversationRepository = {
  async create(data: NewConversation, executor: DatabaseExecutor = db) {
    const [conversation] = await executor.insert(schema.conversations).values(data).returning();
    return conversation;
  },

  /**
   * SA-007: conversa ATIVA do contato dentro do executor (lock/política de
   * conversa única por contato no mesmo commit da criação).
   */
  async findActiveByContactId(contactId: string, executor: DatabaseExecutor = db) {
    const [conversation] = await executor
      .select()
      .from(schema.conversations)
      .where(and(eq(schema.conversations.contactId, contactId), eq(schema.conversations.isActive, true)))
      .limit(1);
    return conversation || null;
  },

  async findById(id: string, executor: DatabaseExecutor = db) {
    const [conversation] = await executor.select().from(schema.conversations).where(eq(schema.conversations.id, id));
    return conversation || null;
  },

  async findByExternalId(externalConversationId: string, executor: DatabaseExecutor = db) {
    const [conversation] = await executor
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.externalConversationId, externalConversationId));
    return conversation || null;
  },

  async findByContactId(contactId: string) {
    return db.select().from(schema.conversations).where(eq(schema.conversations.contactId, contactId));
  },

  /**
   * Listagem legada sem paginação. Mantida para consumidores internos; a rota
   * `GET /conversations` usa `findPage` (cursor keyset, limite máximo).
   */
  async findAll(filters?: ConversationListFilters) {
    let query = db.select().from(schema.conversations).$dynamic();
    const conditions = await buildConversationConditions(filters);

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    return query.orderBy(
      desc(unreadPriority),
      desc(handlerPriority),
      desc(schema.conversations.updatedAt),
    );
  },

  /**
   * Página por cursor keyset com ordenação total
   * (unread_priority, handler_priority, updated_at, id) — todos DESC.
   * O filtro de autorização/escopo entra na cláusula WHERE, portanto o
   * LIMIT é aplicado depois do filtro (autorização precede a paginação).
   * Busca `limit + 1` linhas para decidir `nextKeyset` sem consulta extra.
   */
  async findPage(
    filters: ConversationListFilters,
    limit: number,
    cursor?: ConversationKeyset | null,
  ): Promise<ConversationPage> {
    const conditions = await buildConversationConditions(filters);

    if (cursor) {
      conditions.push(sql`ROW(${unreadPriority}, ${handlerPriority}, ${schema.conversations.updatedAt}, ${schema.conversations.id})
        < ROW(${cursor.unread}::int, ${cursor.handler}::int, ${cursor.updatedAt}::timestamp, ${cursor.id}::uuid)`);
    }

    let query = db
      .select({
        conversation: schema.conversations,
        cursorTimestamp: sql<string>`to_char(${schema.conversations.updatedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US')`.as('cursor_timestamp'),
      })
      .from(schema.conversations)
      .$dynamic();

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const rows = await query
      .orderBy(
        desc(unreadPriority),
        desc(handlerPriority),
        desc(schema.conversations.updatedAt),
        desc(schema.conversations.id),
      )
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];
    const nextKeyset: ConversationKeyset | null = hasMore && last
      ? {
          unread: last.conversation.unreadCount > 0 ? 1 : 0,
          handler: last.conversation.currentHandler === 'human' ? 1 : 0,
          updatedAt: last.cursorTimestamp,
          id: last.conversation.id,
        }
      : null;

    return { items: pageRows.map((row) => row.conversation), nextKeyset };
  },

  /** Registra atividade inbound sem perder incrementos concorrentes. */
  async markInboundUnread(id: string, executor: DatabaseExecutor = db) {
    const [conversation] = await executor
      .update(schema.conversations)
      .set({
        unreadCount: sql`${schema.conversations.unreadCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(schema.conversations.id, id))
      .returning();
    return conversation;
  },

  async markRead(id: string) {
    const [conversation] = await db
      .update(schema.conversations)
      .set({ unreadCount: 0 })
      .where(eq(schema.conversations.id, id))
      .returning();
    return conversation;
  },

  async attachContact(id: string, contactId: string, executor: DatabaseExecutor = db) {
    const [conversation] = await executor
      .update(schema.conversations)
      .set({ contactId })
      .where(eq(schema.conversations.id, id))
      .returning();
    return conversation;
  },

  async update(id: string, data: Partial<NewConversation>) {
    const [conversation] = await db
      .update(schema.conversations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.conversations.id, id))
      .returning();
    return conversation;
  },

  async updateStatusV2(id: string, statusV2: string, userId?: string) {
    const updateData: any = { statusV2, updatedAt: new Date() };

    // Mapear statusV2 para status legado
    const statusMap: Record<string, string> = {
      'novo': 'open',
      'em_atendimento': 'open',
      'pendente': 'pending',
      'em_espera': 'pending',
      'finalizado': 'closed',
      'arquivado': 'archived',
    };
    updateData.status = statusMap[statusV2] || 'open';

    if (statusV2 === 'finalizado' || statusV2 === 'arquivado') {
      updateData.isActive = false;
      updateData.closedAt = new Date();
    }

    if (userId) updateData.assignedUserId = userId;

    const [conversation] = await db
      .update(schema.conversations)
      .set(updateData)
      .where(eq(schema.conversations.id, id))
      .returning();
    return conversation;
  },

  async updateSector(id: string, sectorId: string) {
    const [conversation] = await db
      .update(schema.conversations)
      .set({ sectorId, updatedAt: new Date() })
      .where(eq(schema.conversations.id, id))
      .returning();
    return conversation;
  },

  async assignUser(id: string, userId: string) {
    const [conversation] = await db
      .update(schema.conversations)
      .set({ assignedUserId: userId, updatedAt: new Date() })
      .where(eq(schema.conversations.id, id))
      .returning();
    return conversation;
  },

  async close(id: string) {
    const [conversation] = await db
      .update(schema.conversations)
      .set({ isActive: false, status: 'closed', statusV2: 'finalizado', closedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.conversations.id, id))
      .returning();
    return conversation;
  },

  async addStatusHistory(
    conversationId: string,
    status: string,
    changedBy?: string,
    reason?: string,
    executor: DatabaseExecutor = db,
  ) {
    const [history] = await executor
      .insert(schema.conversationStatusHistory)
      .values({ conversationId, status: status as any, changedBy, reason })
      .returning();
    return history;
  },

  async updateCurrentHandler(conversationId: string, handler: 'bot' | 'human') {
    const [conversation] = await db
      .update(schema.conversations)
      .set({ currentHandler: handler, updatedAt: new Date() })
      .where(eq(schema.conversations.id, conversationId))
      .returning();
    return conversation;
  },

  // Kanban: contar por statusV2
  async countByStatusV2(sectorId?: string) {
    const conditions = sectorId ? [eq(schema.conversations.sectorId, sectorId)] : [];

    const result = await db.select({
      statusV2: schema.conversations.statusV2,
      count: count(),
    })
      .from(schema.conversations)
      .where(conditions.length ? and(...conditions) : undefined)
      .groupBy(schema.conversations.statusV2);

    return result;
  },

  // Kanban: contar por setor
  async countBySector() {
    return db.select({
      sectorId: schema.conversations.sectorId,
      count: count(),
    })
      .from(schema.conversations)
      .where(eq(schema.conversations.isActive, true))
      .groupBy(schema.conversations.sectorId);
  },
};
