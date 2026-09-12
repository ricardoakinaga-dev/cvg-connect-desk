import { useState, useEffect } from 'react';
import { dashboardApi, type DashboardSummary, type PremiumDashboardSummary } from '../lib/api';
import './Dashboard.css';

export function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [premium, setPremium] = useState<PremiumDashboardSummary | null>(null);
  const [premiumUnavailable, setPremiumUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let baseLoaded = false;

    dashboardApi.getSummary()
      .then((data) => {
        if (cancelled) return undefined;
        baseLoaded = true;
        setSummary(data);
        return dashboardApi.getPremium();
      })
      .then((data) => {
        if (!cancelled && data) setPremium(data);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Erro ao carregar dashboard:', err);
          // O resumo atual continua disponível se o endpoint premium estiver
          // indisponível durante uma migração ou degradação parcial.
          if (baseLoaded) setPremiumUnavailable(true);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
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
              { label: 'Crítico', value: summary.alerts.bySeverity.critical, icon: '🔴', color: '#dc2626' },
              { label: 'Erro', value: summary.alerts.bySeverity.error, icon: '🟠', color: '#ea580c' },
              { label: 'Aviso', value: summary.alerts.bySeverity.warning, icon: '🟡', color: '#ca8a04' },
              { label: 'Info', value: summary.alerts.bySeverity.info, icon: '🔵', color: '#2563eb' },
            ].map((s, i) => (
              <div key={i} className="severity-item">
                <span className="sev-icon">{s.icon}</span>
                <span className="sev-value" style={{ color: s.color }}>{s.value}</span>
                <span className="sev-label">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {premium && (
        <>
          <div className="premium-heading">
            <div>
              <h3>Indicadores operacionais</h3>
              <p>Leitura rápida de resposta, handoff e capacidade das filas.</p>
            </div>
            <span className="premium-generated">Dados de {new Date(premium.generatedAt).toLocaleTimeString('pt-BR')}</span>
          </div>

          <div className="premium-kpi-grid">
            <div className="premium-kpi"><span className="premium-kpi-label">1ª resposta humana</span><strong>{formatDuration(premium.responseTime.avgFirstResponseTime)}</strong><small>{premium.responseTime.totalConversationsWithResponse} conversas com resposta</small></div>
            <div className="premium-kpi"><span className="premium-kpi-label">Handoffs</span><strong>{premium.handoff.handoffRate === null ? '—' : `${premium.handoff.handoffRate.toFixed(1)}%`}</strong><small>{premium.handoff.totalHandoffs} transferências registradas</small></div>
            <div className="premium-kpi"><span className="premium-kpi-label">Alertas críticos ativos</span><strong className={premium.alertsByCriticality.critical > 0 ? 'danger-text' : ''}>{premium.alertsByCriticality.critical}</strong><small>{premium.alertsByCriticality.error} alertas de erro ativos</small></div>
          </div>

          <div className="dashboard-sections premium-sections">
            <div className="section-card">
              <h3>🏢 Backlog por setor</h3>
              {premium.sectorBacklog.length === 0 ? <p className="section-empty">Nenhum setor ativo.</p> : <div className="backlog-list">{premium.sectorBacklog.map((sector) => <div className="backlog-row" key={sector.sectorId}><div className="backlog-label"><span>{sector.sectorName}</span><strong>{sector.totalBacklog}</strong></div><div className="bar-track"><div className="bar-fill backlog-fill" style={{ width: `${backlogWidth(sector.totalBacklog, premium.sectorBacklog)}%` }} /></div><small>{sector.openConversations} abertas · {sector.pendingConversations} pendentes</small></div>)}</div>}
            </div>
            <div className="section-card">
              <h3>⏱ Conversas mais antigas</h3>
              {premium.agingConversations.length === 0 ? <p className="section-empty">Nenhuma conversa aberta ou pendente.</p> : <div className="aging-list">{premium.agingConversations.slice(0, 8).map((conversation) => <div className="aging-row" key={conversation.conversationId}><span className={`aging-dot ${conversation.agingBucket}`} /><div className="aging-main"><strong>{conversation.sectorName || 'Sem setor'}</strong><small>{conversation.status === 'open' ? 'Aberta' : 'Pendente'} · {conversation.hoursSinceLastMessage === null ? 'sem mensagem' : formatDuration(conversation.hoursSinceLastMessage * 3600)}</small></div><span className={`aging-badge ${conversation.agingBucket}`}>{agingLabel(conversation.agingBucket)}</span></div>)}</div>}
            </div>
          </div>
        </>
      )}

      {premiumUnavailable && <p className="dashboard-soft-warning">Os indicadores operacionais avançados estão temporariamente indisponíveis; o resumo acima permanece atualizado.</p>}
    </div>
  );
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}min` : `${hours}h`;
}

function backlogWidth(value: number, sectors: Array<{ totalBacklog: number }>): number {
  const max = Math.max(...sectors.map((sector) => sector.totalBacklog), 1);
  return Math.max(4, Math.round((value / max) * 100));
}

function agingLabel(bucket: PremiumDashboardSummary['agingConversations'][number]['agingBucket']): string {
  return { fresh: 'Recente', normal: 'Atenção', old: 'Antiga', critical: 'Crítica' }[bucket];
}
