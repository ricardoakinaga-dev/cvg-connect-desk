import { useState, useEffect } from 'react';
import { getErrorMessage, taskApi, type Task } from '../lib/api';
import './Tasks.css';

export function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', description: '', priority: 'medium', dueAt: '' });

  const fetchTasks = async () => {
    try {
      const filters: { status?: string; priority?: string } = {};
      if (filterStatus) filters.status = filterStatus;
      if (filterPriority) filters.priority = filterPriority;
      const data = await taskApi.list(filters);
      setTasks(data);
    } catch (err: unknown) { alert(getErrorMessage(err, 'Erro ao atualizar tarefa')); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchTasks(); }, [filterStatus, filterPriority]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.title.trim()) return;
    try {
      await taskApi.create(newTask);
      setNewTask({ title: '', description: '', priority: 'medium', dueAt: '' });
      setShowCreate(false);
      fetchTasks();
    } catch (err: unknown) { alert(getErrorMessage(err)); }
  };

  const handleStatusChange = async (id: string, status: string) => {
    try {
      await taskApi.updateStatus(id, { status });
      fetchTasks();
    } catch (err) { console.error('Erro:', err); }
  };

  const priorityConfig: Record<string, { label: string; icon: string; color: string; bg: string }> = {
    urgent: { label: 'Urgente', icon: 'URG', color: '#dc2626', bg: '#fef2f2' },
    high: { label: 'Alta', icon: 'ALT', color: '#ea580c', bg: '#fff7ed' },
    medium: { label: 'Média', icon: 'MED', color: '#ca8a04', bg: '#fefce8' },
    low: { label: 'Baixa', icon: 'BX', color: '#16a34a', bg: '#f0fdf4' },
  };

  const statusConfig: Record<string, { label: string; icon: string; color: string; bg: string }> = {
    pending: { label: 'Pendente', icon: 'PD', color: '#ca8a04', bg: '#fefce8' },
    in_progress: { label: 'Em Andamento', icon: 'EA', color: '#2563eb', bg: '#eff6ff' },
    completed: { label: 'Concluída', icon: 'OK', color: '#16a34a', bg: '#f0fdf4' },
    cancelled: { label: 'Cancelada', icon: 'CN', color: '#6b7280', bg: '#f9fafb' },
  };

  const isOverdue = (task: Task) => task.dueAt && new Date(task.dueAt) < new Date() && task.status !== 'completed' && task.status !== 'cancelled';

  const timeUntil = (d: string) => {
    const diff = new Date(d).getTime() - Date.now();
    if (diff < 0) return 'Vencida';
    const hours = Math.floor(diff / 3600000);
    if (hours < 24) return `${hours}h restantes`;
    return `${Math.floor(hours / 24)}d restantes`;
  };

  const stats = {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    inProgress: tasks.filter(t => t.status === 'in_progress').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    overdue: tasks.filter(t => isOverdue(t)).length,
  };

  return (
    <div className="tasks-page">
      <div className="page-hero">
        <div className="hero-left">
          <h2>✓ Tarefas</h2>
          <p>Gerencie as tarefas da operação</p>
        </div>
        <button className="btn-create" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? '✕ Cancelar' : '＋ Nova Tarefa'}
        </button>
      </div>

      <div className="stats-row">
        <div className="stat-card"><span className="stat-num">{stats.total}</span><span className="stat-label">Total</span></div>
        <div className="stat-card pending"><span className="stat-num">{stats.pending}</span><span className="stat-label">Pendentes</span></div>
        <div className="stat-card progress"><span className="stat-num">{stats.inProgress}</span><span className="stat-label">Em Andamento</span></div>
        <div className="stat-card done"><span className="stat-num">{stats.completed}</span><span className="stat-label">Concluídas</span></div>
        {stats.overdue > 0 && <div className="stat-card overdue"><span className="stat-num">{stats.overdue}</span><span className="stat-label">Vencidas</span></div>}
      </div>

      {showCreate && (
        <form className="create-panel" onSubmit={handleCreate}>
          <input placeholder="Título da tarefa" value={newTask.title} onChange={e => setNewTask({ ...newTask, title: e.target.value })} required />
          <textarea placeholder="Descrição (opcional)" value={newTask.description} onChange={e => setNewTask({ ...newTask, description: e.target.value })} rows={2} />
          <div className="create-row">
            <select value={newTask.priority} onChange={e => setNewTask({ ...newTask, priority: e.target.value })}>
              <option value="low">Baixa</option>
              <option value="medium">Média</option>
              <option value="high">Alta</option>
              <option value="urgent">Urgente</option>
            </select>
            <input type="datetime-local" value={newTask.dueAt} onChange={e => setNewTask({ ...newTask, dueAt: e.target.value })} />
            <button type="submit" className="btn-create">Criar</button>
          </div>
        </form>
      )}

      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">Status:</span>
          {[{ k: '', l: 'Todos' }, { k: 'pending', l: 'Pendente' }, { k: 'in_progress', l: 'Em Andamento' }, { k: 'completed', l: 'Concluída' }].map(f => (
            <button key={f.k} className={`chip ${filterStatus === f.k ? 'active' : ''}`} onClick={() => setFilterStatus(f.k)}>{f.l}</button>
          ))}
        </div>
        <div className="filter-group">
          <span className="filter-label">Prioridade:</span>
          {[{ k: '', l: 'Todas' }, { k: 'urgent', l: 'Urgente' }, { k: 'high', l: 'Alta' }, { k: 'medium', l: 'Média' }, { k: 'low', l: 'Baixa' }].map(f => (
            <button key={f.k} className={`chip ${filterPriority === f.k ? 'active' : ''}`} onClick={() => setFilterPriority(f.k)}>{f.l}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="loading-state"><div className="spinner" /> Carregando tarefas...</div>
      ) : tasks.length === 0 ? (
        <div className="empty-state"><span className="empty-icon">TK</span><p>Nenhuma tarefa encontrada</p></div>
      ) : (
        <div className="task-grid">
          {tasks.map(task => {
            const pri = priorityConfig[task.priority] || priorityConfig.medium;
            const sta = statusConfig[task.status] || statusConfig.pending;
            const overdue = isOverdue(task);

            return (
              <div key={task.id} className={`task-card ${overdue ? 'overdue' : ''}`}>
                <div className="task-card-header">
                  <span className="priority-badge" style={{ background: pri.bg, color: pri.color }}>{pri.icon} {pri.label}</span>
                  <span className="status-badge" style={{ background: sta.bg, color: sta.color }}>{sta.icon} {sta.label}</span>
                </div>

                <h3 className="task-title">{task.title}</h3>
                {task.description && <p className="task-desc">{task.description}</p>}

                <div className="task-meta">
                  {task.dueAt && (
                    <span className={`due-badge ${overdue ? 'overdue' : ''}`}>
                      {new Date(task.dueAt).toLocaleDateString('pt-BR')} · {timeUntil(task.dueAt)}
                    </span>
                  )}
                  {task.assignedTo && <span className="assignee">Responsável {task.assignedTo.slice(0, 8)}</span>}
                </div>

                <div className="task-actions">
                  {task.status === 'pending' && (
                    <button className="btn-action start" onClick={() => handleStatusChange(task.id, 'in_progress')}>▶ Iniciar</button>
                  )}
                  {task.status === 'in_progress' && (
                    <button className="btn-action done" onClick={() => handleStatusChange(task.id, 'completed')}>Concluir</button>
                  )}
                  {(task.status === 'pending' || task.status === 'in_progress') && (
                    <button className="btn-action cancel" onClick={() => handleStatusChange(task.id, 'cancelled')}>Cancelar</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
