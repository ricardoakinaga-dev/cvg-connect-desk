import { useCallback, useEffect, useState } from 'react';
import { dashboardApi, type DashboardSummary, type PremiumDashboardSummary } from '../lib/api';
import { ErrorState, Icon, LoadingState, Button, type IconName } from '../components/ui';
import './Dashboard.css';

interface DashboardError {
  forbidden: boolean;
  message: string;
}

function describeDashboardError(error: unknown): DashboardError {
  const err = (error ?? {}) as { status?: unknown; message?: unknown };
  const status = typeof err.status === 'number' ? err.status : undefined;
  if (status === 403) {
    return { forbidden: true, message: 'Seu perfil não tem permissão para visualizar o dashboard.' };
  }
  if (status === 401) {
    return { forbidden: false, message: 'Sua sessão expirou. Entre novamente para continuar.' };
  }
  if (status === 0 || err.message === 'Failed to fetch') {
    return { forbidden: false, message: 'Sem conexão com o servidor. Verifique sua rede e tente novamente.' };
  }
  const serverMessage = typeof err.message === 'string' && err.message ? err.message : '';
  return { forbidden: false, message: serverMessage || 'Não foi possível carregar o resumo operacional. Tente novamente.' };
}

export function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [premium, setPremium] = useState<PremiumDashboardSummary | null>(null);
  const [premiumError, setPremiumError] = useState<string | null>(null);
  const [premiumLoading, setPremiumLoading] = useState(false);
  const [error, setError] = useState<DashboardError | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    dashboardApi.getSummary()
      .then((data) => {
        if (cancelled) return undefined;
        setSummary(data);
        setPremiumLoading(true);
        return dashboardApi.getPremium().then(
          (premiumData) => {
            if (!cancelled) {
              setPremium(premiumData);
              setPremiumError(null);
            }
          },
          (err) => {
            if (!cancelled) {
              setPremium(null);
              setPremiumError(describeDashboardError(err).message);
            }
          }
        );
      })
      .catch((err) => {
        if (!cancelled) {
          // O resumo é a base da página; sem ele não há o que exibir com verdade.
          setSummary(null);
          setPremium(null);
          setPremiumError(null);
          setError(describeDashboardError(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPremiumLoading(false);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((key) => key + 1), []);

  const retryPremium = useCallback(async () => {
    setPremiumLoading(true);
    setPremiumError(null);
    try {
      setPremium(await dashboardApi.getPremium());
    } catch (err) {
      setPremium(null);
      setPremiumError(describeDashboardError(err).message);
    } finally {
      setPremiumLoading(false);
    }
  }, []);

  if (loading && !summary) {
    return (
      <div className="dashboard-page">
        <LoadingState className="dashboard-state" label="Carregando dashboard…" />
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="dashboard-page">
        <ErrorState
          className="dashboard-state"
          title={error.forbidden ? 'Acesso negado' : 'Erro ao carregar dashboard'}
          message={error.message}
          onRetry={error.forbidden ? undefined : retry}
        />
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="dashboard-page">
        <ErrorState
          className="dashboard-state"
          title="Erro ao carregar dashboard"
          message="Nenhum dado foi recebido do servidor."
          onRetry={retry}
        />
      </div>
    );
  }

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
          <h1>Dashboard</h1><p>Visão geral da operação</p>
        </div>
        <div className="hero-right">
          <span className="update-badge" title={`Resumo gerado em ${formatFullDate(summary.generatedAt)}`}>
            <i aria-hidden="true" /> {formatUpdatedAt(summary.generatedAt)}
          </span>
          <Button variant="secondary" size="sm" icon="refresh" onClick={retry} loading={loading} aria-label="Atualizar dados do dashboard">
            Atualizar
          </Button>
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
          <h2><Icon name="message" /> Conversas</h2>
          <div className="bar-group">
            {[
              { label: 'Abertas', value: summary.conversations.open, color: 'var(--color-success)', total: summary.conversations.total },
              { label: 'Pendentes', value: summary.conversations.pending, color: 'var(--color-warning)', total: summary.conversations.total },
              { label: 'Fechadas', value: summary.conversations.closed, color: 'var(--color-text-tertiary)', total: summary.conversations.total },
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
          <h2><Icon name="tasks" /> Tarefas</h2>
          <div className="bar-group">
            {[
              { label: 'Pendentes', value: summary.tasks.pending, color: 'var(--color-warning)', total: summary.tasks.total },
              { label: 'Em Andamento', value: summary.tasks.inProgress, color: 'var(--color-primary)', total: summary.tasks.total },
              { label: 'Concluídas', value: summary.tasks.completed, color: 'var(--color-success)', total: summary.tasks.total },
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
          <h2><Icon name="alerts" /> Alertas por severidade</h2>
          <div className="severity-grid">
            {[
              { label: 'Crítico', value: summary.alerts.bySeverity.critical, tone: 'critical', color: 'var(--color-critical)' },
              { label: 'Erro', value: summary.alerts.bySeverity.error, tone: 'danger', color: 'var(--color-error-text)' },
              { label: 'Aviso', value: summary.alerts.bySeverity.warning, tone: 'warning', color: 'var(--color-warning-text)' },
              { label: 'Info', value: summary.alerts.bySeverity.info, tone: 'sky', color: 'var(--color-primary-text)' },
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
              <h2>Indicadores operacionais</h2>
              <p>Leitura rápida de resposta, handoff e capacidade das filas.</p>
            </div>
            <span className="premium-generated">Dados de {formatFullDate(premium.generatedAt)}</span>
          </div>

          <div className="premium-kpi-grid">
            <div className="premium-kpi"><span className="premium-kpi-label">1ª resposta humana</span><strong>{formatDuration(premium.responseTime.avgFirstResponseTime)}</strong><small>{premium.responseTime.totalConversationsWithResponse} conversas com resposta</small></div>
            <div className="premium-kpi"><span className="premium-kpi-label">Handoffs</span><strong>{premium.handoff.handoffRate === null ? '—' : `${premium.handoff.handoffRate.toFixed(1)}%`}</strong><small>{premium.handoff.totalHandoffs} transferências registradas</small></div>
            <div className="premium-kpi"><span className="premium-kpi-label">Alertas críticos ativos</span><strong className={premium.alertsByCriticality.critical > 0 ? 'danger-text' : ''}>{premium.alertsByCriticality.critical}</strong><small>{premium.alertsByCriticality.error} alertas de erro ativos</small></div>
          </div>

          <div className="dashboard-sections premium-sections">
            <div className="section-card">
              <h2><Icon name="sectors" /> Backlog por setor</h2>
              {premium.sectorBacklog.length === 0 ? <p className="section-empty">Nenhum setor ativo.</p> : <div className="backlog-list">{premium.sectorBacklog.map((sector) => <div className="backlog-row" key={sector.sectorId}><div className="backlog-label"><span>{sector.sectorName}</span><strong>{sector.totalBacklog}</strong></div><div className="bar-track"><div className="bar-fill backlog-fill" style={{ width: `${backlogWidth(sector.totalBacklog, premium.sectorBacklog)}%` }} /></div><small>{sector.openConversations} abertas · {sector.pendingConversations} pendentes</small></div>)}</div>}
            </div>
            <div className="section-card">
              <h2><Icon name="clock" /> Conversas mais antigas</h2>
              {premium.agingConversations.length === 0 ? <p className="section-empty">Nenhuma conversa aberta ou pendente.</p> : <div className="aging-list">{premium.agingConversations.slice(0, 8).map((conversation) => <div className="aging-row" key={conversation.conversationId}><span className={`aging-dot ${conversation.agingBucket}`} /><div className="aging-main"><strong>{conversation.sectorName || 'Sem setor'}</strong><small>{conversation.status === 'open' ? 'Aberta' : 'Pendente'} · {conversation.hoursSinceLastMessage === null ? 'sem mensagem' : formatDuration(conversation.hoursSinceLastMessage * 3600)}</small></div><span className={`aging-badge ${conversation.agingBucket}`}>{agingLabel(conversation.agingBucket)}</span></div>)}</div>}
            </div>
          </div>
        </>
      )}

      {premiumLoading && !premium && (
        <LoadingState className="dashboard-inline-state" label="Carregando indicadores operacionais…" />
      )}

      {premiumError && (
        <div className="dashboard-soft-warning" role="alert">
          <span>{/\.$/.test(premiumError) ? premiumError : `${premiumError}.`} O resumo acima permanece disponível.</span>
          <Button variant="secondary" size="sm" icon="refresh" onClick={() => void retryPremium()} loading={premiumLoading}>
            Recarregar indicadores
          </Button>
        </div>
      )}
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

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Atualização sem horário informado';
  const today = new Date();
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === today.toDateString()) return `Atualizado hoje às ${time}`;
  return `Atualizado em ${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${time}`;
}

function formatFullDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'horário não informado';
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function backlogWidth(value: number, sectors: Array<{ totalBacklog: number }>): number {
  const max = Math.max(...sectors.map((sector) => sector.totalBacklog), 1);
  return Math.max(4, Math.round((value / max) * 100));
}

function agingLabel(bucket: PremiumDashboardSummary['agingConversations'][number]['agingBucket']): string {
  return { fresh: 'Recente', normal: 'Atenção', old: 'Antiga', critical: 'Crítica' }[bucket];
}
