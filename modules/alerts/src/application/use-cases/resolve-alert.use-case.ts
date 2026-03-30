import { alertRepository } from '../../infrastructure/repositories/alert.repository';
import { ok, err, type Result } from '@cvg/shared';
import { NotFoundError, BadRequestError } from '@cvg/shared';
import { createAuditLog } from '@cvg/audit';

export interface ResolveAlertInput {
  alertId: string;
  resolvedBy: string;
  userId?: string; // Para auditoria (default: resolvedBy)
}

export interface ResolveAlertOutput {
  id: string;
  status: string;
  resolvedBy: string;
  resolvedAt: Date;
}

export async function resolveAlert(input: ResolveAlertInput): Promise<Result<ResolveAlertOutput>> {
  try {
    const existing = await alertRepository.findById(input.alertId);
    if (!existing) {
      return err(new NotFoundError('Alert not found'));
    }

    if (existing.status === 'resolved') {
      return err(new BadRequestError('Alert already resolved'));
    }

    const oldStatus = existing.status;
    const alert = await alertRepository.resolve(input.alertId, input.resolvedBy);

    await alertRepository.addEvent(alert.id, 'resolved', oldStatus, 'resolved', input.resolvedBy);

    // Audit: registrar resolução do alerta
    const auditorUserId = input.userId || input.resolvedBy;
    await createAuditLog({
      userId: auditorUserId,
      action: 'alert.resolved',
      entityType: 'alert',
      entityId: alert.id,
      oldValue: { status: oldStatus },
      newValue: { status: 'resolved' },
      metadata: {
        resolvedBy: input.resolvedBy,
      },
    });

    return ok({
      id: alert.id,
      status: alert.status,
      resolvedBy: alert.resolvedBy!,
      resolvedAt: alert.resolvedAt!,
    });
  } catch (error) {
    return err(error as Error);
  }
}
