import { useState, useEffect, useCallback } from 'react';
import { taskApi, Task } from '../lib/api';
import './Tasks.css';

export function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<string>('');
  const [showCreate, setShowCreate] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', description: '', priority: 'medium' });
  const [creating, setCreating] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      const result = await taskApi.list(filter ? { status: filter } : undefined);
      setTasks(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 30000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const handleCreateTask = async () => {
    if (!newTask.title.trim()) return;
    setCreating(true);
    try {
      await taskApi.create({
        title: newTask.title,
        description: newTask.description,
        priority: newTask.priority,
      });
      setNewTask({ title: '', description: '', priority: 'medium' });
      setShowCreate(false);
      await fetchTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setCreating(false);
    }
  };

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    try {
      await taskApi.updateStatus(taskId, { status: newStatus });
      await fetchTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task');
    }
  };

  const getPriorityBadge = (priority: string) => {
    const badges: Record<string, string> = {
      urgent: 'badge-urgent',
      high: 'badge-high',
      medium: 'badge-medium',
      low: 'badge-low',
    };
    return badges[priority] || 'badge-medium';
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, string> = {
      pending: 'badge-pending',
      in_progress: 'badge-progress',
      completed: 'badge-completed',
      cancelled: 'badge-cancelled',
    };
    return badges[status] || 'badge-pending';
  };

  const isOverdue = (dueAt: string | null) => {
    if (!dueAt) return false;
    return new Date(dueAt) < new Date();
  };

  if (loading) return <div className="loading">Carregando tarefas...</div>;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className="page-container">
      <header className="page-header">
        <div className="header-content">
          <div>
            <h1>Tarefas</h1>
            <p className="text-muted">Gerencie as tarefas operacionais</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>
            + Nova Tarefa
          </button>
        </div>
      </header>

      {showCreate && (
        <div className="task-create-form">
          <div className="form-row">
            <input
              type="text"
              className="input"
              placeholder="Título da tarefa"
              value={newTask.title}
              onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
            />
            <select
              className="input"
              value={newTask.priority}
              onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}
            >
              <option value="low">Baixa</option>
              <option value="medium">Média</option>
              <option value="high">Alta</option>
              <option value="urgent">Urgente</option>
            </select>
            <button className="btn btn-primary" onClick={handleCreateTask} disabled={creating}>
              {creating ? 'Criando...' : 'Criar'}
            </button>
            <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>
              Cancelar
            </button>
          </div>
          <textarea
            className="input"
            placeholder="Descrição (opcional)"
            value={newTask.description}
            onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
            rows={2}
          />
        </div>
      )}

      <div className="task-filters">
        <button
          className={`filter-btn ${filter === '' ? 'active' : ''}`}
          onClick={() => setFilter('')}
        >
          Todas
        </button>
        <button
          className={`filter-btn ${filter === 'pending' ? 'active' : ''}`}
          onClick={() => setFilter('pending')}
        >
          Pendentes
        </button>
        <button
          className={`filter-btn ${filter === 'in_progress' ? 'active' : ''}`}
          onClick={() => setFilter('in_progress')}
        >
          Em Progresso
        </button>
        <button
          className={`filter-btn ${filter === 'completed' ? 'active' : ''}`}
          onClick={() => setFilter('completed')}
        >
          Concluídas
        </button>
      </div>

      {tasks.length === 0 ? (
        <div className="empty-state">Nenhuma tarefa encontrada</div>
      ) : (
        <div className="task-list">
          {tasks.map((task) => (
            <div key={task.id} className={`task-card ${isOverdue(task.dueAt) && task.status !== 'completed' ? 'overdue' : ''}`}>
              <div className="task-header">
                <span className="task-id">#{task.id.slice(0, 8)}</span>
                <div className="task-badges">
                  <span className={`badge ${getPriorityBadge(task.priority)}`}>{task.priority}</span>
                  <span className={`badge ${getStatusBadge(task.status)}`}>{task.status}</span>
                </div>
              </div>
              <h3 className="task-title">{task.title}</h3>
              {task.description && <p className="task-description">{task.description}</p>}
              <div className="task-meta">
                {task.dueAt && (
                  <span className={`task-due ${isOverdue(task.dueAt) ? 'overdue' : ''}`}>
                    Prazo: {new Date(task.dueAt).toLocaleDateString('pt-BR')}
                  </span>
                )}
                <span className="task-created">
                  Criada: {new Date(task.createdAt).toLocaleDateString('pt-BR')}
                </span>
              </div>
              <div className="task-actions">
                {task.status === 'pending' && (
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => handleStatusChange(task.id, 'in_progress')}
                  >
                    Iniciar
                  </button>
                )}
                {task.status === 'in_progress' && (
                  <button
                    className="btn btn-sm btn-success"
                    onClick={() => handleStatusChange(task.id, 'completed')}
                  >
                    Concluir
                  </button>
                )}
                {task.status !== 'completed' && task.status !== 'cancelled' && (
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleStatusChange(task.id, 'cancelled')}
                  >
                    Cancelar
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
