import { ok, type Result } from '@cvg/shared';
import { dashboardRepository } from '../../infrastructure';
import type { ConversationVolume, TimeRange } from '../../types';

export async function getConversationVolumeByStatus(
  startDate: Date,
  endDate: Date,
  groupBy: 'day' | 'week' | 'month' = 'day'
): Promise<Result<ConversationVolume[], Error>> {
  const timeRange: TimeRange = { start: startDate, end: endDate };
  const volume = await dashboardRepository.getConversationVolume(timeRange, groupBy);
  return ok(volume);
}
