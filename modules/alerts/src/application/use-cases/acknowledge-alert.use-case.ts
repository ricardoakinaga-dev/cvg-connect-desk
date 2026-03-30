import { alertRepository } from '../../infrastructure/repositories/alert.repository';
import { ok, err, type Result } from '@cvg/shared';
import { NotFoundError, BadRequestError } from '@cvg/shared';
import { createAuditLog } from '@cvg/audit';

export interface AcknowledgeAlertInput {
  alertId: string;
  acknowledgedBy: string;
  userId?: string; // Para auditoria (default: acknowledgedBy)
}

export interface AcknowledgeAlertOutput {
  id: string;
  status: string;
  acknowledgedBy: string;
  acknowledgedAt: Date;
}

export async function acknowledgeAlert(input: AcknowledgeAlertInput): Promise<Result<AcknowledgeAlertOutput>> {
  try {
    const existing = await alertRepository.findById(input.alertId);
    if (!existing) {
      return err(new NotFoundError('Alert not found'));
    }

    if (existing.status === 'resolved') {
      return err(new BadRequestError('Cannot acknowledge a resolved alert'));
    }

    if (existing.status === 'acknowledged') {
      return err(new BadRequestError('Alert already acknowledged'));
    }

    const alert = await alertRepository.acknowledge(input.alertId, input.acknowledgedBy);

    await alertRepository.addEvent(alert.id, 'acknowledged', 'active', 'acknowledged', input.acknowledgedBy);

    // Audit: registrar acknowledge do alerta
    const auditorUserId = input.userId || input.acknowledgedBy;
    await createAuditLog({
      userId: auditorUserId,
      action: 'alert.acknowledged',
      entityType: 'alert',
      entityId: alert.id,
      oldValue: { status: 'active' },
      newValue: { status: 'acknowledged' },
      metadata: {
        acknowledgedBy: input.acknowledgedBy,
      },
    });

    return ok({
      id: alert.id,
      status: alert.status,
      acknowledgedBy: alert.acknowledgedBy!,
      acknowledgedAt: alert.acknowledgedAt!,
    });
  } catch (error) {
    return err(error as Error);
  }
}
