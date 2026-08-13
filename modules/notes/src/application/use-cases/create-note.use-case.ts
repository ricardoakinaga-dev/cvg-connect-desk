import { noteRepository } from '../../infrastructure/repositories/note.repository';
import { ok, err, type Result } from '@cvg/shared';
import { BadRequestError } from '@cvg/shared';
import { createAuditLog } from '@cvg/audit';
import type { NewInternalNote } from '../../infrastructure/repositories/note.repository';

export interface CreateNoteInput {
  conversationId?: string; // Para compatibilidade retroativa
  taskId?: string; // Para compatibilidade retroativa
  referenceType?: 'conversation' | 'task' | 'tutor' | 'patient';
  referenceId?: string;
  content: string;
  authorId: string;
  metadata?: Record<string, unknown>;
  userId?: string; // Para auditoria
}

export interface CreateNoteOutput {
  id: string;
  conversationId?: string;
  createdAt: Date;
}

export async function createNote(input: CreateNoteInput): Promise<Result<CreateNoteOutput>> {
  try {
    if (!input.content || !input.authorId) {
      return err(new BadRequestError('Content and author are required'));
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

    const note = await noteRepository.create({
      conversationId: referenceType === 'conversation' ? referenceId : undefined,
      taskId: referenceType === 'task' ? referenceId : undefined,
      authorId: input.authorId,
      content: input.content,
      referenceType: referenceType as NewInternalNote['referenceType'],
      referenceId: referenceId,
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    });

    // Audit: registrar criação de nota interna
    if (input.userId) {
      await createAuditLog({
        userId: input.userId,
        action: 'note.created',
        entityType: 'note',
        entityId: note.id,
        newValue: {
          referenceType,
          referenceId,
          content: input.content,
        },
        metadata: {
          authorId: input.authorId,
        },
      });
    }

    return ok({
      id: note.id,
      conversationId: note.conversationId || undefined,
      createdAt: note.createdAt,
    });
  } catch (error) {
    return err(error as Error);
  }
}
