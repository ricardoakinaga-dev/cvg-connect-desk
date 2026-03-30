import { alertRepository } from '../../infrastructure/repositories/alert.repository';
import { ok, err, type Result } from '@cvg/shared';
import { BadRequestError } from '@cvg/shared';
import { createAuditLog } from '@cvg/audit';

export interface CreateAlertInput {
  conversationId?: string;
  taskId?: string;
  type: string;
  title: string;
  message?: string;
  severity?: 'info' | 'warning' | 'error' | 'critical';
  triggeredBy?: string;
  metadata?: Record<string, unknown>;
  userId?: string; // Para auditoria
}

export interface CreateAlertOutput {
  id: string;
  title: string;
  type: string;
  severity: string;
  status: string;
  createdAt: Date;
}

export async function createAlert(input: CreateAlertInput): Promise<Result<CreateAlertOutput>> {
  try {
    if (!input.title || !input.type) {
      return err(new BadRequestError('Title and type are required'));
    }

    const alert = await alertRepository.create({
      conversationId: input.conversationId,
      taskId: input.taskId,
      type: input.type,
      title: input.title,
      message: input.message,
      severity: input.severity || 'info',
      status: 'active',
      triggeredBy: input.triggeredBy,
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    });

    await alertRepository.addEvent(alert.id, 'created', undefined, 'active', input.triggeredBy);

    // Audit: registrar criação de alerta
    if (input.userId) {
      await createAuditLog({
        userId: input.userId,
        action: 'alert.created',
        entityType: 'alert',
        entityId: alert.id,
        newValue: {
          type: alert.type,
          title: alert.title,
          severity: alert.severity,
        },
        metadata: {
          conversationId: input.conversationId,
          taskId: input.taskId,
          triggeredBy: input.triggeredBy,
        },
      });
    }

    return ok({
      id: alert.id,
      title: alert.title,
      type: alert.type,
      severity: alert.severity,
      status: alert.status,
      createdAt: alert.createdAt,
    });
  } catch (error) {
    return err(error as Error);
  }
}
