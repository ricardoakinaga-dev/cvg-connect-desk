import { ok, type Result } from '@cvg/shared';
import { dashboardRepository } from '../../infrastructure';
import type { HandoffRateMetric, TimeRange } from '../../types';

export async function getHandoffRateMetric(
  startDate: Date,
  endDate: Date
): Promise<Result<HandoffRateMetric, Error>> {
  const timeRange: TimeRange = { start: startDate, end: endDate };
  const metric = await dashboardRepository.getHandoffRateMetric(timeRange);
  return ok(metric);
}
