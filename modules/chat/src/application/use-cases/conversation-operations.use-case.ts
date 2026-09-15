import { db, schema } from '@cvg/database';
import { eq, and } from 'drizzle-orm';
import { conversationRepository } from '../../infrastructure/repositories/conversation.repository';
import { insertOperationalAudit } from '../audit';
import {
  ok,
  err,
  type Result,
  NotFoundError,
  BadRequestError,
  ConflictError,
} from '@cvg/shared';
import {
  persistOutboxEventIntent,
  publishRealtimeHintsAfterCommit,
  createEvent,
  createConversationStatusChangedEvent,
  createHandoffRequestedEvent,
  createHandoffCompletedEvent,
  type EventEnvelope,
} from '@cvg/events';

export const CONVERSATION_STATUS_V2 = [
  'novo',
  'em_atendimento',
  'pendente',
  'em_espera',
  'finalizado',
  'arquivado',
] as const;
export type ConversationStatusV2 = (typeof CONVERSATION_STATUS_V2)[number];

export const CONVERSATION_HANDLERS = ['bot', 'human'] as const;
export type ConversationHandler = (typeof CONVERSATION_HANDLERS)[number];

/** Mapa statusV2 → status legado, preservando o contrato anterior. */
const LEGACY_STATUS: Record<ConversationStatusV2, 'open' | 'pending' | 'closed' | 'archived'> = {
  novo: 'open',
  em_atendimento: 'open',
  pendente: 'pending',
  em_espera: 'pending',
  finalizado: 'closed',
  arquivado: 'archived',
};

const TERMINAL_STATUS = new Set<ConversationStatusV2>(['finalizado', 'arquivado']);

/**
 * Transições válidas de estado da conversa (PROD-18/AC3). Documentadas e
 * validadas no servidor; transição fora do mapa responde 409.
 */
export const CONVERSATION_TRANSITIONS: Readonly<Record<ConversationStatusV2, readonly ConversationStatusV2[]>> =
  Object.freeze({
    novo: ['em_atendimento', 'pendente', 'em_espera', 'finalizado', 'arquivado'],
    em_atendimento: ['pendente', 'em_espera', 'finalizado', 'arquivado'],
    pendente: ['em_atendimento', 'em_espera', 'finalizado', 'arquivado'],
    em_espera: ['em_atendimento', 'pendente', 'finalizado', 'arquivado'],
    finalizado: ['em_atendimento', 'arquivado'],
    arquivado: ['em_atendimento'],
  });

export function isValidConversationTransition(from: ConversationStatusV2, to: ConversationStatusV2): boolean {
  if (from === to) return true;
  return CONVERSATION_TRANSITIONS[from]?.includes(to) ?? false;
}

function sameInstant(a: Date | null | undefined, iso: string | undefined): boolean {
  if (iso === undefined) return true;
  if (!a) return false;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return false;
  return a.getTime() === parsed.getTime();
}

export interface ChangeConversationStateInput {
  conversationId: string;
  statusV2: ConversationStatusV2;
  /** CAS: estado que o operador viu; divergência ⇒ 409. */
  expectedStatusV2?: ConversationStatusV2;
  /** CAS por versão: updatedAt ISO que o operador viu; divergência ⇒ 409. */
  expectedUpdatedAt?: string;
  reason?: string;
  actorId: string;
  correlationId?: string;
}

export interface ChangeConversationStateOutput {
  conversationId: string;
  statusV2: ConversationStatusV2;
  previousStatusV2: ConversationStatusV2;
  updatedAt: Date;
  deduplicated: boolean;
}

/**
 * PROD-18/AC1/AC3: mudança de estado transacional com CAS e idempotência.
 * O `SELECT ... FOR UPDATE` serializa operadores concorrentes na MESMA
 * conversa; quem perde a corrida recebe 409 sem efeito parcial.
 */
