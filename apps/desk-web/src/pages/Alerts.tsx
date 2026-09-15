import { useCallback, useEffect, useState } from 'react';
import { alertApi, type Alert } from '../lib/api';
import { useAuthStore } from '../store/auth';
import { useConversationContext } from '../hooks/useConversationContext';
import { Link } from 'react-router-dom';
import { Badge, Button, EmptyState, ErrorState, Icon, LoadingState, type BadgeTone } from '../components/ui';
import './Alerts.css';

interface LoadFailure {
  title: string;
  message: string;
  retryable: boolean;
}

function loadFailureFrom(error: unknown): LoadFailure {
  const status = (error as { status?: number } | null)?.status ?? 0;
  const raw = error instanceof Error ? error.message : '';
  if (status === 403) {
    return { title: 'Acesso negado', message: 'Você não tem permissão para ver os alertas.', retryable: false };
  }
  if (status === 401) {
    return { title: 'Sessão expirada', message: 'Entre novamente para continuar.', retryable: false };
  }
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (!status && (offline || /failed to fetch|network|sem conexão/i.test(raw))) {
    return { title: 'Sem conexão', message: 'Não foi possível alcançar o servidor. Verifique sua conexão e tente novamente.', retryable: true };
  }
  return { title: 'Não foi possível carregar', message: raw || 'O servidor não respondeu como esperado.', retryable: true };
}

function messageFromError(error: unknown): string {
  const raw = error instanceof Error ? error.message.trim() : '';
  return raw || 'Não foi possível concluir a operação.';
}

const severityConfig: Record<string, { label: string; tone: BadgeTone; border: string }> = {
  critical: { label: 'Crítico', tone: 'error', border: 'var(--color-critical)' },
  error: { label: 'Erro', tone: 'error', border: 'var(--color-error)' },
  warning: { label: 'Aviso', tone: 'warning', border: 'var(--color-warning)' },
  info: { label: 'Info', tone: 'info', border: 'var(--color-info)' },
};

const statusConfig: Record<string, { label: string; tone: BadgeTone }> = {
  active: { label: 'Ativo', tone: 'error' },
  acknowledged: { label: 'Reconhecido', tone: 'warning' },
  resolved: { label: 'Resolvido', tone: 'success' },
};

const statusFilters = [
  { key: '', label: 'Todos' },
  { key: 'active', label: 'Ativos' },
  { key: 'acknowledged', label: 'Reconhecidos' },
  { key: 'resolved', label: 'Resolvidos' },
];

const severityFilters = [
  { key: '', label: 'Todas' },
  { key: 'critical', label: 'Crítico' },
  { key: 'error', label: 'Erro' },
  { key: 'warning', label: 'Aviso' },
  { key: 'info', label: 'Info' },
];

