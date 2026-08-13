import { ok, type Result } from '@cvg/shared';
import { dashboardRepository } from '../../infrastructure';
import type { FirstResponseTimeMetric, TimeRange } from '../../types';

export async function getFirstResponseTimeMetric(
  startDate: Date,
  endDate: Date
): Promise<Result<FirstResponseTimeMetric, Error>> {
  const timeRange: TimeRange = { start: startDate, end: endDate };
  const metric = await dashboardRepository.getFirstResponseTimeMetric(timeRange);
  return ok(metric);
}