export async function changeConversationState(
  input: ChangeConversationStateInput,
): Promise<Result<ChangeConversationStateOutput, Error>> {
  try {
    if (!CONVERSATION_STATUS_V2.includes(input.statusV2)) {
      return err(new BadRequestError('Invalid statusV2', 'INVALID_STATUS_V2'));
    }

    const outcome = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, input.conversationId))
        .for('update');
      if (!current) {
        throw new NotFoundError('Conversation not found');
      }

      const previous = current.statusV2 as ConversationStatusV2;

      // Ação repetida: já está no estado pedido ⇒ idempotente, sem escritas.
      if (previous === input.statusV2) {
        return { conversation: current, previous, deduplicated: true, event: null as EventEnvelope | null };
      }

      if (input.expectedStatusV2 && previous !== input.expectedStatusV2) {
        throw new ConflictError(
          `Estado atual ${previous} difere do esperado ${input.expectedStatusV2}`,
          'CONVERSATION_STATUS_CONFLICT',
        );
      }
      if (!sameInstant(current.updatedAt, input.expectedUpdatedAt)) {
        throw new ConflictError(
          'Conversa atualizada por outro operador; releia o estado antes de repetir',
          'CONVERSATION_VERSION_CONFLICT',
        );
      }
      if (!isValidConversationTransition(previous, input.statusV2)) {
        throw new ConflictError(
          `Transição de estado inválida: ${previous} -> ${input.statusV2}`,
          'INVALID_STATUS_TRANSITION',
        );
      }

      const legacy = LEGACY_STATUS[input.statusV2];
      const [updated] = await tx
        .update(schema.conversations)
        .set({
          statusV2: input.statusV2,
          status: legacy,
          isActive: !TERMINAL_STATUS.has(input.statusV2),
          closedAt: TERMINAL_STATUS.has(input.statusV2) ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(schema.conversations.id, input.conversationId))
        .returning();

      await conversationRepository.addStatusHistory(
        input.conversationId,
        legacy,
        input.actorId,
        input.reason,
        tx,
      );

      await insertOperationalAudit(tx, {
        userId: input.actorId,
        action: 'conversation.status.changed',
        entityType: 'conversation',
        entityId: input.conversationId,
        oldValue: { statusV2: previous, status: current.status },
        newValue: { statusV2: input.statusV2, status: legacy },
        metadata: { reason: input.reason },
        correlationId: input.correlationId,
      });

      const event = createConversationStatusChangedEvent(
        {
          conversationId: input.conversationId,
          previousStatus: previous,
          newStatus: input.statusV2,
          changedBy: input.actorId,
          reason: input.reason,
          changedAt: new Date().toISOString(),
        },
        input.correlationId,
      );
      await persistOutboxEventIntent(tx, event);

      return { conversation: updated, previous, deduplicated: false, event };
    });

    if (outcome.event) {
      await publishRealtimeHintsAfterCommit([outcome.event]);
    }

    return ok({
      conversationId: outcome.conversation.id,
      statusV2: outcome.conversation.statusV2 as ConversationStatusV2,
      previousStatusV2: outcome.previous,
      updatedAt: outcome.conversation.updatedAt,
      deduplicated: outcome.deduplicated,
    });
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError || error instanceof BadRequestError) {
      return err(error);
    }
    return err(error as Error);
  }
}

export interface AssignConversationInput {
  conversationId: string;
  assigneeId: string;
  /** CAS: `null` exige conversa sem responsável; uuid exige aquele usuário. */
  expectedAssignedUserId?: string | null;
  expectedUpdatedAt?: string;
  actorId: string;
  correlationId?: string;
}

export interface AssignConversationOutput {
  conversationId: string;
  assignedUserId: string | null;
  previousAssignedUserId: string | null;
  updatedAt: Date;
  deduplicated: boolean;
}

/**
 * PROD-18/AC1/AC3: atribuição transacional. O destino é validado no servidor
 * (usuário ativo e, quando a conversa tem setor, vínculo com o setor ou papel
 * Admin). `conversation_assignments` registra o histórico; auditoria e evento
 * outbox participam do MESMO `tx`.
 */
