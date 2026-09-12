import { ok, type Result } from '@cvg/shared';
import { dashboardRepository } from '../../infrastructure';
import type {
  AlertsByCriticality,
  ConversationAging,
  HandoffMetrics,
  PremiumDashboardSummary,
  ResponseTimeMetrics,
  SectorBacklog,
} from '../../types';

export async function getResponseTimeMetrics(): Promise<Result<ResponseTimeMetrics, Error>> {
  return ok(await dashboardRepository.getResponseTimeMetrics());
}

export async function getHandoffMetrics(): Promise<Result<HandoffMetrics, Error>> {
  return ok(await dashboardRepository.getHandoffMetrics());
}

export async function getSectorBacklog(): Promise<Result<SectorBacklog[], Error>> {
  return ok(await dashboardRepository.getSectorBacklog());
}

export async function getAgingConversations(limit = 20): Promise<Result<ConversationAging[], Error>> {
  return ok(await dashboardRepository.getAgingConversations(limit));
}

export async function getAlertsByCriticality(): Promise<Result<AlertsByCriticality, Error>> {
  return ok(await dashboardRepository.getAlertsByCriticality());
}

export async function getPremiumDashboardSummary(): Promise<Result<PremiumDashboardSummary, Error>> {
  const [conversations, tasks, alerts, responseTime, handoff, sectorBacklog, agingConversations, alertsByCriticality] = await Promise.all([
    dashboardRepository.getConversationMetrics(),
    dashboardRepository.getTaskMetrics(),
    dashboardRepository.getAlertMetrics(),
    dashboardRepository.getResponseTimeMetrics(),
    dashboardRepository.getHandoffMetrics(),
    dashboardRepository.getSectorBacklog(),
    dashboardRepository.getAgingConversations(20),
    dashboardRepository.getAlertsByCriticality(),
  ]);

  return ok({
    conversations,
    tasks,
    alerts,
    responseTime,
    handoff,
    sectorBacklog,
    agingConversations,
    alertsByCriticality,
    generatedAt: new Date().toISOString(),
  });
}
