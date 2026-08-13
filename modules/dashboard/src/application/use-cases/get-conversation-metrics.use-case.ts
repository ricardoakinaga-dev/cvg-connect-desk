import { ok, type Result } from '@cvg/shared';
import { dashboardRepository } from '../../infrastructure';
import type { ConversationMetrics, ConversationVolume, TimeRange } from '../../types';

export async function getConversationMetrics(): Promise<Result<ConversationMetrics, Error>> {
  const metrics = await dashboardRepository.getConversationMetrics();
  return ok(metrics);
}

export async function getConversationVolume(
  startDate: Date,
  endDate: Date,
  groupBy: 'day' | 'week' | 'month' = 'day'
): Promise<Result<ConversationVolume[], Error>> {
  const timeRange: TimeRange = { start: startDate, end: endDate };
  const volume = await dashboardRepository.getConversationVolume(timeRange, groupBy);
  return ok(volume);
}

export async function getOpenConversationsCount(): Promise<Result<number, Error>> {
  const count = await dashboardRepository.getConversationsByStatus(['open', 'pending']);
  return ok(count);
}

export async function getConversationVolumeByStatus(
  startDate: Date,
  endDate: Date,
  groupBy: 'day' | 'week' | 'month' = 'day'
): Promise<Result<ConversationVolume[], Error>> {
  const timeRange: TimeRange = { start: startDate, end: endDate };
  const volume = await dashboardRepository.getConversationVolume(timeRange, groupBy);
  return ok(volume);
}
