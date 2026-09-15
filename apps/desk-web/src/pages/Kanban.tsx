import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Badge, Button, EmptyState, ErrorState, Icon, LoadingState, type BadgeTone } from '../components/ui';
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

interface LoadFailure {
  title: string;
  message: string;
  retryable: boolean;
}

function loadFailureFrom(error: unknown): LoadFailure {
  const status = (error as { status?: number } | null)?.status ?? 0;
  const raw = error instanceof Error ? error.message : '';
  if (status === 403) {
    return { title: 'Acesso negado', message: 'Você não tem permissão para ver este Kanban.', retryable: false };
  }
  if (status === 401) {
    return { title: 'Sessão expirada', message: 'Entre novamente para continuar.', retryable: false };
  }
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (!status && (offline || /failed to fetch|network|sem conexão/i.test(raw))) {
    return { title: 'Sem conexão', message: 'Não foi possível alcançar o servidor. Verifique sua conexão e tente novamente.', retryable: true };
  }
  return { title: 'Não foi possível carregar', message: raw || 'O servidor não respondeu como esperado.', retryable: true };
}

function messageFromError(error: unknown): string {
  const raw = error instanceof Error ? error.message.trim() : '';
  return raw || 'Não foi possível concluir a operação.';
}

const STATUS_ORDER = ['novo', 'em_atendimento', 'pendente', 'em_espera', 'finalizado', 'arquivado'];

const priorityConfig: Record<string, { label: string; tone: BadgeTone; border: string }> = {
  urgent: { label: 'Urgente', tone: 'error', border: 'var(--color-critical)' },
  high: { label: 'Alta', tone: 'warning', border: 'var(--color-warning)' },
  medium: { label: 'Média', tone: 'info', border: 'var(--color-info)' },
  normal: { label: 'Normal', tone: 'neutral', border: 'transparent' },
  low: { label: 'Baixa', tone: 'neutral', border: 'var(--color-border-strong)' },
};

