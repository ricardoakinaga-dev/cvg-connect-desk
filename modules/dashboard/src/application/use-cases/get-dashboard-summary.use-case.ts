import { ok, type Result } from '@cvg/shared';
import { dashboardRepository } from '../../infrastructure';
import type { DashboardSummary } from '../../types';

export async function getDashboardSummary(): Promise<Result<DashboardSummary, Error>> {
  const summary = await dashboardRepository.getDashboardSummary();
  return ok(summary);
}
