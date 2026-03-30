import { ok, type Result } from '@cvg/shared';
import { dashboardRepository } from '../../infrastructure';
import type { TaskMetrics } from '../../types';

export async function getTaskMetrics(): Promise<Result<TaskMetrics, Error>> {
  const metrics = await dashboardRepository.getTaskMetrics();
  return ok(metrics);
}

export async function getOverdueTasksCount(asOf: Date = new Date()): Promise<Result<number, Error>> {
  const count = await dashboardRepository.getTasksOverdue(asOf);
  return ok(count);
}