export async function assignConversation(
  input: AssignConversationInput,
): Promise<Result<AssignConversationOutput, Error>> {
  try {
    const outcome = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, input.conversationId))
        .for('update');
      if (!current) {
        throw new NotFoundError('Conversation not found');
      }

      const [assignee] = await tx
        .select({ id: schema.users.id, isActive: schema.users.isActive })
        .from(schema.users)
        .where(eq(schema.users.id, input.assigneeId));
      if (!assignee || !assignee.isActive) {
        throw new BadRequestError('Responsável inválido ou inativo', 'INVALID_ASSIGNEE');
      }

      if (current.sectorId) {
        const [membership] = await tx
          .select({ id: schema.userSectors.id })
          .from(schema.userSectors)
          .where(and(
            eq(schema.userSectors.userId, input.assigneeId),
            eq(schema.userSectors.sectorId, current.sectorId),
          ))
          .limit(1);
        if (!membership) {
          const [admin] = await tx
            .select({ userId: schema.userRoles.userId })
            .from(schema.userRoles)
            .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
            .where(and(
              eq(schema.userRoles.userId, input.assigneeId),
              eq(schema.roles.name, 'Admin'),
            ))
            .limit(1);
          if (!admin) {
            throw new BadRequestError(
              'Responsável não pertence ao setor da conversa',
              'INVALID_ASSIGNEE',
            );
          }
        }
      }

      const previousAssignee = current.assignedUserId ?? null;
      if (previousAssignee === input.assigneeId) {
        return { conversation: current, previousAssignee, deduplicated: true, event: null as EventEnvelope | null };
      }

      if (input.expectedAssignedUserId !== undefined) {
        const expected = input.expectedAssignedUserId ?? null;
        if (previousAssignee !== expected) {
          throw new ConflictError(
            'Responsável atual difere do esperado; releia a conversa antes de repetir',
            'CONVERSATION_ASSIGNMENT_CONFLICT',
          );
        }
      }
      if (!sameInstant(current.updatedAt, input.expectedUpdatedAt)) {
        throw new ConflictError(
          'Conversa atualizada por outro operador; releia o estado antes de repetir',
          'CONVERSATION_VERSION_CONFLICT',
        );
      }

      const [updated] = await tx
        .update(schema.conversations)
        .set({ assignedUserId: input.assigneeId, updatedAt: new Date() })
        .where(eq(schema.conversations.id, input.conversationId))
        .returning();

      await tx.insert(schema.conversationAssignments).values({
        conversationId: input.conversationId,
        userId: input.assigneeId,
        assignedBy: input.actorId,
      });

      await insertOperationalAudit(tx, {
        userId: input.actorId,
        action: 'conversation.assigned',
        entityType: 'conversation',
        entityId: input.conversationId,
        oldValue: { assignedUserId: previousAssignee },
        newValue: { assignedUserId: input.assigneeId },
        correlationId: input.correlationId,
      });

      const event = createEvent(
        'conversation.assigned',
        'Conversation',
        input.conversationId,
        {
          conversationId: input.conversationId,
          previousAssignedUserId: previousAssignee,
          assignedUserId: input.assigneeId,
          assignedBy: input.actorId,
        },
        { correlationId: input.correlationId },
      );
      await persistOutboxEventIntent(tx, event);

      return { conversation: updated, previousAssignee, deduplicated: false, event };
    });

    if (outcome.event) {
      await publishRealtimeHintsAfterCommit([outcome.event]);
    }

    return ok({
      conversationId: outcome.conversation.id,
      assignedUserId: outcome.conversation.assignedUserId ?? null,
      previousAssignedUserId: outcome.previousAssignee,
      updatedAt: outcome.conversation.updatedAt,
      deduplicated: outcome.deduplicated,
    });
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError || error instanceof BadRequestError) {
      return err(error);
    }
    return err(error as Error);
  }
}

export interface HandoffConversationInput {
  conversationId: string;
  newHandler: ConversationHandler;
  expectedHandler?: ConversationHandler;
  expectedUpdatedAt?: string;
  reason?: string;
  actorId: string;
  correlationId?: string;
}

export interface HandoffConversationOutput {
  conversationId: string;
  currentHandler: ConversationHandler;
  previousHandler: ConversationHandler;
  updatedAt: Date;
  deduplicated: boolean;
}

