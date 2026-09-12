import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Icon } from '../components/ui/Icon';
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

export function Audit() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState('');
  const [filterEntity, setFilterEntity] = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterAction) params.append('action', filterAction);
      if (filterEntity) params.append('entityType', filterEntity);
      const query = params.toString() ? `?${params.toString()}` : '';
      const data = await api.get<AuditLog[]>(`/audit/logs${query}`);
      setLogs(data);
    } catch (err) {
      console.error('Erro ao carregar audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []);

  const formatDate = (d: string) => new Date(d).toLocaleString('pt-BR');

  const actionIcon = (action: string) => {
    if (action.includes('created')) return '➕';
    if (action.includes('sent') || action.includes('outbound')) return '📤';
    if (action.includes('received') || action.includes('inbound')) return '📥';
    if (action.includes('changed') || action.includes('updated')) return '✏️';
    if (action.includes('acknowledged')) return '👁️';
    if (action.includes('resolved')) return '✅';
    if (action.includes('deleted')) return '🗑️';
    if (action.includes('handoff')) return '🔄';
    return '📝';
  };

  const entityIcon = (type: string) => {
    const map: Record<string, string> = {
      conversation: '💬', message: '✉️', task: '✓', note: '📝',
      alert: '🔔', user: '👤', session: '🔐', handoff: '🔄',
    };
    return map[type] || '📄';
  };

  const parseContext = (json: string | null) => {
    if (!json) return null;
    try {
      const ctx = JSON.parse(json);
      return Object.entries(ctx).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' · ');
    } catch {
      return json;
    }
  };

  return (
    <div className="audit-page">
      <div className="page-header">
        <h2><Icon name="audit" /> Auditoria</h2>
      </div>

      <div className="audit-filters">
        <input aria-label="Filtrar auditoria por ação" placeholder="Filtrar por ação (ex: task.created)" value={filterAction} onChange={e => setFilterAction(e.target.value)} />
        <input aria-label="Filtrar auditoria por entidade" placeholder="Filtrar por entidade (ex: conversation)" value={filterEntity} onChange={e => setFilterEntity(e.target.value)} />
        <button className="btn-primary" onClick={fetchLogs}>Filtrar</button>
      </div>

      {loading ? (
        <div className="loading">Carregando logs de auditoria...</div>
      ) : logs.length === 0 ? (
        <div className="empty-state">Nenhum log de auditoria encontrado.</div>
      ) : (
        <div className="audit-list">
          {logs.map(log => (
            <div key={log.id} className="audit-card">
              <div className="audit-icon">{actionIcon(log.action)}</div>
              <div className="audit-body">
                <div className="audit-action">
                  <strong>{log.action}</strong>
                  <span className="audit-entity">{entityIcon(log.entityType)} {log.entityType}</span>
                </div>
                <div className="audit-meta">
                  <span className="audit-actor">por {log.actorType}{log.actorUserId ? ` (${log.actorUserId.slice(0, 8)})` : ''}</span>
                  <span className="audit-time">{formatDate(log.createdAt)}</span>
                </div>
                {log.contextJson && (
                  <div className="audit-context">{parseContext(log.contextJson)}</div>
                )}
              </div>
              <div className="audit-entity-id" title={log.entityId}>{log.entityId.slice(0, 8)}...</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
