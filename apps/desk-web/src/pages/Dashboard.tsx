import { useState, useEffect } from 'react';
import { dashboardApi, type DashboardSummary, type PremiumDashboardSummary } from '../lib/api';
import { Icon, type IconName } from '../components/ui/Icon';
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
  if (!summary) return <div className="dashboard-page"><div className="empty-state"><span className="empty-icon"><Icon name="dashboard" size={30} /></span><p>Erro ao carregar dashboard</p></div></div>;

  const cards: Array<{ label: string; value: number; icon: IconName; tone: string }> = [
    { label: 'Conversas abertas', value: summary.conversations.open, icon: 'message', tone: 'sky' },
    { label: 'Conversas pendentes', value: summary.conversations.pending, icon: 'clock', tone: 'warning' },
    { label: 'Total de conversas', value: summary.conversations.total, icon: 'inbox', tone: 'navy' },
    { label: 'Tarefas pendentes', value: summary.tasks.pending, icon: 'tasks', tone: 'warning' },
    { label: 'Tarefas vencidas', value: summary.tasks.overdue, icon: 'warning', tone: 'danger' },
    { label: 'Tarefas concluídas', value: summary.tasks.completed, icon: 'check', tone: 'success' },
    { label: 'Alertas ativos', value: summary.alerts.active, icon: 'bell', tone: 'danger' },
    { label: 'Alertas críticos', value: summary.alerts.bySeverity.critical, icon: 'alerts', tone: 'critical' },
  ];

  return (
    <div className="dashboard-page">
      <div className="page-hero">
        <div className="hero-left">
          <span className="dashboard-kicker">Pulso operacional</span>
          <h2>Dashboard</h2><p>Visão geral da operação em tempo real</p>
        </div>
        <div className="hero-right">
          <span className="update-badge"><i /> Atualizado agora</span>
        </div>
      </div>

      <div className="metrics-grid">
        {cards.map((card, i) => (
          <div key={i} className={`metric-card tone-${card.tone}`}>
            <div className="metric-icon"><Icon name={card.icon} size={21} /></div>
            <div className="metric-info">
              <div className="metric-value">{card.value}</div>
              <div className="metric-label">{card.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="dashboard-sections">
        <div className="section-card">
          <h3><Icon name="message" /> Conversas</h3>
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
          <h3><Icon name="tasks" /> Tarefas</h3>
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
          <h3><Icon name="alerts" /> Alertas por severidade</h3>
          <div className="severity-grid">
            {[
              { label: 'Crítico', value: summary.alerts.bySeverity.critical, tone: 'critical', color: '#a92938' },
              { label: 'Erro', value: summary.alerts.bySeverity.error, tone: 'danger', color: '#c63f4b' },
              { label: 'Aviso', value: summary.alerts.bySeverity.warning, tone: 'warning', color: '#b86b0e' },
              { label: 'Info', value: summary.alerts.bySeverity.info, tone: 'sky', color: '#0284c7' },
            ].map((s, i) => (
              <div key={i} className={`severity-item tone-${s.tone}`}>
                <span className="sev-icon" aria-hidden="true" />
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
              <h3><Icon name="sectors" /> Backlog por setor</h3>
              {premium.sectorBacklog.length === 0 ? <p className="section-empty">Nenhum setor ativo.</p> : <div className="backlog-list">{premium.sectorBacklog.map((sector) => <div className="backlog-row" key={sector.sectorId}><div className="backlog-label"><span>{sector.sectorName}</span><strong>{sector.totalBacklog}</strong></div><div className="bar-track"><div className="bar-fill backlog-fill" style={{ width: `${backlogWidth(sector.totalBacklog, premium.sectorBacklog)}%` }} /></div><small>{sector.openConversations} abertas · {sector.pendingConversations} pendentes</small></div>)}</div>}
            </div>
            <div className="section-card">
              <h3><Icon name="clock" /> Conversas mais antigas</h3>
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
