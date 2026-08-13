import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getErrorMessage } from '../lib/api';
import './Kanban.css';

interface KanbanCard {
  id: string;
  contactName: string | null;
  contactPhone: string | null;
  lastMessage: string | null;
  assignedUserName: string | null;
  sectorName: string | null;
  sectorColor: string | null;
  sectorIcon: string | null;
  labels: { name: string; color: string }[];
  priority: string;
  minutesSinceUpdate: number;
}

interface KanbanColumn {
  status: string;
  label: string;
  icon: string;
  color: string;
  count: number;
  cards: KanbanCard[];
}

interface KanbanBoard {
  columns: KanbanColumn[];
  filters: {
    sectors: { id: string; name: string; icon: string; color: string }[];
    labels: { id: string; name: string; color: string }[];
  };
}

const STATUS_ORDER = ['novo', 'em_atendimento', 'pendente', 'em_espera', 'finalizado'];

export function Kanban() {
  const navigate = useNavigate();
  const [board, setBoard] = useState<KanbanBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterSector, setFilterSector] = useState('');
  const [draggedCard, setDraggedCard] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  const fetchBoard = useCallback(async (options: { silent?: boolean } = {}) => {
    if (options.silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const params = filterSector ? `?sectorId=${filterSector}` : '';
      const data = await api.get<KanbanBoard>(`/kanban/board${params}`);
      setBoard(data);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Erro ao carregar Kanban'));
      console.error('Erro ao carregar kanban:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filterSector]);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  const handleDragStart = (cardId: string) => {
    setDraggedCard(cardId);
  };

  const handleDragOver = (e: React.DragEvent, status: string) => {
    e.preventDefault();
    setDragOverColumn(status);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const moveCard = async (cardId: string, targetStatus: string) => {
    setError(null);
    try {
      await api.patch(`/kanban/card/${cardId}/move`, { status: targetStatus });
      fetchBoard({ silent: true });
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Erro ao mover card'));
      console.error('Erro ao mover card:', err);
    }
  };

  const handleDrop = async (targetStatus: string) => {
    if (!draggedCard) return;
    setDragOverColumn(null);

    try {
      await moveCard(draggedCard, targetStatus);
    } finally {
      setDraggedCard(null);
    }
  };

  const nextStatus = (status: string) => {
    const currentIndex = STATUS_ORDER.indexOf(status);
    if (currentIndex < 0 || currentIndex >= STATUS_ORDER.length - 1) return null;
    return STATUS_ORDER[currentIndex + 1];
  };

  const formatTime = (minutes: number) => {
    if (!Number.isFinite(minutes) || minutes < 0) return 'agora';
    if (minutes < 60) return `${minutes}min`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
    return `${Math.floor(minutes / 1440)}d`;
  };

  const priorityBorder = (priority: string) => {
    switch (priority) {
      case 'urgent': return '#ef4444';
      case 'high': return '#f97316';
      case 'low': return '#9ca3af';
      default: return 'transparent';
    }
  };

  if (loading) return <div className="kanban-page"><div className="loading">Carregando Kanban...</div></div>;

  const columns = board?.columns.filter(c => STATUS_ORDER.includes(c.status)).sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
  ) || [];
  const filters = board?.filters ?? { sectors: [], labels: [] };

  return (
    <div className="kanban-page">
      <div className="kanban-header">
        <h2>Kanban</h2>
        <div className="kanban-filters">
          <select value={filterSector} onChange={e => setFilterSector(e.target.value)}>
            <option value="">Todos os Setores</option>
            {filters.sectors.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button type="button" className="btn-refresh" onClick={() => fetchBoard({ silent: true })} disabled={refreshing} title="Atualizar Kanban" aria-label="Atualizar Kanban">
            {refreshing ? '...' : 'Atualizar'}
          </button>
        </div>
      </div>

      {error && (
        <div className="kanban-error">
          <span>{error}</span>
          <button type="button" onClick={() => fetchBoard({ silent: true })}>Tentar novamente</button>
        </div>
      )}

      <div className="kanban-stats">
        {columns.map(col => (
          <div key={col.status} className="stat-pill" style={{ borderColor: col.color }}>
            {col.label}: {col.count}
          </div>
        ))}
      </div>

      <div className="kanban-board">
        {columns.map(column => (
          <div
            key={column.status}
            className={`kanban-column ${dragOverColumn === column.status ? 'drag-over' : ''}`}
            onDragOver={e => handleDragOver(e, column.status)}
            onDragLeave={handleDragLeave}
            onDrop={() => handleDrop(column.status)}
          >
            <div className="column-header" style={{ borderTopColor: column.color }}>
              <span className="column-icon">{column.label.slice(0, 2).toUpperCase()}</span>
              <span className="column-label">{column.label}</span>
              <span className="column-count">{column.count}</span>
            </div>

            <div className="column-cards">
              {column.cards.map(card => (
                <div
                  key={card.id}
                  className={`kanban-card priority-${card.priority}`}
                  draggable
                  onDragStart={() => handleDragStart(card.id)}
                  style={{ borderLeftColor: priorityBorder(card.priority) }}
                >
                  <div className="card-header">
                    <span className="card-name">{card.contactName || 'Sem nome'}</span>
                    <span className="card-time">{formatTime(card.minutesSinceUpdate)}</span>
                  </div>

                  {card.sectorName && (
                    <div className="card-sector" style={{ color: card.sectorColor || '#666' }}>
                      {card.sectorName}
                    </div>
                  )}

                  {card.lastMessage && (
                    <div className="card-message">{card.lastMessage.length > 60 ? `${card.lastMessage.substring(0, 60)}...` : card.lastMessage}</div>
                  )}

                  <div className="card-footer">
                    {card.assignedUserName && (
                      <span className="card-agent">{card.assignedUserName.split(' ')[0]}</span>
                    )}
                    {(card.labels || []).length > 0 && (
                      <div className="card-labels">
                        {(card.labels || []).slice(0, 3).map((label, i) => (
                          <span key={i} className="label-dot" style={{ background: label.color }} title={label.name} />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="card-actions">
                    <button type="button" onClick={() => navigate(`/inbox?conversation=${card.id}`)}>Abrir</button>
                    {nextStatus(column.status) && (
                      <button type="button" onClick={() => moveCard(card.id, nextStatus(column.status)!)}>Avançar</button>
                    )}
                  </div>
                </div>
              ))}

              {column.cards.length === 0 && (
                <div className="column-empty">Nenhum atendimento</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
