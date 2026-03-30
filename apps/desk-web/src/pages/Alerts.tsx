import { useState, useEffect } from 'react';
import { alertApi, type Alert } from '../lib/api';
import { useAuthStore } from '../store/auth';
import './Alerts.css';

export function Alerts() {
  const { user } = useAuthStore();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');

  const fetchAlerts = async () => {
    try {
      const filters: any = {};
      if (filterStatus) filters.status = filterStatus;
      if (filterSeverity) filters.severity = filterSeverity;
      const data = await alertApi.list(filters);
      setAlerts(data);
    } catch (err) { console.error('Erro:', err); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAlerts(); }, [filterStatus, filterSeverity]);

  const handleAck = async (id: string) => {
    try { await alertApi.acknowledge(id, user?.id || ''); fetchAlerts(); }
    catch (err) { console.error('Erro:', err); }
  };

  const handleResolve = async (id: string) => {
    try { await alertApi.resolve(id, user?.id || ''); fetchAlerts(); }
    catch (err) { console.error('Erro:', err); }
  };

  const severityConfig: Record<string, { label: string; icon: string; color: string; bg: string; border: string }> = {
    critical: { label: 'Crítico', icon: '🔴', color: '#dc2626', bg: '#fef2f2', border: '#fca5a5' },
    error: { label: 'Erro', icon: '🟠', color: '#ea580c', bg: '#fff7ed', border: '#fdba74' },
    warning: { label: 'Aviso', icon: '🟡', color: '#ca8a04', bg: '#fefce8', border: '#fde047' },
    info: { label: 'Info', icon: '🔵', color: '#2563eb', bg: '#eff6ff', border: '#93c5fd' },
  };

  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    active: { label: 'Ativo', color: '#dc2626', bg: '#fef2f2' },
    acknowledged: { label: 'Reconhecido', color: '#ca8a04', bg: '#fefce8' },
    resolved: { label: 'Resolvido', color: '#16a34a', bg: '#f0fdf4' },
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

  return (
    <div className="alerts-page">
      <div className="page-hero">
        <div className="hero-left">
          <h2>🔔 Alertas</h2>
          <p>Monitore alertas operacionais do sistema</p>
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-card"><span className="stat-num">{stats.total}</span><span className="stat-label">Total</span></div>
        <div className="stat-card active"><span className="stat-num">{stats.active}</span><span className="stat-label">Ativos</span></div>
        <div className="stat-card ack"><span className="stat-num">{stats.acknowledged}</span><span className="stat-label">Reconhecidos</span></div>
        <div className="stat-card resolved"><span className="stat-num">{stats.resolved}</span><span className="stat-label">Resolvidos</span></div>
        {stats.critical > 0 && <div className="stat-card critical"><span className="stat-num">{stats.critical}</span><span className="stat-label">🔴 Críticos</span></div>}
      </div>

      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">Status:</span>
          {[{ k: '', l: 'Todos' }, { k: 'active', l: 'Ativos' }, { k: 'acknowledged', l: 'Reconhecidos' }, { k: 'resolved', l: 'Resolvidos' }].map(f => (
            <button key={f.k} className={`chip ${filterStatus === f.k ? 'active' : ''}`} onClick={() => setFilterStatus(f.k)}>{f.l}</button>
          ))}
        </div>
        <div className="filter-group">
          <span className="filter-label">Severidade:</span>
          {[{ k: '', l: 'Todas' }, { k: 'critical', l: '🔴' }, { k: 'error', l: '🟠' }, { k: 'warning', l: '🟡' }, { k: 'info', l: '🔵' }].map(f => (
            <button key={f.k} className={`chip ${filterSeverity === f.k ? 'active' : ''}`} onClick={() => setFilterSeverity(f.k)}>{f.l}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="loading-state"><div className="spinner" /> Carregando alertas...</div>
      ) : alerts.length === 0 ? (
        <div className="empty-state"><span className="empty-icon">🔔</span><p>Nenhum alerta encontrado</p></div>
      ) : (
        <div className="alert-list">
          {alerts.map(alert => {
            const sev = severityConfig[alert.severity] || severityConfig.info;
            const sta = statusConfig[alert.status] || statusConfig.active;

            return (
              <div key={alert.id} className={`alert-card ${alert.status === 'resolved' ? 'resolved' : ''}`} style={{ borderLeftColor: sev.border }}>
                <div className="alert-severity-bar" style={{ background: sev.bg }}>
                  <span className="sev-badge" style={{ color: sev.color }}>{sev.icon} {sev.label}</span>
                  <span className="sta-badge" style={{ background: sta.bg, color: sta.color }}>{sta.label}</span>
                </div>

                <div className="alert-body">
                  <h3 className="alert-title">{alert.title}</h3>
                  {alert.message && <p className="alert-msg">{alert.message}</p>}

                  <div className="alert-meta">
                    <span className="alert-type">{alert.type}</span>
                    <span className="alert-time">{timeAgo(alert.createdAt)}</span>
                    {alert.acknowledgedAt && <span className="alert-ack">👁️ {timeAgo(alert.acknowledgedAt)}</span>}
                    {alert.resolvedAt && <span className="alert-resolved">✅ {timeAgo(alert.resolvedAt)}</span>}
                  </div>
                </div>

                {alert.status === 'active' && (
                  <div className="alert-actions">
                    <button className="btn-ack" onClick={() => handleAck(alert.id)}>👁️ Reconhecer</button>
                    <button className="btn-resolve" onClick={() => handleResolve(alert.id)}>✅ Resolver</button>
                  </div>
                )}
                {alert.status === 'acknowledged' && (
                  <div className="alert-actions">
                    <button className="btn-resolve" onClick={() => handleResolve(alert.id)}>✅ Resolver</button>
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
