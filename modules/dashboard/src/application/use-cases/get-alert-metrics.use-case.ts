import { ok, type Result } from '@cvg/shared';
import { dashboardRepository } from '../../infrastructure';
import type { AlertMetrics } from '../../types';

export async function getAlertMetrics(): Promise<Result<AlertMetrics, Error>> {
  const metrics = await dashboardRepository.getAlertMetrics();
  return ok(metrics);
}

export async function getActiveAlertsCount(): Promise<Result<number, Error>> {
  const count = await dashboardRepository.getAlertsActive(['active']);
  return ok(count);
}
