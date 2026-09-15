import { db } from '@cvg/database';
import { noteRepository } from '../../infrastructure/repositories/note.repository';
import { insertOperationalAudit } from '../../infrastructure/audit';
import { ok, err, type Result } from '@cvg/shared';
import { BadRequestError } from '@cvg/shared';
import { persistOutboxEventIntent, publishRealtimeHintsAfterCommit, createEvent, type EventEnvelope } from '@cvg/events';

export interface CreateNoteInput {
  conversationId?: string; // Para compatibilidade retroativa
  taskId?: string; // Para compatibilidade retroativa
  referenceType?: 'conversation' | 'task' | 'tutor' | 'patient';
  referenceId?: string;
  content: string;
  authorId?: string;
  metadata?: Record<string, unknown>;
  userId?: string; // Principal autenticado: fonte de verdade da autoria
  /** Correlação da ação (header x-correlation-id / request id). */
  correlationId?: string;
}

export interface CreateNoteOutput {
  id: string;
  conversationId: string | null;
  taskId: string | null;
  authorId: string;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: Date;
}

/**
 * PROD-18/AC1: nota + histórico (referência) + auditoria + evento outbox na
 * MESMA transação. Falha em qualquer escrita faz rollback completo; o hint
 * realtime só é publicado depois do commit (D-C03-2).
 */
export async function createNote(input: CreateNoteInput): Promise<Result<CreateNoteOutput>> {
  try {
    const principalId = input.userId;
    if (!principalId) {
      return err(new BadRequestError('Authenticated user is required'));
    }

    if (input.authorId && input.authorId !== principalId) {
      return err(new BadRequestError('authorId must match the authenticated user'));
    }

    const authorId = principalId;
    if (!input.content) {
      return err(new BadRequestError('Content is required'));
    }

    // Determinar referenceType e referenceId
    let referenceType = input.referenceType;
    let referenceId = input.referenceId;
    const conversationId = input.conversationId;
    const taskId = input.taskId;

    if (conversationId && !referenceType) {
      referenceType = 'conversation';
      referenceId = conversationId;
    } else if (taskId && !referenceType) {
      referenceType = 'task';
      referenceId = taskId;
    }

    // Pelo menos uma referência deve ser fornecida
    if (!referenceType || !referenceId) {
      return err(new BadRequestError('Either conversationId/taskId or referenceType+referenceId is required'));
    }

    const events: EventEnvelope[] = [];

    const note = await db.transaction(async (tx) => {
      const created = await noteRepository.create({
        conversationId: referenceType === 'conversation' ? referenceId : undefined,
        taskId: referenceType === 'task' ? referenceId : undefined,
        authorId,
        content: input.content,
        referenceType: referenceType,
        referenceId: referenceId,
        metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
      }, tx);

      // Audit minimizado (C07/AAA-17): a trilha não copia o conteúdo da nota;
      // mantém referência e tamanho sem PII e preserva `metadata.authorId`
      // (contrato AAA-19). Agora participa da MESMA transação da nota.
      await insertOperationalAudit(tx, {
        userId: authorId,
        action: 'note.created',
        entityType: 'note',
        entityId: created.id,
        newValue: {
          referenceType,
          referenceId,
          contentLength: input.content.length,
        },
        metadata: {
          authorId,
        },
        correlationId: input.correlationId,
      });

      const event = createEvent(
        'note.created',
        'Note',
        created.id,
        {
          noteId: created.id,
          conversationId: created.conversationId,
          taskId: created.taskId,
          referenceType,
          referenceId,
          authorId,
          contentLength: input.content.length,
        },
        { correlationId: input.correlationId },
      );
      await persistOutboxEventIntent(tx, event);
      events.push(event);

      return created;
    });

    await publishRealtimeHintsAfterCommit(events);

    return ok({
      id: note.id,
      conversationId: note.conversationId,
      taskId: note.taskId,
      authorId: note.authorId,
      referenceType: note.referenceType,
      referenceId: note.referenceId,
      createdAt: note.createdAt,
    });
  } catch (error) {
    return err(error as Error);
  }
}
