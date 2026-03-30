import { useState, useEffect } from 'react';
import { dashboardApi, type DashboardSummary } from '../lib/api';
import './Dashboard.css';

export function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dashboardApi.getSummary()
      .then(setSummary)
      .catch(err => console.error('Erro:', err))
      .finally(() => setLoading(false));
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
    </div>
  );
}
