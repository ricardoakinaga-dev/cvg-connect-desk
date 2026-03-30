import { useState, useEffect, useCallback } from 'react';
import { alertApi, Alert } from '../lib/api';
import { useAuthStore } from '../store/auth';
import './Alerts.css';

export function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<string>('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  
  const user = useAuthStore((state) => state.user);

  const fetchAlerts = useCallback(async () => {
    try {
      const result = await alertApi.list(filter ? { status: filter } : undefined);
      setAlerts(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 15000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  const handleAcknowledge = async (alertId: string) => {
    if (!user) return;
    setActionLoading(alertId);
    try {
      await alertApi.acknowledge(alertId, user.email);
      await fetchAlerts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to acknowledge alert');
    } finally {
      setActionLoading(null);
    }
  };

  const handleResolve = async (alertId: string) => {
    if (!user) return;
    setActionLoading(alertId);
    try {
      await alertApi.resolve(alertId, user.email);
      await fetchAlerts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve alert');
    } finally {
      setActionLoading(null);
    }
  };

  const getSeverityBadge = (severity: string) => {
    const badges: Record<string, string> = {
      critical: 'badge-critical',
      error: 'badge-error',
      warning: 'badge-warning',
      info: 'badge-info',
    };
    return badges[severity] || 'badge-info';
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, string> = {
      active: 'badge-active',
      acknowledged: 'badge-acknowledged',
      resolved: 'badge-resolved',
    };
    return badges[status] || 'badge-active';
  };

  const getSeverityIcon = (severity: string) => {
    const icons: Record<string, string> = {
      critical: '🔴',
      error: '🟠',
      warning: '🟡',
      info: '🔵',
    };
    return icons[severity] || '⚪';
  };

  const activeCount = alerts.filter(a => a.status === 'active').length;
  const acknowledgedCount = alerts.filter(a => a.status === 'acknowledged').length;
  const criticalCount = alerts.filter(a => a.severity === 'critical' && a.status === 'active').length;

  if (loading) return <div className="loading">Carregando alertas...</div>;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className="page-container">
      <header className="page-header">
        <div>
          <h1>Alertas</h1>
          <p className="text-muted">Monitoramento de alertas do sistema</p>
        </div>
      </header>

      <div className="alert-stats">
        <div className="stat-card">
          <div className="stat-value">{criticalCount}</div>
          <div className="stat-label">Críticos</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{activeCount}</div>
          <div className="stat-label">Ativos</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{acknowledgedCount}</div>
          <div className="stat-label">Acknow.</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{alerts.length}</div>
          <div className="stat-label">Total</div>
        </div>
      </div>

      <div className="alert-filters">
        <button
          className={`filter-btn ${filter === '' ? 'active' : ''}`}
          onClick={() => setFilter('')}
        >
          Todos
        </button>
        <button
          className={`filter-btn ${filter === 'active' ? 'active' : ''}`}
          onClick={() => setFilter('active')}
        >
          Ativos
        </button>
        <button
          className={`filter-btn ${filter === 'acknowledged' ? 'active' : ''}`}
          onClick={() => setFilter('acknowledged')}
        >
          Acknow.
        </button>
        <button
          className={`filter-btn ${filter === 'resolved' ? 'active' : ''}`}
          onClick={() => setFilter('resolved')}
        >
          Resolvidos
        </button>
      </div>

      {alerts.length === 0 ? (
        <div className="empty-state">Nenhum alerta encontrado</div>
      ) : (
        <div className="alert-list">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`alert-card ${alert.severity} ${alert.status}`}
            >
              <div className="alert-header">
                <div className="alert-severity-icon">
                  {getSeverityIcon(alert.severity)}
                </div>
                <div className="alert-badges">
                  <span className={`badge ${getSeverityBadge(alert.severity)}`}>
                    {alert.severity}
                  </span>
                  <span className={`badge ${getStatusBadge(alert.status)}`}>
                    {alert.status}
                  </span>
                </div>
              </div>
              
              <h3 className="alert-title">{alert.title}</h3>
              {alert.message && <p className="alert-message">{alert.message}</p>}
              
              <div className="alert-meta">
                <span className="alert-type">Tipo: {alert.type}</span>
                <span className="alert-time">
                  {new Date(alert.createdAt).toLocaleString('pt-BR')}
                </span>
              </div>

              <div className="alert-actions">
                {alert.status === 'active' && (
                  <button
                    className="btn btn-sm btn-warning"
                    onClick={() => handleAcknowledge(alert.id)}
                    disabled={actionLoading === alert.id}
                  >
                    {actionLoading === alert.id ? 'Aguarde...' : 'Acknowledgear'}
                  </button>
                )}
                {alert.status !== 'resolved' && (
                  <button
                    className="btn btn-sm btn-success"
                    onClick={() => handleResolve(alert.id)}
                    disabled={actionLoading === alert.id}
                  >
                    {actionLoading === alert.id ? 'Aguarde...' : 'Resolver'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