export function Alerts() {
  const { user } = useAuthStore();
  const conversationContext = useConversationContext();
  const contextConversationId = conversationContext.conversationId;
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadFailure | null>(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [updating, setUpdating] = useState<{ id: string; action: 'ack' | 'resolve' } | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    if (conversationContext.invalid) {
      setAlerts([]);
      setLoadError({
        title: 'Contexto inválido',
        message: 'O identificador de conversa no link não é válido. Remova o filtro para ver todos os alertas.',
        retryable: false,
      });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await alertApi.list(contextConversationId ? { conversationId: contextConversationId } : undefined);
      setAlerts(Array.isArray(data) ? data : []);
      setLoadError(null);
    } catch (err) {
      const status = (err as { status?: number } | null)?.status ?? 0;
      if (status === 404 && contextConversationId) {
        setAlerts([]);
        setLoadError({
          title: 'Contexto inacessível',
          message: 'A conversa deste link não está disponível para o seu acesso. Remova o filtro para ver todos os alertas.',
          retryable: false,
        });
      } else {
        setLoadError(loadFailureFrom(err));
      }
    } finally {
      setLoading(false);
    }
  }, [contextConversationId, conversationContext.invalid]);

  useEffect(() => { void fetchAlerts(); }, [fetchAlerts]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const runAction = async (alert: Alert, action: 'ack' | 'resolve') => {
    if (updating) return;
    setUpdating({ id: alert.id, action });
    setActionErrors(current => {
      if (!current[alert.id]) return current;
      const next = { ...current };
      delete next[alert.id];
      return next;
    });
    try {
      if (action === 'ack') {
        await alertApi.acknowledge(alert.id, user?.id || '');
        setFeedback(`Alerta “${alert.title}” reconhecido.`);
      } else {
        await alertApi.resolve(alert.id, user?.id || '');
        setFeedback(`Alerta “${alert.title}” resolvido.`);
      }
      await fetchAlerts();
    } catch (err) {
      setActionErrors(current => ({ ...current, [alert.id]: messageFromError(err) }));
    } finally {
      setUpdating(null);
    }
  };

  const timeAgo = (d: string) => {
    const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
    if (mins < 1) return 'agora';
    if (mins < 60) return `${mins}min atrás`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h atrás`;
    return `${Math.floor(mins / 1440)}d atrás`;
  };

  const stats = {
    total: alerts.length,
    active: alerts.filter(a => a.status === 'active').length,
    acknowledged: alerts.filter(a => a.status === 'acknowledged').length,
    resolved: alerts.filter(a => a.status === 'resolved').length,
    critical: alerts.filter(a => a.severity === 'critical' && a.status !== 'resolved').length,
  };

  // A09/SA-039: alerta ativo crítico primeiro, depois severidade e recência —
  // o alerta que exige ação aparece no primeiro viewport do celular.
  const statusRank: Record<string, number> = { active: 0, acknowledged: 1, resolved: 2 };
  const severityRank: Record<string, number> = { critical: 0, error: 1, warning: 2, info: 3 };
  const filtered = alerts
    .filter(alert =>
      (!filterStatus || alert.status === filterStatus) && (!filterSeverity || alert.severity === filterSeverity),
    )
    .slice()
    .sort((a, b) => {
      const status = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
      if (status !== 0) return status;
      const severity = (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9);
      if (severity !== 0) return severity;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  return (
    <div className="alerts-page" aria-busy={loading || undefined}>
      <div className="page-hero">
        <div className="hero-left">
          <span className="page-kicker">Central de atenção</span>
          <h1><Icon name="alerts" /> Alertas</h1>
          <p>Monitore alertas operacionais do sistema</p>
        </div>
      </div>

      {feedback && (
        <div className="ui-alert ui-alert--success alerts-feedback" role="status">
          <Icon name="check" size={18} />
          <span>{feedback}</span>
        </div>
      )}

      {conversationContext.rawValue && (
        <div className={`context-banner${conversationContext.invalid ? ' context-banner--error' : ''}`} role="status" aria-live="polite">
          <Icon name="inbox" size={18} />
          <span>
            {conversationContext.invalid
              ? 'O link trouxe um identificador de conversa inválido.'
              : 'Mostrando apenas os alertas da conversa selecionada.'}
          </span>
          <Link className="context-banner__link" to={`/inbox?conversation=${encodeURIComponent(conversationContext.rawValue)}`}>Voltar à conversa</Link>
          <button type="button" className="context-banner__clear" onClick={conversationContext.clear}>Remover filtro</button>
        </div>
      )}

      {!loading && !loadError && (
        <div className="stats-row" role="group" aria-label="Resumo dos alertas">
          <div className="stat-card"><span className="stat-num">{stats.total}</span><span className="stat-label">Total</span></div>
          <div className="stat-card active"><span className="stat-num">{stats.active}</span><span className="stat-label">Ativos</span></div>
          <div className="stat-card ack"><span className="stat-num">{stats.acknowledged}</span><span className="stat-label">Reconhecidos</span></div>
          <div className="stat-card resolved"><span className="stat-num">{stats.resolved}</span><span className="stat-label">Resolvidos</span></div>
          {stats.critical > 0 && <div className="stat-card critical"><span className="stat-num">{stats.critical}</span><span className="stat-label">Críticos</span></div>}
        </div>
      )}

      <div className="filter-bar">
        <div className="filter-group" role="group" aria-label="Filtrar alertas por status">
          <span className="filter-label">Status:</span>
          {statusFilters.map(f => (
            <button
              type="button"
              key={f.key}
              className={`chip ${filterStatus === f.key ? 'active' : ''}`}
              aria-pressed={filterStatus === f.key}
              onClick={() => setFilterStatus(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="filter-group" role="group" aria-label="Filtrar alertas por severidade">
          <span className="filter-label">Severidade:</span>
          {severityFilters.map(f => (
            <button
              type="button"
              key={f.key}
              className={`chip severity-filter severity-${f.key || 'all'} ${filterSeverity === f.key ? 'active' : ''}`}
              aria-pressed={filterSeverity === f.key}
              onClick={() => setFilterSeverity(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="result-count" role="status">
          {loading || loadError ? '' : `${filtered.length} ${filtered.length === 1 ? 'alerta exibido' : 'alertas exibidos'}`}
        </span>
      </div>

      {loading ? (
        <LoadingState label="Carregando alertas…" />
      ) : loadError ? (
        <ErrorState
          title={loadError.title}
          message={loadError.message}
          onRetry={loadError.retryable ? () => { void fetchAlerts(); } : undefined}
        />
      ) : alerts.length === 0 ? (
        <EmptyState
          title="Nenhum alerta encontrado"
          description="Quando o sistema registrar um alerta operacional, ele aparecerá aqui."
          icon="alerts"
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Nenhum alerta com estes filtros"
          description="Ajuste o status ou a severidade para ver os demais alertas."
          icon="search"
          action={(
            <Button variant="secondary" size="sm" onClick={() => { setFilterStatus(''); setFilterSeverity(''); }}>
              Limpar filtros
            </Button>
          )}
        />
      ) : (
        <div className="alert-list">
          {filtered.map(alert => {
            const sev = severityConfig[alert.severity] || severityConfig.info;
            const sta = statusConfig[alert.status] || statusConfig.active;
            const busy = updating?.id === alert.id;

            return (
              <div key={alert.id} className={`alert-card ${alert.status === 'resolved' ? 'resolved' : ''}`} style={{ borderLeftColor: sev.border }} aria-busy={busy || undefined}>
                <div className="alert-severity-bar">
                  <Badge tone={sev.tone} status>{sev.label}</Badge>
                  <Badge tone={sta.tone} status>{sta.label}</Badge>
                </div>

                <div className="alert-body">
                  <h3 className="alert-title">{alert.title}</h3>
                  {alert.message && <p className="alert-msg">{alert.message}</p>}

                  <div className="alert-meta">
                    <span className="alert-type">{alert.type}</span>
                    <span className="alert-time">{timeAgo(alert.createdAt)}</span>
                    {alert.acknowledgedAt && <span className="alert-ack"><Icon name="eye" size={14} /> {timeAgo(alert.acknowledgedAt)}</span>}
                    {alert.resolvedAt && <span className="alert-resolved"><Icon name="check" size={14} /> {timeAgo(alert.resolvedAt)}</span>}
                  </div>
                </div>

                {actionErrors[alert.id] && (
                  <p className="alert-action-error" role="alert">Não foi possível atualizar o alerta: {actionErrors[alert.id]}</p>
                )}

                {alert.status === 'active' && (
                  <div className="alert-actions">
                    <Button size="sm" variant="secondary" icon="eye" disabled={Boolean(updating)} loading={busy && updating?.action === 'ack'} onClick={() => void runAction(alert, 'ack')}>Reconhecer</Button>
                    <Button size="sm" variant="secondary" icon="check" disabled={Boolean(updating)} loading={busy && updating?.action === 'resolve'} onClick={() => void runAction(alert, 'resolve')}>Resolver</Button>
                  </div>
                )}
                {alert.status === 'acknowledged' && (
                  <div className="alert-actions">
                    <Button size="sm" variant="secondary" icon="check" disabled={Boolean(updating)} loading={busy && updating?.action === 'resolve'} onClick={() => void runAction(alert, 'resolve')}>Resolver</Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