/**
 * PROD-18/AC1/AC3: handoff manual (bot ↔ humano) transacional. Estado +
 * auditoria + `handoff.requested`/`handoff.completed` outbox no MESMO `tx`;
 * repetir o handler atual é idempotente (nenhum evento duplicado).
 */
export async function handoffConversation(
  input: HandoffConversationInput,
): Promise<Result<HandoffConversationOutput, Error>> {
  try {
    const outcome = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, input.conversationId))
        .for('update');
      if (!current) {
        throw new NotFoundError('Conversation not found');
      }

      const previous = current.currentHandler as ConversationHandler;
      if (previous === input.newHandler) {
        return {
          conversation: current,
          previous,
          deduplicated: true,
          events: [] as EventEnvelope[],
        };
      }

      if (input.expectedHandler && previous !== input.expectedHandler) {
        throw new ConflictError(
          `Handler atual ${previous} difere do esperado ${input.expectedHandler}`,
          'CONVERSATION_HANDOFF_CONFLICT',
        );
      }
      if (!sameInstant(current.updatedAt, input.expectedUpdatedAt)) {
        throw new ConflictError(
          'Conversa atualizada por outro operador; releia o estado antes de repetir',
          'CONVERSATION_VERSION_CONFLICT',
        );
      }

      const [updated] = await tx
        .update(schema.conversations)
        .set({ currentHandler: input.newHandler, updatedAt: new Date() })
        .where(eq(schema.conversations.id, input.conversationId))
        .returning();

      await insertOperationalAudit(tx, {
        userId: input.actorId,
        action: 'conversation.handoff',
        entityType: 'conversation',
        entityId: input.conversationId,
        oldValue: { currentHandler: previous },
        newValue: { currentHandler: input.newHandler },
        metadata: { reason: input.reason },
        correlationId: input.correlationId,
      });

      const requested = createHandoffRequestedEvent(
        {
          conversationId: input.conversationId,
          previousHandler: previous,
          newHandler: input.newHandler,
          reason: input.reason || 'manual_handoff',
          triggeredBy: input.actorId,
        },
        input.correlationId,
      );
      const completed = createHandoffCompletedEvent(
        {
          conversationId: input.conversationId,
          previousHandler: previous,
          newHandler: input.newHandler,
          reason: input.reason || 'manual_handoff',
          triggeredBy: input.actorId,
          completedAt: new Date().toISOString(),
        },
        input.correlationId,
      );
      await persistOutboxEventIntent(tx, requested);
      await persistOutboxEventIntent(tx, completed);

      return { conversation: updated, previous, deduplicated: false, events: [requested, completed] };
    });

    if (outcome.events.length > 0) {
      await publishRealtimeHintsAfterCommit(outcome.events);
    }

    return ok({
      conversationId: outcome.conversation.id,
      currentHandler: outcome.conversation.currentHandler as ConversationHandler,
      previousHandler: outcome.previous,
      updatedAt: outcome.conversation.updatedAt,
      deduplicated: outcome.deduplicated,
    });
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError || error instanceof BadRequestError) {
      return err(error);
    }
    return err(error as Error);
  }
}

export interface MoveConversationInput {
  conversationId: string;
  statusV2: ConversationStatusV2;
  /** Move de setor no mesmo comando (opcional). */
  sectorId?: string;
  /** Responsável explícito (opcional); ausente mantém o atual. */
  assignedUserId?: string;
  /** CAS: estado que o operador viu; divergência ⇒ 409. */
  expectedStatusV2?: ConversationStatusV2;
  /** CAS por versão: `updatedAt` ISO visto pelo operador; divergência ⇒ 409. */
  expectedUpdatedAt?: string;
  /** CAS do responsável atual (`null` = sem responsável). */
  expectedAssignedUserId?: string | null;
  reason?: string;
  actorId: string;
  correlationId?: string;
}

export interface MoveConversationOutput {
  conversationId: string;
  statusV2: ConversationStatusV2;
  previousStatusV2: ConversationStatusV2;
  sectorId: string | null;
  previousSectorId: string | null;
  assignedUserId: string | null;
  previousAssignedUserId: string | null;
  updatedAt: Date;
  deduplicated: boolean;
}

