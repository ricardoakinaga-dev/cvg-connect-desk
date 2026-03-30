import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import './Dashboard.css';

interface DashboardSummary {
  conversations: {
    open: number;
    pending: number;
    closed: number;
    archived: number;
    total: number;
  };
  tasks: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    cancelled: number;
    overdue: number;
  };
  alerts: {
    total: number;
    active: number;
    acknowledged: number;
    resolved: number;
    bySeverity: {
      info: number;
      warning: number;
      error: number;
      critical: number;
    };
  };
  generatedAt: string;
}

export function Dashboard() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await api.get<DashboardSummary>('/metrics/summary');
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) return <div className="loading">Carregando...</div>;
  if (error) return <div className="error-message">{error}</div>;
  if (!data) return null;

  return (
    <div className="page-container">
      <header className="page-header">
        <h1>Dashboard</h1>
        <p className="text-muted">Visão geral operacional</p>
      </header>

      <div className="dashboard-grid">
        <div className="metric-card">
          <div className="metric-header">
            <h3>Conversas</h3>
          </div>
          <div className="metric-body">
            <div className="metric-value">{data.conversations.open + data.conversations.pending}</div>
            <div className="metric-label">Abertas</div>
          </div>
          <div className="metric-details">
            <div className="metric-detail">
              <span className="badge badge-info">{data.conversations.open} abertas</span>
              <span className="badge badge-warning">{data.conversations.pending} pendentes</span>
            </div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <h3>Tarefas</h3>
          </div>
          <div className="metric-body">
            <div className="metric-value">{data.tasks.overdue}</div>
            <div className="metric-label">Vencidas</div>
          </div>
          <div className="metric-details">
            <div className="metric-detail">
              <span className="badge badge-info">{data.tasks.pending} pendentes</span>
              <span className="badge badge-success">{data.tasks.inProgress} em progresso</span>
            </div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <h3>Alertas</h3>
          </div>
          <div className="metric-body">
            <div className="metric-value">{data.alerts.active}</div>
            <div className="metric-label">Ativos</div>
          </div>
          <div className="metric-details">
            <div className="metric-detail">
              <span className="badge badge-error">{data.alerts.bySeverity.critical} críticos</span>
              <span className="badge badge-warning">{data.alerts.bySeverity.warning} warnings</span>
            </div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <h3>Total Geral</h3>
          </div>
          <div className="metric-body">
            <div className="metric-value">{data.conversations.total + data.tasks.total + data.alerts.total}</div>
            <div className="metric-label">Registros</div>
          </div>
          <div className="metric-details">
            <div className="metric-detail">
              <span>{data.conversations.total} conversas</span>
            </div>
          </div>
        </div>
      </div>

      <div className="dashboard-footer">
        <p className="text-sm text-muted">
          Última atualização: {new Date(data.generatedAt).toLocaleString('pt-BR')}
        </p>
      </div>
    </div>
  );
}
