export interface FirstResponseTimeMetric {
  avgResponseTimeMs: number;
  count: number;
  period: string;
  calculatedAt: string;
}

export interface HandoffRateMetric {
  handoffRate: number;
  totalConversations: number;
  conversationsWithHandoff: number;
  period: string;
  calculatedAt: string;
}

export interface HandoffMetrics {
  total: number;
  botToHuman: number;
  humanToBot: number;
  period: string;
  calculatedAt: string;
}
