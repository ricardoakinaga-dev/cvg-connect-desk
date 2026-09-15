import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Button, EmptyState, ErrorState, Icon, LoadingState, TextField, type IconName } from '../components/ui';
import './Audit.css';

interface AuditLog {
  id: string;
  actorType: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  contextJson: string | null;
  createdAt: string;
}

interface LoadFailure {
  title: string;
  message: string;
  retryable: boolean;
}

function loadFailureFrom(error: unknown): LoadFailure {
  const status = (error as { status?: number } | null)?.status ?? 0;
  const raw = error instanceof Error ? error.message.trim() : '';
  if (status === 403) {
    return { title: 'Acesso negado', message: 'Você não tem permissão para consultar a auditoria.', retryable: false };
  }
  if (status === 401) {
    return { title: 'Sessão expirada', message: 'Entre novamente para continuar.', retryable: false };
  }
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (!status && (offline || /failed to fetch|network|sem conexão/i.test(raw))) {
    return { title: 'Sem conexão', message: 'Não foi possível alcançar o servidor. Verifique sua conexão e tente novamente.', retryable: true };
  }
  return { title: 'Não foi possível carregar a auditoria', message: raw || 'O servidor não respondeu como esperado.', retryable: true };
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function actionIcon(action: string): IconName {
  if (action.includes('created')) return 'plus';
  if (action.includes('sent') || action.includes('outbound')) return 'send';
  if (action.includes('received') || action.includes('inbound')) return 'inbox';
  if (action.includes('changed') || action.includes('updated')) return 'settings';
  if (action.includes('acknowledged')) return 'eye';
  if (action.includes('resolved')) return 'check';
  if (action.includes('deleted')) return 'close';
  if (action.includes('handoff')) return 'transfer';
  return 'notes';
}

function entityIcon(type: string): IconName {
  const map: Record<string, IconName> = {
    conversation: 'message',
    message: 'inbox',
    task: 'tasks',
    note: 'notes',
    alert: 'bell',
    user: 'contacts',
    session: 'logout',
    handoff: 'transfer',
  };
  return map[type] || 'info';
}

function parseContext(json: string | null): string | null {
  if (!json) return null;
  try {
    const ctx = JSON.parse(json) as Record<string, unknown>;
    return Object.entries(ctx)
      .slice(0, 3)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(' · ');
  } catch {
    return json;
  }
}

export function Audit() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState<LoadFailure | null>(null);
  const [filterAction, setFilterAction] = useState('');
  const [filterEntity, setFilterEntity] = useState('');
  const [appliedAction, setAppliedAction] = useState('');
  const [appliedEntity, setAppliedEntity] = useState('');

  const loadLogs = useCallback(async (action: string, entity: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (action.trim()) params.append('action', action.trim());
      if (entity.trim()) params.append('entityType', entity.trim());
      const query = params.toString() ? `?${params.toString()}` : '';
      const data = await api.get<AuditLog[]>(`/audit/logs${query}`);
      setLogs(data);
      setLoadError(null);
    } catch (error) {
      setLoadError(loadFailureFrom(error));
    } finally {
      setLoading(false);
      setLoadedOnce(true);
    }
  }, []);

  useEffect(() => {
    void loadLogs('', '');
  }, [loadLogs]);

  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault();
    setAppliedAction(filterAction);
    setAppliedEntity(filterEntity);
    void loadLogs(filterAction, filterEntity);
  };

  const clearFilters = () => {
    setFilterAction('');
    setFilterEntity('');
    setAppliedAction('');
    setAppliedEntity('');
    void loadLogs('', '');
  };

  const hasFilters = !!(appliedAction.trim() || appliedEntity.trim());
  const filterDescription = [
    appliedAction.trim() ? `ação "${appliedAction.trim()}"` : null,
    appliedEntity.trim() ? `entidade "${appliedEntity.trim()}"` : null,
  ].filter(Boolean).join(' e ');

  return (
    <div className="audit-page">
      <div className="page-header">
        <h1><Icon name="audit" /> Auditoria</h1>
        <p className="page-subtitle">Consulte o histórico de ações registradas pela operação.</p>
      </div>

      <form className="audit-filters" onSubmit={applyFilters} role="search" aria-label="Filtros de auditoria">
        <TextField
          label="Filtrar auditoria por ação"
          placeholder="ex: task.created"
          value={filterAction}
          maxLength={120}
          onChange={(event) => setFilterAction(event.target.value)}
        />
        <TextField
          label="Filtrar auditoria por entidade"
          placeholder="ex: conversation"
          value={filterEntity}
          maxLength={120}
          onChange={(event) => setFilterEntity(event.target.value)}
        />
        <div className="audit-filters__actions">
          <Button type="submit" icon="search" loading={loading && loadedOnce}>Filtrar</Button>
          {hasFilters && <Button type="button" variant="secondary" onClick={clearFilters}>Limpar filtros</Button>}
        </div>
      </form>

      {loading && loadedOnce && (
        <div className="audit-updating" role="status"><span className="ui-spinner" aria-hidden="true" /> Buscando registros…</div>
      )}

      {loading && !loadedOnce ? (
        <LoadingState label="Carregando auditoria…" />
      ) : loadError && logs.length === 0 ? (
        <ErrorState
          title={loadError.title}
          message={loadError.message}
          onRetry={loadError.retryable ? () => { void loadLogs(appliedAction, appliedEntity); } : undefined}
        />
      ) : logs.length === 0 ? (
        hasFilters ? (
          <EmptyState
            title="Nenhum log para os filtros aplicados"
            description={`Nenhum registro corresponde a ${filterDescription}.`}
            icon="search"
            action={<Button variant="secondary" size="sm" onClick={clearFilters}>Limpar filtros</Button>}
          />
        ) : (
          <EmptyState
            title="Nenhum log de auditoria registrado"
            description="As ações da operação aparecerão aqui conforme forem registradas."
            icon="audit"
          />
        )
      ) : (
        <>
          {loadError && (
            <div className="ui-alert ui-alert--warning" role="alert">
              <Icon name="warning" size={18} />
              <span>{loadError.title}: {loadError.message}</span>
              {loadError.retryable && <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void loadLogs(appliedAction, appliedEntity); }}>Tentar novamente</Button>}
            </div>
          )}
          <p className="audit-result-count" role="status">
            {logs.length} {logs.length === 1 ? 'registro exibido' : 'registros exibidos'}{hasFilters ? ' para os filtros aplicados' : ''}
          </p>
          <div className="audit-list" aria-busy={loading || undefined}>
            {logs.map((log) => (
              <article key={log.id} className="audit-card">
                <div className="audit-icon"><Icon name={actionIcon(log.action)} size={20} /></div>
                <div className="audit-body">
                  <div className="audit-action">
                    <strong>{log.action}</strong>
                    <span className="audit-entity">
                      <Icon name={entityIcon(log.entityType)} size={14} /> {log.entityType}
                    </span>
                  </div>
                  <div className="audit-meta">
                    <span className="audit-actor">por {log.actorType}{log.actorUserId ? ` (${log.actorUserId.slice(0, 8)})` : ''}</span>
                    <span className="audit-time">{formatDate(log.createdAt)}</span>
                  </div>
                  {log.contextJson && (
                    <div className="audit-context" title={log.contextJson}>{parseContext(log.contextJson)}</div>
                  )}
                </div>
                <div className="audit-entity-id" title={log.entityId}>{log.entityId.slice(0, 8)}…</div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
