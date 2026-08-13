export interface TimeRange {
  start: Date;
  end: Date;
}

export interface DashboardKPI {
  name: string;
  value: number;
  unit: string;
  calculatedAt: string;
  timeRange?: TimeRange;
}

export interface ConversationMetrics {
  open: number;
  pending: number;
  closed: number;
  archived: number;
  total: number;
}

export interface ConversationVolume {
  date: string;
  count: number;
  statusBreakdown?: {
    open: number;
    pending: number;
    closed: number;
  };
}

export interface TaskMetrics {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  overdue: number;
}

export interface AlertMetrics {
  total: number;
  active: number;
  acknowledged: number;
  resolved: number;
  bySeverity: {
    info: number;
    warning: number;
    error: number;
    critical: number;
  };
}

export interface DashboardSummary {
  conversations: ConversationMetrics;
  tasks: TaskMetrics;
  alerts: AlertMetrics;
  generatedAt: string;
}

export interface GetConversationsOpenRequest {
  status?: ('open' | 'pending')[];
}

export interface GetTasksOverdueRequest {
  asOf?: Date;
}

export interface GetAlertsActiveRequest {
  status?: ('active' | 'acknowledged')[];
}

export interface GetConversationVolumeRequest {
  startDate: Date;
  endDate: Date;
  groupBy?: 'day' | 'week' | 'month';
}

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
