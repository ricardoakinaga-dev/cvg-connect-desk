import { FastifyInstance } from 'fastify';
import { authenticate } from '@cvg/auth';
import { KanbanRepository } from '../../infrastructure/kanban.repository';
import type { KanbanBoard, KanbanColumn } from '../../types';
import { publishConversationStatusChanged, publishConversationAssigned } from '@cvg/chat';

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
    preHandler: [authenticate],
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
  }, async (request, reply) => {
    const filters = request.query as { sectorId?: string; assignedUserId?: string; labelId?: string };

    const [cards, filterOptions, stats] = await Promise.all([
      repo.getCards(filters),
      repo.getFilters(),
      repo.getStats(filters.sectorId),
    ]);

    // Agrupar cards por status
    const columns: KanbanColumn[] = Object.entries(STATUS_CONFIG).map(([status, config]) => {
      const statusCards = cards.filter(c => {
        // Mapear status legado para novo
        const cardStatus = (c as any).statusV2 || 'novo';
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
      filters: filterOptions,
      stats: {
        total: stats.total,
        byStatus: stats.byStatus,
        bySector: {},
      },
    };

    return board;
  });

  // Mover card (mudar status)
  app.patch('/kanban/card/:id/move', {
    preHandler: [authenticate],
    schema: {
      description: 'Mover card no Kanban (mudar status)',
      tags: ['Kanban'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['novo', 'em_atendimento', 'pendente', 'em_espera', 'finalizado', 'arquivado'] },
          sectorId: { type: 'string' },
          assignedUserId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status, sectorId, assignedUserId } = request.body as { status: string; sectorId?: string; assignedUserId?: string };
    const userId = (request.user as any)?.id;

    const { conversationRepository } = await import('@cvg/chat');
    const conv = await conversationRepository.findById(id);
    if (!conv) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Conversa não encontrada' });

    const previousStatus = (conv as any).statusV2 || 'novo';
    await conversationRepository.updateStatusV2(id, status, userId);
    if (status !== previousStatus) {
      await publishConversationStatusChanged(id, previousStatus, status, userId, 'Movido via Kanban');
    }
    if (sectorId) await conversationRepository.updateSector(id, sectorId);
    if (assignedUserId) {
      await conversationRepository.assignUser(id, assignedUserId);
      await publishConversationAssigned(id, (conv as any).assignedTo ?? undefined, assignedUserId, userId);
    }

    return { success: true, id, status, previousStatus };
  });

  // Filtros disponíveis
  app.get('/kanban/filters', {
    preHandler: [authenticate],
    schema: { description: 'Filtros disponíveis para o Kanban', tags: ['Kanban'], security: [{ bearerAuth: [] }] },
  }, async () => {
    return repo.getFilters();
  });
}