export function Kanban() {
  const [board, setBoard] = useState<KanbanBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadFailure | null>(null);
  const [refreshError, setRefreshError] = useState<LoadFailure | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filterSector, setFilterSector] = useState('');
  const [draggedCard, setDraggedCard] = useState<{ id: string; name: string } | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ id: string; status: string } | null>(null);
  const [moveErrors, setMoveErrors] = useState<Record<string, { status: string; message: string }>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const hasBoardRef = useRef(false);

  const fetchBoard = useCallback(async (mode: 'initial' | 'refresh' | 'silent') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    try {
      const params = filterSector ? `?sectorId=${encodeURIComponent(filterSector)}` : '';
      const data = await api.get<KanbanBoard>(`/kanban/board${params}`);
      setBoard(data);
      hasBoardRef.current = true;
      if (mode === 'initial') setLoadError(null);
      if (mode === 'refresh' || mode === 'silent') setRefreshError(null);
    } catch (err) {
      const failure = loadFailureFrom(err);
      if (mode === 'initial' || !hasBoardRef.current) setLoadError(failure);
      else setRefreshError(failure);
    } finally {
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
    }
  }, [filterSector]);

  useEffect(() => { void fetchBoard('initial'); }, [fetchBoard]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const clearMoveError = (cardId: string) => {
    setMoveErrors(current => {
      if (!current[cardId]) return current;
      const next = { ...current };
      delete next[cardId];
      return next;
    });
  };

  const moveCard = async (card: { id: string; name: string }, targetStatus: string, targetLabel: string) => {
    if (moving) return;
    setMoving({ id: card.id, status: targetStatus });
    clearMoveError(card.id);
    try {
      await api.patch(`/kanban/card/${card.id}/move`, { status: targetStatus });
      setFeedback(`Atendimento de ${card.name} movido para ${targetLabel}.`);
      await fetchBoard('silent');
    } catch (err) {
      setMoveErrors(current => ({ ...current, [card.id]: { status: targetStatus, message: messageFromError(err) } }));
    } finally {
      setMoving(null);
    }
  };

  const handleDragStart = (card: KanbanCard) => {
    setDraggedCard({ id: card.id, name: card.contactName || 'Sem nome' });
  };

  const handleDragOver = (e: React.DragEvent, status: string) => {
    e.preventDefault();
    setDragOverColumn(status);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (targetStatus: string, targetLabel: string) => {
    if (!draggedCard) return;
    const card = draggedCard;
    setDraggedCard(null);
    setDragOverColumn(null);
    void moveCard(card, targetStatus, targetLabel);
  };

  const formatTime = (minutes: number) => {
    if (minutes < 60) return `${minutes}min`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
    return `${Math.floor(minutes / 1440)}d`;
  };

  const columns = board
    ? [...board.columns]
        .map(column => ({ ...column, cards: column.cards || [] }))
        .sort((a, b) => {
          const ia = STATUS_ORDER.indexOf(a.status);
          const ib = STATUS_ORDER.indexOf(b.status);
          if (ia === -1 && ib === -1) return 0;
          if (ia === -1) return 1;
          if (ib === -1) return -1;
          return ia - ib;
        })
    : [];

  const totalCards = columns.reduce((sum, column) => sum + column.cards.length, 0);
  const failure = loadError || { title: 'Não foi possível carregar', message: 'O board não foi retornado.', retryable: true };

  return (
    <div className="kanban-page" aria-busy={loading || refreshing || undefined}>
      <div className="kanban-header">
        <h1><Icon name="kanban" /> Kanban</h1>
        <div className="kanban-filters">
          <select aria-label="Filtrar Kanban por setor" value={filterSector} disabled={loading} onChange={e => setFilterSector(e.target.value)}>
            <option value="">Todos os Setores</option>
            {(board?.filters.sectors ?? []).map(sector => (
              <option key={sector.id} value={sector.id}>{sector.name}</option>
            ))}
          </select>
          <Button variant="secondary" size="icon" icon="refresh" aria-label="Atualizar Kanban" loading={refreshing} onClick={() => { void fetchBoard('refresh'); }} />
        </div>
      </div>

      {feedback && (
        <div className="ui-alert ui-alert--success kanban-feedback" role="status">
          <Icon name="check" size={18} />
          <span>{feedback}</span>
        </div>
      )}

      {refreshError && (
        <div className="ui-alert kanban-feedback" role="alert">
          <Icon name="warning" size={18} />
          <span>Não foi possível atualizar o Kanban: {refreshError.message}</span>
          <Button variant="secondary" size="sm" onClick={() => { void fetchBoard('refresh'); }}>Tentar novamente</Button>
        </div>
      )}

      {loading ? (
        <LoadingState label="Carregando Kanban…" />
      ) : !board || loadError ? (
        <ErrorState
          title={failure.title}
          message={failure.message}
          onRetry={failure.retryable ? () => { void fetchBoard('initial'); } : undefined}
        />
      ) : totalCards === 0 ? (
        <EmptyState
          title="Nenhum atendimento no Kanban"
          description={filterSector ? 'Nenhum atendimento para o setor selecionado. Ajuste o filtro ou atualize o board.' : 'Quando houver conversas ativas, elas aparecerão nas colunas de status.'}
          icon="kanban"
          action={filterSector
            ? <Button variant="secondary" size="sm" onClick={() => setFilterSector('')}>Mostrar todos os setores</Button>
            : <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void fetchBoard('refresh'); }}>Atualizar</Button>}
        />
      ) : (
        <>
          <div className="kanban-stats" role="group" aria-label="Atendimentos por status">
            {columns.map(column => (
              <div key={column.status} className="stat-pill" style={{ borderColor: column.color }}>
                <i style={{ background: column.color }} aria-hidden="true" />
                <span className="ui-sr-only">{column.label}:</span>{column.cards.length}
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
                onDrop={() => handleDrop(column.status, column.label)}
              >
                <div className="column-header" style={{ borderTopColor: column.color }}>
                  <span className="column-icon" style={{ background: column.color }} aria-hidden="true" />
                  <span className="column-label">{column.label}</span>
                  <span className="column-count">{column.cards.length}</span>
                </div>

                <div className="column-cards">
                  {column.cards.map(card => {
                    const pri = priorityConfig[card.priority] || priorityConfig.normal;
                    const busy = moving?.id === card.id;
                    return (
                      <div
                        key={card.id}
                        className={`kanban-card priority-${card.priority}`}
                        draggable={!moving}
                        onDragStart={() => handleDragStart(card)}
                        style={{ borderLeftColor: pri.border }}
                        aria-busy={busy || undefined}
                      >
                        <div className="card-header">
                          <span className="card-name">{card.contactName || 'Sem nome'}</span>
                          <span className="card-time">{formatTime(card.minutesSinceUpdate)}</span>
                        </div>
                        <Badge tone={pri.tone}>Prioridade {pri.label}</Badge>

                        {card.sectorName && (
                          <div
                            className="card-sector"
                            style={{ '--sector-accent': card.sectorColor || 'var(--color-text-secondary)' } as React.CSSProperties}
                          >
                            <span className="card-sector-accent" aria-hidden="true" />
                            {card.sectorIcon} {card.sectorName}
                          </div>
                        )}

                        {card.lastMessage && (
                          <div className="card-message">{card.lastMessage.substring(0, 60)}…</div>
                        )}

                        <div className="card-footer">
                          {card.assignedUserName && (
                            <span className="card-agent"><Icon name="tutors" size={13} /> {card.assignedUserName.split(' ')[0]}</span>
                          )}
                          {card.labels.length > 0 && (
                            <div className="card-labels">
                              {card.labels.slice(0, 3).map((label, index) => (
                                <span key={`${label.name}-${index}`} className="label-dot" role="img" aria-label={label.name} style={{ background: label.color }} title={label.name} />
                              ))}
                            </div>
                          )}
                        </div>

                        {moveErrors[card.id] && (
                          <div className="card-move-error" role="alert">
                            <span>Não foi possível mover: {moveErrors[card.id].message}</span>
                            <button
                              type="button"
                              className="card-move-retry"
                              onClick={() => void moveCard({ id: card.id, name: card.contactName || 'Sem nome' }, moveErrors[card.id].status, columns.find(c => c.status === moveErrors[card.id].status)?.label || moveErrors[card.id].status)}
                            >
                              Tentar novamente
                            </button>
                          </div>
                        )}

                        <label className="card-move">
                          <span>{busy ? 'Movendo…' : 'Mover para'}</span>
                          <select
                            value=""
                            disabled={Boolean(moving)}
                            aria-label={`Mover atendimento de ${card.contactName || 'Sem nome'} para outro status`}
                            onChange={(event) => {
                              const targetStatus = event.target.value;
                              if (!targetStatus || targetStatus === column.status) return;
                              const target = columns.find(c => c.status === targetStatus);
                              void moveCard({ id: card.id, name: card.contactName || 'Sem nome' }, targetStatus, target?.label || targetStatus);
                            }}
                          >
                            <option value="" disabled>Selecionar status…</option>
                            {columns.filter(destination => destination.status !== column.status).map(destination => (
                              <option key={destination.status} value={destination.status}>Para {destination.label}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    );
                  })}

                  {column.cards.length === 0 && (
                    <div className="column-empty">Nenhum atendimento</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
