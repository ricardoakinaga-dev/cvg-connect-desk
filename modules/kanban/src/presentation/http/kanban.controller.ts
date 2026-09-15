import { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { authenticate, authorizeConversationResource, authorizeSectorScope, requirePermission, sectorPermissionService } from '@cvg/auth';
import { AppError } from '@cvg/shared';
import { KanbanRepository } from '../../infrastructure/kanban.repository';
import type { KanbanBoard, KanbanColumn } from '../../types';

const STATUS_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  'novo': { label: 'Novo', icon: '🟢', color: '#22c55e' },
  'em_atendimento': { label: 'Em Atendimento', icon: '🔵', color: '#3b82f6' },
  'pendente': { label: 'Pendente', icon: '🟡', color: '#eab308' },
  'em_espera': { label: 'Em Espera', icon: '⏳', color: '#f97316' },
  'finalizado': { label: 'Finalizado', icon: '✅', color: '#6b7280' },
  'arquivado': { label: 'Arquivado', icon: '📁', color: '#9ca3af' },
};

export async function registerKanbanRoutes(app: FastifyInstance) {
  const repo = new KanbanRepository();

  // Board Kanban
  app.get('/kanban/board', {
    // AC2 (C02): leitura do board exige ação (`chat:read`) antes da consulta;
    // cada card ainda passa pelo helper de recurso (setor do card).
    preHandler: [authenticate, requirePermission('chat:read')],
    schema: {
      description: 'Dados do board Kanban',
      tags: ['Kanban'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          sectorId: { type: 'string' },
          assignedUserId: { type: 'string' },
          labelId: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const filters = request.query as { sectorId?: string; assignedUserId?: string; labelId?: string };

    const [filterOptions, stats] = await Promise.all([
      repo.getFilters(),
      repo.getStats(filters.sectorId),
    ]);

    // Autorização por recurso (C02 §1): o board não devolve cards de conversas
    // sem leitura do ator; admin vê tudo. A query é feita na apresentação
    // porque a consulta equivalente do repositório está quebrada (binding de
    // array) e o repositório está fora do escopo de escrita desta correção.
    const userId = request.user?.id;
    const isAdmin = (request.user?.roles ?? []).includes('Admin')
      || (userId ? await sectorPermissionService.isGlobalAdmin(userId) : false);

    const conditions = [eq(schema.conversations.isActive, true)];
    if (filters.sectorId) conditions.push(eq(schema.conversations.sectorId, filters.sectorId));
    if (filters.assignedUserId) conditions.push(eq(schema.conversations.assignedUserId, filters.assignedUserId));

    const rows = await db
      .select({
        id: schema.conversations.id,
        statusV2: schema.conversations.statusV2,
        sectorId: schema.conversations.sectorId,
        assignedUserId: schema.conversations.assignedUserId,
        contactName: schema.contacts.name,
        contactPhone: schema.contacts.phone,
        sectorName: schema.sectors.name,
        sectorColor: schema.sectors.color,
        sectorIcon: schema.sectors.icon,
        assignedUserName: schema.users.name,
        createdAt: schema.conversations.createdAt,
        updatedAt: schema.conversations.updatedAt,
      })
      .from(schema.conversations)
      .leftJoin(schema.contacts, eq(schema.conversations.contactId, schema.contacts.id))
      .leftJoin(schema.sectors, eq(schema.conversations.sectorId, schema.sectors.id))
      .leftJoin(schema.users, eq(schema.conversations.assignedUserId, schema.users.id))
      .where(and(...conditions))
      .orderBy(desc(schema.conversations.updatedAt))
      .limit(200);

    const visibleRows: typeof rows = [];
    for (const row of rows) {
      if (isAdmin) {
        visibleRows.push(row);
        continue;
      }
      const access = await authorizeConversationResource({
        actor: request.user,
        action: 'chat:read',
        conversation: { id: row.id, sectorId: row.sectorId, assignedUserId: row.assignedUserId },
        requiredLevel: 'read',
      });
      if (access.allowed) {
        visibleRows.push(row);
      }
    }

    const conversationIds = visibleRows.map((row) => row.id);
    const convLabels = conversationIds.length > 0
      ? await db
          .select({
            conversationId: schema.conversationLabels.conversationId,
            labelName: schema.labels.name,
            labelColor: schema.labels.color,
          })
          .from(schema.conversationLabels)
          .innerJoin(schema.labels, eq(schema.conversationLabels.labelId, schema.labels.id))
          .where(inArray(schema.conversationLabels.conversationId, conversationIds))
      : [];

    const lastMessageMap = new Map<string, string | null>();
    if (conversationIds.length > 0) {
      const lastMessages = await db.execute(sql`
        SELECT DISTINCT ON (conversation_id) conversation_id, content
        FROM messages
        WHERE conversation_id IN (${sql.join(conversationIds.map((id) => sql`${id}::uuid`), sql`, `)})
        ORDER BY conversation_id, created_at DESC
      `);
      for (const row of ((lastMessages as any).rows ?? []) as Array<{ conversation_id: string; content: string | null }>) {
        lastMessageMap.set(row.conversation_id, row.content?.substring(0, 100) || null);
      }
    }

    const labelMap = new Map<string, { name: string; color: string }[]>();
    for (const conversationLabel of convLabels) {
      const existing = labelMap.get(conversationLabel.conversationId) ?? [];
      existing.push({ name: conversationLabel.labelName, color: conversationLabel.labelColor });
      labelMap.set(conversationLabel.conversationId, existing);
    }

    const visibleCards = visibleRows.map((row) => {
      const minutesSinceUpdate = Math.floor((Date.now() - new Date(row.updatedAt).getTime()) / 60000);
      const cardLabels = labelMap.get(row.id) ?? [];

      let priority: 'low' | 'normal' | 'high' | 'urgent' = 'normal';
      if (cardLabels.some((label) => label.name === 'urgente')) priority = 'urgent';
      else if (row.statusV2 === 'em_espera') priority = 'high';
      else if (minutesSinceUpdate > 120) priority = 'high';

      return {
        id: row.id,
        statusV2: row.statusV2,
        contactName: row.contactName,
        contactPhone: row.contactPhone,
        patientName: null,
        lastMessage: lastMessageMap.get(row.id) ?? null,
        assignedUserName: row.assignedUserName,
        sectorName: row.sectorName,
        sectorColor: row.sectorColor,
        sectorIcon: row.sectorIcon,
        labels: cardLabels,
        priority,
        minutesSinceUpdate,
        createdAt: new Date(row.createdAt).toISOString(),
      };
    });

    const memberSectorIds = !isAdmin && userId ? await sectorPermissionService.getUserSectorIds(userId) : [];
    const visibleFilterOptions = isAdmin
      ? filterOptions
      : { ...filterOptions, sectors: filterOptions.sectors.filter((sector) => memberSectorIds.includes(sector.id)) };

    const visibleStats = isAdmin
      ? stats
      : (() => {
          const byStatus: Record<string, number> = {};
          for (const card of visibleCards) {
            const status = card.statusV2 || 'novo';
            byStatus[status] = (byStatus[status] ?? 0) + 1;
          }
          return { total: visibleCards.length, byStatus };
        })();

    // Agrupar cards por status
    const columns: KanbanColumn[] = Object.entries(STATUS_CONFIG).map(([status, config]) => {
      const statusCards = visibleCards.filter(c => {
        // Mapear status legado para novo
        const cardStatus = c.statusV2 || 'novo';
        return cardStatus === status;
      });

      return {
        status,
        label: config.label,
        icon: config.icon,
        color: config.color,
        count: statusCards.length,
        cards: statusCards.map(c => ({
          id: c.id,
          contactName: c.contactName,
          contactPhone: c.contactPhone,
          patientName: c.patientName,
          lastMessage: c.lastMessage,
          assignedUserName: c.assignedUserName,
          sectorName: c.sectorName,
          sectorColor: c.sectorColor,
          sectorIcon: c.sectorIcon,
          labels: c.labels,
          priority: c.priority,
          minutesSinceUpdate: c.minutesSinceUpdate,
          createdAt: c.createdAt,
        })),
      };
    });

    const board: KanbanBoard = {
      columns,
      filters: visibleFilterOptions,
      stats: {
        total: visibleStats.total,
        byStatus: visibleStats.byStatus,
        bySector: {},
      },
    };

    return board;
  });

  // Mover card (mudar status)
  app.patch('/kanban/card/:id/move', {
    preHandler: [authenticate, requirePermission('chat:write')],
    schema: {
      description: 'Mover card no Kanban (mudar status; reabertura restaura atividade)',
      tags: ['Kanban'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['novo', 'em_atendimento', 'pendente', 'em_espera', 'finalizado', 'arquivado'] },
          sectorId: { type: 'string' },
          assignedUserId: { type: 'string' },
          expectedStatusV2: { type: 'string', enum: ['novo', 'em_atendimento', 'pendente', 'em_espera', 'finalizado', 'arquivado'] },
          expectedUpdatedAt: { type: 'string' },
          expectedAssignedUserId: { type: ['string', 'null'] },
          reason: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status, sectorId, assignedUserId, expectedStatusV2, expectedUpdatedAt, expectedAssignedUserId, reason } = request.body as {
      status: string;
      sectorId?: string;
      assignedUserId?: string;
      expectedStatusV2?: string;
      expectedUpdatedAt?: string;
      expectedAssignedUserId?: string | null;
      reason?: string;
    };
    const userId = request.user?.id;

    const { conversationRepository, moveConversation } = await import('@cvg/chat');
    const conv = await conversationRepository.findById(id);
    if (!conv) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Conversa não encontrada' });

    // Autorização por recurso (C02 §1 e D-AUTHZ-02): mover exige leitura +
    // membership nível write no setor da conversa; conversa sem setor não é
    // pública e exige Admin global ou vínculo explícito (assignedUserId).
    // Sem vínculo, 404 sem conteúdo (não revela existência).
    const access = await authorizeConversationResource({
      actor: request.user,
      action: 'chat:write',
      conversation: conv,
      requiredLevel: 'write',
    });
    if (!access.allowed) {
      // SA-013/G02: negado e inexistente devem ser indistinguíveis nesta rota.
      const message = access.statusCode === 404 ? 'Conversa não encontrada' : access.message;
      return reply.status(access.statusCode).send({ error: access.error, message });
    }

    if (sectorId && sectorId !== conv.sectorId) {
      const targetAccess = await authorizeSectorScope({
        actor: request.user,
        sectorId,
        requiredLevel: 'write',
        action: 'chat:write',
      });
      if (!targetAccess.allowed) {
        return reply.status(targetAccess.statusCode).send({ error: targetAccess.error, message: targetAccess.message });
      }
    }

    // SA-005/A03 (C01): um único caso de uso transacional persiste status,
    // setor, responsável, histórico, auditoria e outbox no mesmo commit.
    const headerCorrelation = request.headers['x-correlation-id'];
    const correlationId = (typeof headerCorrelation === 'string' && headerCorrelation.trim())
      || undefined;
    const result = await moveConversation({
      conversationId: id,
      statusV2: status as never,
      sectorId,
      assignedUserId,
      expectedStatusV2: expectedStatusV2 as never,
      expectedUpdatedAt,
      expectedAssignedUserId,
      reason,
      actorId: userId as string,
      correlationId,
    });
    if (result.isErr()) {
      const error = result.error;
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send({ error: error.code, message: error.message });
      }
      request.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Falha ao mover o card' });
    }

    const outcome = result.value;
    return {
      success: true,
      id,
      status,
      statusV2: outcome.statusV2,
      isActive: !['finalizado', 'arquivado'].includes(outcome.statusV2),
      closedAt: ['finalizado', 'arquivado'].includes(outcome.statusV2) ? outcome.updatedAt : null,
      sectorId: outcome.sectorId,
      assignedUserId: outcome.assignedUserId,
      updatedAt: outcome.updatedAt,
      deduplicated: outcome.deduplicated,
    };
  });

  // Filtros disponíveis
  app.get('/kanban/filters', {
    preHandler: [authenticate, requirePermission('chat:read')],
    schema: { description: 'Filtros disponíveis para o Kanban', tags: ['Kanban'], security: [{ bearerAuth: [] }] },
  }, async (request) => {
    const filters = await repo.getFilters();

    const userId = request.user?.id;
    const isAdmin = (request.user?.roles ?? []).includes('Admin')
      || (userId ? await sectorPermissionService.isGlobalAdmin(userId) : false);
    if (isAdmin) {
      return filters;
    }

    // Não-admin só enxerga os setores em que tem membership (mesmo critério do
    // board): os filtros não podem revelar setores alheios.
    const memberSectorIds = userId ? await sectorPermissionService.getUserSectorIds(userId) : [];
    return {
      ...filters,
      sectors: filters.sectors.filter((sector) => memberSectorIds.includes(sector.id)),
    };
  });
}
