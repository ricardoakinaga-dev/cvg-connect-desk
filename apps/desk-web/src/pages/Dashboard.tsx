import { useState, useEffect } from 'react';
import { dashboardApi, type DashboardSummary } from '../lib/api';
import { realtimeClient } from '../lib/realtime';
import './Dashboard.css';

interface ResponseTimeMetrics {
  avgFirstResponseTime: number | null;
  avgResponseTime: number | null;
  totalConversationsWithResponse: number;
}

interface HandoffMetrics {
  totalHandoffs: number;
  totalConversations: number;
  handoffRate: number | null;
}

interface SectorBacklog {
  sectorId: string;
  sectorName: string;
  openConversations: number;
  pendingConversations: number;
  totalBacklog: number;
}

interface AlertsByCriticality {
  critical: number;
  error: number;
  warning: number;
  info: number;
}

interface ConversationAging {
  conversationId: string;
  status: string;
  sectorName: string | null;
  lastMessageAt: string | null;
  hoursSinceLastMessage: number | null;
  agingBucket: 'fresh' | 'normal' | 'old' | 'critical';
}

const formatTime = (seconds: number | null): string => {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}min`;
};

const agingBucketConfig = {
  fresh: { label: 'Recente', color: '#22c55e', icon: '🟢', maxHours: 2 },
  normal: { label: 'Normal', color: '#eab308', icon: '🟡', maxHours: 8 },
  old: { label: 'Antiga', color: '#f97316', icon: '🟠', maxHours: 24 },
  critical: { label: 'Crítica', color: '#ef4444', icon: '🔴', maxHours: Infinity },
};

export function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [responseTime, setResponseTime] = useState<ResponseTimeMetrics | null>(null);
  const [handoff, setHandoff] = useState<HandoffMetrics | null>(null);
  const [sectorBacklog, setSectorBacklog] = useState<SectorBacklog[]>([]);
  const [alertsByCriticality, setAlertsByCriticality] = useState<AlertsByCriticality | null>(null);
  const [agingConversations, setAgingConversations] = useState<ConversationAging[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    try {
      const [s, rt, ho, sb, ac, aging] = await Promise.all([
        dashboardApi.getSummary().catch(() => null),
        dashboardApi.getResponseTime?.().catch(() => null),
        dashboardApi.getHandoff?.().catch(() => null),
        dashboardApi.getSectorBacklog?.().catch(() => []),
        dashboardApi.getAlertsByCriticality?.().catch(() => null),
        dashboardApi.getAging?.(15).catch(() => []),
      ]);
      setSummary(s);
      if (rt) setResponseTime(rt);
      if (ho) setHandoff(ho);
      if (sb) setSectorBacklog(sb);
      if (ac) setAlertsByCriticality(ac);
      if (aging && Array.isArray(aging)) setAgingConversations(aging);
    } catch (err) {
      console.error('Erro ao carregar dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 60000);
    return () => clearInterval(interval);
  }, []);

  // Realtime updates
  useEffect(() => {
    const onEvent = () => fetchAll();
    realtimeClient.subscribe('message.persisted', onEvent);
    realtimeClient.subscribe('conversation.status.changed', onEvent);
    realtimeClient.subscribe('conversation.created', onEvent);
    realtimeClient.subscribe('alert.created', onEvent);
    realtimeClient.subscribe('task.status.changed', onEvent);
    return () => {
      realtimeClient.unsubscribe('message.persisted', onEvent);
      realtimeClient.unsubscribe('conversation.status.changed', onEvent);
      realtimeClient.unsubscribe('conversation.created', onEvent);
      realtimeClient.unsubscribe('alert.created', onEvent);
      realtimeClient.unsubscribe('task.status.changed', onEvent);
    };
  }, []);

  if (loading) return <div className="dashboard-page"><div className="loading-state"><div className="spinner" /> Carregando dashboard...</div></div>;
  if (!summary) return <div className="dashboard-page"><div className="empty-state"><span className="empty-icon">📊</span><p>Erro ao carregar dashboard</p></div></div>;

  const cards = [
    { label: 'Conversas Abertas', value: summary.conversations.open, icon: '💬', color: '#3b82f6', bg: '#eff6ff' },
    { label: 'Conversas Pendentes', value: summary.conversations.pending, icon: '⏳', color: '#eab308', bg: '#fefce8' },
    { label: 'Total de Conversas', value: summary.conversations.total, icon: '📥', color: '#6366f1', bg: '#eef2ff' },
    { label: 'Tarefas Pendentes', value: summary.tasks.pending, icon: '📋', color: '#f59e0b', bg: '#fffbeb' },
    { label: 'Tarefas Vencidas', value: summary.tasks.overdue, icon: '⚠️', color: '#ef4444', bg: '#fef2f2' },
    { label: 'Tarefas Concluídas', value: summary.tasks.completed, icon: '✅', color: '#22c55e', bg: '#f0fdf4' },
    { label: 'Alertas Ativos', value: summary.alerts.active, icon: '🔔', color: '#ef4444', bg: '#fef2f2' },
    { label: 'Alertas Críticos', value: summary.alerts.bySeverity.critical, icon: '🔴', color: '#dc2626', bg: '#fef2f2' },
  ];

  return (
    <div className="dashboard-page">
      <div className="page-hero">
        <div className="hero-left">
          <h2>📊 Dashboard</h2>
          <p>Visão geral da operação em tempo real</p>
        </div>
        <div className="hero-right">
          <span className="update-badge">🔄 Atualizado agora</span>
        </div>
      </div>

      <div className="metrics-grid">
        {cards.map((card, i) => (
          <div key={i} className="metric-card" style={{ borderLeftColor: card.color }}>
            <div className="metric-icon" style={{ background: card.bg, color: card.color }}>{card.icon}</div>
            <div className="metric-info">
              <div className="metric-value">{card.value}</div>
              <div className="metric-label">{card.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* KPIs Avançados */}
      {(responseTime || handoff) && (
        <div className="dashboard-sections">
          <div className="section-card">
            <h3>⏱️ Tempo de Resposta</h3>
            <div className="kpi-grid">
              <div className="kpi-item">
                <span className="kpi-label">1ª Resposta (média)</span>
                <span className="kpi-value">{formatTime(responseTime?.avgFirstResponseTime ?? null)}</span>
              </div>
              <div className="kpi-item">
                <span className="kpi-label">Resposta (média)</span>
                <span className="kpi-value">{formatTime(responseTime?.avgResponseTime ?? null)}</span>
              </div>
              <div className="kpi-item">
                <span className="kpi-label">Conversas com resposta</span>
                <span className="kpi-value">{responseTime?.totalConversationsWithResponse ?? 0}</span>
              </div>
            </div>
          </div>

          <div className="section-card">
            <h3>🔄 Handoff Rate</h3>
            <div className="kpi-grid">
              <div className="kpi-item">
                <span className="kpi-label">Taxa de Handoff</span>
                <span className="kpi-value">{handoff?.handoffRate !== null ? `${handoff?.handoffRate}%` : '—'}</span>
              </div>
              <div className="kpi-item">
                <span className="kpi-label">Total Handoffs</span>
                <span className="kpi-value">{handoff?.totalHandoffs ?? 0}</span>
              </div>
              <div className="kpi-item">
                <span className="kpi-label">Total Conversas</span>
                <span className="kpi-value">{handoff?.totalConversations ?? 0}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="dashboard-sections">
        <div className="section-card">
          <h3>💬 Conversas</h3>
          <div className="bar-group">
            {[
              { label: 'Abertas', value: summary.conversations.open, color: '#22c55e', total: summary.conversations.total },
              { label: 'Pendentes', value: summary.conversations.pending, color: '#eab308', total: summary.conversations.total },
              { label: 'Fechadas', value: summary.conversations.closed, color: '#9ca3af', total: summary.conversations.total },
            ].map((b, i) => (
              <div key={i} className="bar-row">
                <span className="bar-label">{b.label}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${b.total ? (b.value / b.total * 100) : 0}%`, background: b.color }} />
                </div>
                <span className="bar-value">{b.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="section-card">
          <h3>📋 Tarefas</h3>
          <div className="bar-group">
            {[
              { label: 'Pendentes', value: summary.tasks.pending, color: '#eab308', total: summary.tasks.total },
              { label: 'Em Andamento', value: summary.tasks.inProgress, color: '#3b82f6', total: summary.tasks.total },
              { label: 'Concluídas', value: summary.tasks.completed, color: '#22c55e', total: summary.tasks.total },
            ].map((b, i) => (
              <div key={i} className="bar-row">
                <span className="bar-label">{b.label}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${b.total ? (b.value / b.total * 100) : 0}%`, background: b.color }} />
                </div>
                <span className="bar-value">{b.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="section-card">
          <h3>🔔 Alertas por Severidade</h3>
          <div className="severity-grid">
            {[
              { label: 'Crítico', value: alertsByCriticality?.critical ?? summary.alerts.bySeverity.critical, icon: '🔴', color: '#dc2626' },
              { label: 'Erro', value: alertsByCriticality?.error ?? summary.alerts.bySeverity.error, icon: '🟠', color: '#ea580c' },
              { label: 'Aviso', value: alertsByCriticality?.warning ?? summary.alerts.bySeverity.warning, icon: '🟡', color: '#ca8a04' },
              { label: 'Info', value: alertsByCriticality?.info ?? summary.alerts.bySeverity.info, icon: '🔵', color: '#2563eb' },
            ].map((s, i) => (
              <div key={i} className="severity-item">
                <span className="sev-icon">{s.icon}</span>
                <span className="sev-value" style={{ color: s.color }}>{s.value}</span>
                <span className="sev-label">{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {sectorBacklog.length > 0 && (
          <div className="section-card">
            <h3>📊 Backlog por Setor</h3>
            <div className="backlog-list">
              {sectorBacklog.slice(0, 10).map(s => (
                <div key={s.sectorId} className="backlog-item">
                  <span className="backlog-name">{s.sectorName}</span>
                  <span className="backlog-open" style={{ color: '#22c55e' }}>{s.openConversations} abertas</span>
                  <span className="backlog-pending" style={{ color: '#eab308' }}>{s.pendingConversations} pendentes</span>
                  <span className="backlog-total">{s.totalBacklog} total</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {agingConversations.length > 0 && (
          <div className="section-card">
            <h3>⏰ Conversas por Tempo de Espera</h3>
            <div className="aging-list">
              {agingConversations.map(a => {
                const config = agingBucketConfig[a.agingBucket];
                return (
                  <div key={a.conversationId} className="aging-item" style={{ borderLeftColor: config.color }}>
                    <span className="aging-status" style={{ color: config.color }}>{config.icon} {config.label}</span>
                    <span className="aging-sector">{a.sectorName || 'Sem setor'}</span>
                    <span className="aging-time">
                      {a.hoursSinceLastMessage !== null
                        ? `${a.hoursSinceLastMessage}h sem resposta`
                        : 'Sem mensagens'}
                    </span>
                    <span className="aging-id">{a.conversationId.slice(0, 8)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