/**
 * SA-005/A02/A03 (C01): movimento completo do Kanban em UM commit.
 *
 * Status, setor e responsável são persistidos juntos com histórico, auditoria e
 * outbox no mesmo `tx`; uma falha tardia reverte tudo (nenhuma escrita parcial).
 * A reabertura (`finalizado|arquivado → ativo`) restaura `isActive=true` e
 * `closedAt=null`. Hints só são publicados depois do commit. Conflito de
 * versão/estado/responsável responde 409 sem sobrescrever o trabalho alheio.
 */
export async function moveConversation(
  input: MoveConversationInput,
): Promise<Result<MoveConversationOutput, Error>> {
  try {
    if (!CONVERSATION_STATUS_V2.includes(input.statusV2)) {
      return err(new BadRequestError('Invalid statusV2', 'INVALID_STATUS_V2'));
    }

    const outcome = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, input.conversationId))
        .for('update');
      if (!current) {
        throw new NotFoundError('Conversation not found');
      }

      const previousStatus = current.statusV2 as ConversationStatusV2;
      const previousSector = current.sectorId ?? null;
      const previousAssignee = current.assignedUserId ?? null;
      const statusChanged = previousStatus !== input.statusV2;
      const sectorChanged = input.sectorId !== undefined && input.sectorId !== previousSector;
      const assigneeChanged = input.assignedUserId !== undefined && input.assignedUserId !== previousAssignee;
      const events: EventEnvelope[] = [];

      if (!statusChanged && !sectorChanged && !assigneeChanged) {
        return {
          conversation: current,
          previousStatus,
          previousSector,
          previousAssignee,
          deduplicated: true,
          events,
        };
      }

      if (statusChanged) {
        if (input.expectedStatusV2 && previousStatus !== input.expectedStatusV2) {
          throw new ConflictError(
            `Estado atual ${previousStatus} difere do esperado ${input.expectedStatusV2}`,
            'CONVERSATION_STATUS_CONFLICT',
          );
        }
        if (!isValidConversationTransition(previousStatus, input.statusV2)) {
          throw new ConflictError(
            `Transição de estado inválida: ${previousStatus} -> ${input.statusV2}`,
            'INVALID_STATUS_TRANSITION',
          );
        }
      }
      if (input.expectedAssignedUserId !== undefined) {
        const expected = input.expectedAssignedUserId ?? null;
        if (previousAssignee !== expected) {
          throw new ConflictError(
            'Responsável atual difere do esperado; releia a conversa antes de repetir',
            'CONVERSATION_ASSIGNMENT_CONFLICT',
          );
        }
      }
      if (!sameInstant(current.updatedAt, input.expectedUpdatedAt)) {
        throw new ConflictError(
          'Conversa atualizada por outro operador; releia o estado antes de repetir',
          'CONVERSATION_VERSION_CONFLICT',
        );
      }

      if (sectorChanged && input.sectorId) {
        const [sector] = await tx
          .select({ id: schema.sectors.id, isActive: schema.sectors.isActive })
          .from(schema.sectors)
          .where(eq(schema.sectors.id, input.sectorId));
        if (!sector) {
          throw new BadRequestError('Setor de destino inexistente', 'INVALID_SECTOR');
        }
        if (sector.isActive === false) {
          throw new BadRequestError('Setor de destino inativo', 'INVALID_SECTOR');
        }
      }

      if (assigneeChanged && input.assignedUserId) {
        const [assignee] = await tx
          .select({ id: schema.users.id, isActive: schema.users.isActive })
          .from(schema.users)
          .where(eq(schema.users.id, input.assignedUserId));
        if (!assignee || !assignee.isActive) {
          throw new BadRequestError('Responsável inválido ou inativo', 'INVALID_ASSIGNEE');
        }
        const targetSector = sectorChanged ? input.sectorId : previousSector;
        if (targetSector) {
          const [membership] = await tx
            .select({ id: schema.userSectors.id })
            .from(schema.userSectors)
            .where(and(
              eq(schema.userSectors.userId, input.assignedUserId),
              eq(schema.userSectors.sectorId, targetSector),
            ))
            .limit(1);
          if (!membership) {
            const [admin] = await tx
              .select({ userId: schema.userRoles.userId })
              .from(schema.userRoles)
              .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
              .where(and(
                eq(schema.userRoles.userId, input.assignedUserId),
                eq(schema.roles.name, 'Admin'),
              ))
              .limit(1);
            if (!admin) {
              throw new BadRequestError(
                'Responsável não pertence ao setor de destino',
                'INVALID_ASSIGNEE',
              );
            }
          }
        }
      }

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      const previousLegacy = current.status;
      let legacy = current.status;
      if (statusChanged) {
        legacy = LEGACY_STATUS[input.statusV2];
        patch.statusV2 = input.statusV2;
        patch.status = legacy;
        patch.isActive = !TERMINAL_STATUS.has(input.statusV2);
        patch.closedAt = TERMINAL_STATUS.has(input.statusV2) ? new Date() : null;
      }
      if (sectorChanged) patch.sectorId = input.sectorId;
      if (assigneeChanged) patch.assignedUserId = input.assignedUserId;

      const [updated] = await tx
        .update(schema.conversations)
        .set(patch)
        .where(eq(schema.conversations.id, input.conversationId))
        .returning();

      if (statusChanged) {
        await conversationRepository.addStatusHistory(
          input.conversationId,
          legacy,
          input.actorId,
          input.reason,
          tx,
        );
        const event = createConversationStatusChangedEvent(
          {
            conversationId: input.conversationId,
            previousStatus,
            newStatus: input.statusV2,
            changedBy: input.actorId,
            reason: input.reason,
            changedAt: new Date().toISOString(),
          },
          input.correlationId,
        );
        await persistOutboxEventIntent(tx, event);
        events.push(event);
      }
      if (sectorChanged) {
        const event = createEvent(
          'conversation.sector.changed',
          'Conversation',
          input.conversationId,
          {
            conversationId: input.conversationId,
            previousSectorId: previousSector,
            sectorId: input.sectorId,
            changedBy: input.actorId,
          },
          { correlationId: input.correlationId },
        );
        await persistOutboxEventIntent(tx, event);
        events.push(event);
      }
      if (assigneeChanged) {
        await tx.insert(schema.conversationAssignments).values({
          conversationId: input.conversationId,
          userId: input.assignedUserId as string,
          assignedBy: input.actorId,
        });
        const event = createEvent(
          'conversation.assigned',
          'Conversation',
          input.conversationId,
          {
            conversationId: input.conversationId,
            previousAssignedUserId: previousAssignee,
            assignedUserId: input.assignedUserId,
            assignedBy: input.actorId,
          },
          { correlationId: input.correlationId },
        );
        await persistOutboxEventIntent(tx, event);
        events.push(event);
      }

      await insertOperationalAudit(tx, {
        userId: input.actorId,
        action: 'conversation.kanban.moved',
        entityType: 'conversation',
        entityId: input.conversationId,
        oldValue: {
          statusV2: previousStatus,
          status: previousLegacy,
          sectorId: previousSector,
          assignedUserId: previousAssignee,
        },
        newValue: {
          statusV2: input.statusV2,
          status: legacy,
          sectorId: updated.sectorId ?? null,
          assignedUserId: updated.assignedUserId ?? null,
        },
        metadata: { reason: input.reason },
        correlationId: input.correlationId,
      });

      return {
        conversation: updated,
        previousStatus,
        previousSector,
        previousAssignee,
        deduplicated: false,
        events,
      };
    });

    if (outcome.events.length > 0) {
      await publishRealtimeHintsAfterCommit(outcome.events);
    }

    return ok({
      conversationId: outcome.conversation.id,
      statusV2: outcome.conversation.statusV2 as ConversationStatusV2,
      previousStatusV2: outcome.previousStatus,
      sectorId: outcome.conversation.sectorId ?? null,
      previousSectorId: outcome.previousSector,
      assignedUserId: outcome.conversation.assignedUserId ?? null,
      previousAssignedUserId: outcome.previousAssignee,
      updatedAt: outcome.conversation.updatedAt,
      deduplicated: outcome.deduplicated,
    });
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError || error instanceof BadRequestError) {
      return err(error);
    }
    return err(error as Error);
  }
}
