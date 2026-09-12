import { useState, useEffect } from 'react';
import { alertApi, type Alert } from '../lib/api';
import { useAuthStore } from '../store/auth';
import { Icon } from '../components/ui/Icon';
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

  const severityConfig: Record<string, { label: string; color: string; bg: string; border: string }> = {
    critical: { label: 'Crítico', color: '#b42334', bg: '#fdefef', border: '#e9aab2' },
    error: { label: 'Erro', color: '#b4540b', bg: '#fff4e8', border: '#efbf91' },
    warning: { label: 'Aviso', color: '#8b6508', bg: '#fff9dd', border: '#ead481' },
    info: { label: 'Info', color: '#155bc7', bg: '#edf4ff', border: '#9bc4ef' },
  };

  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    active: { label: 'Ativo', color: '#b42334', bg: '#fef2f2' },
    acknowledged: { label: 'Reconhecido', color: '#765600', bg: '#fefce8' },
    resolved: { label: 'Resolvido', color: '#137333', bg: '#f0fdf4' },
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
          <span className="page-kicker">Central de atenção</span>
          <h2><Icon name="alerts" /> Alertas</h2>
          <p>Monitore alertas operacionais do sistema</p>
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-card"><span className="stat-num">{stats.total}</span><span className="stat-label">Total</span></div>
        <div className="stat-card active"><span className="stat-num">{stats.active}</span><span className="stat-label">Ativos</span></div>
        <div className="stat-card ack"><span className="stat-num">{stats.acknowledged}</span><span className="stat-label">Reconhecidos</span></div>
        <div className="stat-card resolved"><span className="stat-num">{stats.resolved}</span><span className="stat-label">Resolvidos</span></div>
        {stats.critical > 0 && <div className="stat-card critical"><span className="stat-num">{stats.critical}</span><span className="stat-label"><i className="severity-dot critical" /> Críticos</span></div>}
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
          {[{ k: '', l: 'Todas' }, { k: 'critical', l: 'Crítico' }, { k: 'error', l: 'Erro' }, { k: 'warning', l: 'Aviso' }, { k: 'info', l: 'Info' }].map(f => (
            <button key={f.k} className={`chip severity-filter severity-${f.k || 'all'} ${filterSeverity === f.k ? 'active' : ''}`} onClick={() => setFilterSeverity(f.k)}>{f.l}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="loading-state"><div className="spinner" /> Carregando alertas...</div>
      ) : alerts.length === 0 ? (
        <div className="empty-state"><span className="empty-icon"><Icon name="alerts" /></span><p>Nenhum alerta encontrado</p></div>
      ) : (
        <div className="alert-list">
          {alerts.map(alert => {
            const sev = severityConfig[alert.severity] || severityConfig.info;
            const sta = statusConfig[alert.status] || statusConfig.active;

            return (
              <div key={alert.id} className={`alert-card ${alert.status === 'resolved' ? 'resolved' : ''}`} style={{ borderLeftColor: sev.border }}>
                <div className="alert-severity-bar" style={{ background: sev.bg }}>
                  <span className="sev-badge" style={{ color: sev.color }}><i style={{ background: sev.color }} /> {sev.label}</span>
                  <span className="sta-badge" style={{ background: sta.bg, color: sta.color }}>{sta.label}</span>
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

                {alert.status === 'active' && (
                  <div className="alert-actions">
                    <button className="btn-ack" onClick={() => handleAck(alert.id)}><Icon name="eye" size={15} /> Reconhecer</button>
                    <button className="btn-resolve" onClick={() => handleResolve(alert.id)}><Icon name="check" size={15} /> Resolver</button>
                  </div>
                )}
                {alert.status === 'acknowledged' && (
                  <div className="alert-actions">
                    <button className="btn-resolve" onClick={() => handleResolve(alert.id)}><Icon name="check" size={15} /> Resolver</button>
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
