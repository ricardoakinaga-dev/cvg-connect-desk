import { useEffect, useMemo, useState } from 'react';
import {
  api,
  deadLetterApi,
  getErrorMessage,
  webhookSecurityApi,
  operationalMetricsApi,
  type DeadLetterEntry,
  type DeadLetterStats,
  type DeadLetterOperationalSummary,
  type WebhookSecurityStats,
  type OperationalMetrics,
} from '../lib/api';
import './Admin.css';

interface User { id: string; name: string; email: string; isActive: boolean; createdAt: string; }
interface Role { id: string; name: string; description: string | null; }
interface Queue { id: string; name: string; description: string | null; isActive: boolean; }
interface Team { id: string; name: string; description: string | null; isActive: boolean; }
interface Sector { id: string; name: string; code: string; icon: string; color: string; }
interface UserSector { sectorId: string; sectorName: string; sectorIcon: string; sectorColor: string; accessLevel: string; }

type Tab = 'users' | 'roles' | 'queues' | 'teams' | 'dead-letters';
type DeadLetterFilter = 'all' | 'open' | 'resolved';

const emptyDeadLetterStats: DeadLetterStats = { total: 0, unresolved: 0, resolved: 0 };
const emptyDeadLetterOperationalSummary: DeadLetterOperationalSummary = {
  total: 0,
  unresolved: 0,
  resolved: 0,
  replayable: 0,
  manualOnly: 0,
  byHandler: [],
  byReason: [],
  lastFailedAt: null,
};
const emptyWebhookSecurityStats: WebhookSecurityStats = {
  total: 0,
  allowed: 0,
  denied: 0,
  byReason: {
    missing_secret: 0,
    missing_signature: 0,
    invalid_signature_format: 0,
    invalid_signature: 0,
    signature_valid: 0,
  },
  lastDecisionAt: null,
  lastDecision: null,
};
const emptyOperationalMetrics: OperationalMetrics = {
  generatedAt: '',
  outbox: { pending: 0, retrying: 0, oldestCreatedAt: null, oldestAgeMs: 0 },
  deadLetter: { unresolved: 0, retrying: 0, oldestFailedAt: null, oldestAgeMs: 0 },
  thresholds: { outboxPending: 100, deadLetterUnresolved: 10, triggered: [] },
};

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function deadLetterReplayLabel(entry: DeadLetterEntry) {
  return entry.sourceEvent ? 'Replayável' : 'Sem replay';
}

function deadLetterFailureSummary(entry: DeadLetterEntry) {
  const context = entry.failureContext;
  if (!context) return 'Sem contexto estruturado';
  return `${context.stage} • ${context.decision} • ${context.reason}`;
}

function formatCountList(
  items: Array<{ label: string; value: number }>,
  emptyLabel: string,
) {
  if (items.length === 0) {
    return <span className="detail-value">{emptyLabel}</span>;
  }

  return (
    <ul className="mini-metrics">
      {items.map((item) => (
        <li key={item.label}>
          <strong>{item.value}</strong>
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

export function Admin() {
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [deadLetters, setDeadLetters] = useState<DeadLetterEntry[]>([]);
  const [deadLetterStats, setDeadLetterStats] = useState<DeadLetterStats>(emptyDeadLetterStats);
  const [deadLetterSummary, setDeadLetterSummary] = useState<DeadLetterOperationalSummary>(emptyDeadLetterOperationalSummary);
  const [webhookSecurityStats, setWebhookSecurityStats] = useState<WebhookSecurityStats>(emptyWebhookSecurityStats);
  const [operationalMetrics, setOperationalMetrics] = useState<OperationalMetrics>(emptyOperationalMetrics);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newItem, setNewItem] = useState<Record<string, string>>({});
  const [deadLetterFilter, setDeadLetterFilter] = useState<DeadLetterFilter>('all');
  const [deadLetterSearch, setDeadLetterSearch] = useState('');
  const [selectedDeadLetterId, setSelectedDeadLetterId] = useState<string | null>(null);
  const [deadLetterActionId, setDeadLetterActionId] = useState<string | null>(null);
  const [deadLetterNotice, setDeadLetterNotice] = useState<string | null>(null);
  const [deadLetterError, setDeadLetterError] = useState<string | null>(null);

  const [editUserSectors, setEditUserSectors] = useState<string | null>(null);
  const [, setUserSectors] = useState<UserSector[]>([]);
  const [selectedSectors, setSelectedSectors] = useState<Record<string, string>>({});
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [u, r, q, t, s, dl, dlSummary, webhookStats, operations] = await Promise.all([
        api.get<User[]>('/admin/users').catch(() => []),
        api.get<Role[]>('/admin/roles').catch(() => []),
        api.get<Queue[]>('/admin/queues').catch(() => []),
        api.get<Team[]>('/admin/teams').catch(() => []),
        api.get<Sector[]>('/sectors?all=true').catch(() => []),
        deadLetterApi.list({ limit: 100 }).catch(() => ({ data: [], stats: emptyDeadLetterStats })),
        deadLetterApi.stats().catch(() => emptyDeadLetterOperationalSummary),
        webhookSecurityApi.stats().catch(() => emptyWebhookSecurityStats),
        operationalMetricsApi.get().catch(() => emptyOperationalMetrics),
      ]);

      setUsers(u);
      setRoles(r);
      setQueues(q);
      setTeams(t);
      setSectors(s);
      setDeadLetters(dl.data);
      setDeadLetterStats(dl.stats);
      setDeadLetterSummary(dlSummary);
      setWebhookSecurityStats(webhookStats);
      setOperationalMetrics(operations);
    } catch (error) {
      console.error('Erro ao carregar admin:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUserSectors = async (userId: string) => {
    try {
      const data = await api.get<UserSector[]>(`/admin/users/${userId}/sectors`);
      setUserSectors(data);
      const sel: Record<string, string> = {};
      data.forEach((sector) => {
        sel[sector.sectorId] = sector.accessLevel;
      });
      setSelectedSectors(sel);
    } catch {
      setUserSectors([]);
      setSelectedSectors({});
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const selectedDeadLetter = useMemo(
    () => deadLetters.find((entry) => entry.id === selectedDeadLetterId) || deadLetters[0] || null,
    [deadLetters, selectedDeadLetterId],
  );

  const filteredDeadLetters = useMemo(() => {
    const search = deadLetterSearch.trim().toLowerCase();
    return deadLetters.filter((entry) => {
      if (deadLetterFilter === 'open' && entry.resolved) return false;
      if (deadLetterFilter === 'resolved' && !entry.resolved) return false;

      if (!search) return true;

      const haystack = [
        entry.eventType,
        entry.eventId,
        entry.handlerName,
        entry.error,
        entry.id,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(search);
    });
  }, [deadLetterFilter, deadLetterSearch, deadLetters]);

  const replayableCount = deadLetters.filter((entry) => !entry.resolved && !!entry.sourceEvent).length;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await api.post(`/admin/${tab}`, newItem);
      setNewItem({});
      setShowCreate(false);
      fetchAll();
    } catch (error: unknown) {
      alert(getErrorMessage(error));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza?')) return;

    try {
      await api.delete(`/admin/${tab}/${id}`);
      fetchAll();
    } catch (error: unknown) {
      alert(getErrorMessage(error));
    }
  };

  const handleSaveUserSectors = async () => {
    if (!editUserSectors) return;

    const sectorList = Object.entries(selectedSectors)
      .filter(([, level]) => level)
      .map(([sectorId, accessLevel]) => ({ sectorId, accessLevel }));

    try {
      await api.put(`/admin/users/${editUserSectors}/sectors`, { sectors: sectorList });
      alert('Permissões salvas!');
      fetchUserSectors(editUserSectors);
    } catch (error: unknown) {
      alert(getErrorMessage(error));
    }
  };

  const toggleSector = (sectorId: string) => {
    setSelectedSectors((prev) => {
      const next = { ...prev };
      if (next[sectorId]) {
        delete next[sectorId];
      } else {
        next[sectorId] = 'read';
      }
      return next;
    });
  };

  const changeAccessLevel = (sectorId: string, level: string) => {
    setSelectedSectors((prev) => ({ ...prev, [sectorId]: level }));
  };

  const handleDeadLetterAction = async (entry: DeadLetterEntry, action: 'retry' | 'resolve') => {
    setDeadLetterActionId(entry.id);
    setDeadLetterNotice(null);
    setDeadLetterError(null);

    try {
      if (action === 'retry') {
        const result = await deadLetterApi.retry(entry.id);
        setDeadLetterNotice(result.replayed
          ? 'Dead-letter reenviada para o outbox e marcada como resolvida.'
          : 'Dead-letter tratada, mas sem replay automático.');
      } else {
        await deadLetterApi.resolve(entry.id);
        setDeadLetterNotice('Dead-letter marcada como resolvida.');
      }

      await fetchAll();
      setSelectedDeadLetterId(entry.id);
    } catch (error: unknown) {
      setDeadLetterError(getErrorMessage(error, 'Falha ao executar ação'));
    } finally {
      setDeadLetterActionId(null);
    }
  };

  const renderCreateForm = () => {
    switch (tab) {
      case 'users':
        return (
          <>
            <input placeholder="Nome" value={newItem.name || ''} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} required />
            <input placeholder="Email" type="email" value={newItem.email || ''} onChange={(e) => setNewItem({ ...newItem, email: e.target.value })} required />
            <input placeholder="Senha" type="password" value={newItem.password || ''} onChange={(e) => setNewItem({ ...newItem, password: e.target.value })} required />
          </>
        );
      case 'roles':
        return (
          <>
            <input placeholder="Nome do papel" value={newItem.name || ''} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} required />
            <input placeholder="Descrição" value={newItem.description || ''} onChange={(e) => setNewItem({ ...newItem, description: e.target.value })} />
          </>
        );
      case 'queues':
        return (
          <>
            <input placeholder="Nome da fila" value={newItem.name || ''} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} required />
            <input placeholder="Descrição" value={newItem.description || ''} onChange={(e) => setNewItem({ ...newItem, description: e.target.value })} />
          </>
        );
      case 'teams':
        return (
          <>
            <input placeholder="Nome do time" value={newItem.name || ''} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} required />
            <input placeholder="Descrição" value={newItem.description || ''} onChange={(e) => setNewItem({ ...newItem, description: e.target.value })} />
          </>
        );
      default:
        return null;
    }
  };

  const renderUsersTable = () => (
    <>
      <table className="data-table">
        <thead>
          <tr><th>Nome</th><th>Email</th><th>Status</th><th>Criado</th><th>Setores</th><th>Ações</th></tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td><strong>{user.name}</strong></td>
              <td className="mono">{user.email}</td>
              <td><span className={`badge ${user.isActive ? 'active' : 'inactive'}`}>{user.isActive ? 'Ativo' : 'Inativo'}</span></td>
              <td>{formatDate(user.createdAt)}</td>
              <td>
                <button className="btn-sector" onClick={() => { setEditUserSectors(user.id); fetchUserSectors(user.id); }}>
                  Setores
                </button>
              </td>
              <td><button className="btn-delete-sm" onClick={() => handleDelete(user.id)}>DEL</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      {editUserSectors && (
        <div className="modal-overlay" onClick={() => setEditUserSectors(null)}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Permissões por Setor</h3>
              <button className="btn-close" onClick={() => setEditUserSectors(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="modal-desc">Selecione os setores que este usuário pode acessar e o nível de permissão:</p>

              <div className="sectors-permission-grid">
                {sectors.map((sector) => {
                  const isSelected = !!selectedSectors[sector.id];
                  const level = selectedSectors[sector.id] || 'read';

                  return (
                    <div key={sector.id} className={`sector-perm-card ${isSelected ? 'selected' : ''}`}>
                      <div className="sector-perm-header">
                        <label className="sector-checkbox">
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSector(sector.id)} />
                          <span className="sector-icon" style={{ background: sector.color }}>{sector.icon}</span>
                          <span className="sector-name">{sector.name}</span>
                        </label>
                      </div>

                      {isSelected && (
                        <div className="access-level-select">
                          <select value={level} onChange={(event) => changeAccessLevel(sector.id, event.target.value)}>
                            <option value="read">Somente Leitura</option>
                            <option value="write">Leitura e Escrita</option>
                            <option value="admin">Admin do Setor</option>
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="modal-actions">
                <button className="btn-cancel" onClick={() => setEditUserSectors(null)}>Cancelar</button>
                <button className="btn-save" onClick={handleSaveUserSectors}>Salvar Permissões</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );

  const renderDeadLetters = () => (
    <div className="dead-letter-panel">
      <div className="observability-panels">
        <section className="observability-card">
          <div className="section-header">
            <h4>Dead-letter operacionais</h4>
            <p>Resumo rápido para triagem sem abrir cada item.</p>
          </div>

          <div className="dead-letter-stats">
            <div className="stat-card">
              <span className="stat-label">Total</span>
              <strong>{deadLetterSummary.total}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Replayáveis</span>
              <strong>{deadLetterSummary.replayable}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Manuais</span>
              <strong>{deadLetterSummary.manualOnly}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Última falha</span>
              <strong>{formatDate(deadLetterSummary.lastFailedAt)}</strong>
            </div>
          </div>

          <div className="detail-grid observability-mini-grid">
            <div>
              <span className="detail-label">Handlers com falha</span>
              {formatCountList(
                deadLetterSummary.byHandler.map((item) => ({
                  label: `${item.handlerName} (${item.unresolved} abertas)`,
                  value: item.total,
                })),
                'Sem falhas registradas',
              )}
            </div>
            <div>
              <span className="detail-label">Principais motivos</span>
              {formatCountList(
                deadLetterSummary.byReason.map((item) => ({
                  label: item.reason,
                  value: item.total,
                })),
                'Sem motivos registrados',
              )}
            </div>
          </div>
        </section>

        <section className="observability-card">
          <div className="section-header">
            <h4>Webhook security</h4>
            <p>Bloqueios e permissões por reason operacional.</p>
          </div>

          <div className="dead-letter-stats">
            <div className="stat-card">
              <span className="stat-label">Total</span>
              <strong>{webhookSecurityStats.total}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Permitidos</span>
              <strong>{webhookSecurityStats.allowed}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Bloqueados</span>
              <strong>{webhookSecurityStats.denied}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Última decisão</span>
              <strong>{formatDate(webhookSecurityStats.lastDecisionAt)}</strong>
            </div>
          </div>

          <div className="detail-grid observability-mini-grid">
            <div>
              <span className="detail-label">Reasons registrados</span>
              {formatCountList(
                (Object.entries(webhookSecurityStats.byReason) as Array<[string, number]>)
                  .filter(([, value]) => value > 0)
                  .map(([label, value]) => ({ label, value })),
                'Sem bloqueios de webhook',
              )}
            </div>
            <div>
              <span className="detail-label">Última decisão</span>
              <strong>{webhookSecurityStats.lastDecision ? `${webhookSecurityStats.lastDecision.reason} • ${webhookSecurityStats.lastDecision.allowed ? 'permitido' : 'bloqueado'}` : 'Sem eventos'}</strong>
            </div>
          </div>
        </section>

        <section className="observability-card">
          <div className="section-header">
            <h4>Backlog compartilhado</h4>
            <p>Fonte PostgreSQL comum a todas as réplicas.</p>
          </div>
          <div className="dead-letter-stats">
            <div className="stat-card">
              <span className="stat-label">Outbox pendente</span>
              <strong>{operationalMetrics.outbox.pending}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Outbox retry</span>
              <strong>{operationalMetrics.outbox.retrying}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">DLQ aberta</span>
              <strong>{operationalMetrics.deadLetter.unresolved}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Alertas ativos</span>
              <strong>{operationalMetrics.thresholds.triggered.length}</strong>
            </div>
          </div>
        </section>
      </div>

      <div className="dead-letter-stats">
        <div className="stat-card">
          <span className="stat-label">Total</span>
          <strong>{deadLetterStats.total}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Abertas</span>
          <strong>{deadLetterStats.unresolved}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Resolvidas</span>
          <strong>{deadLetterStats.resolved}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Replayáveis</span>
          <strong>{replayableCount}</strong>
        </div>
      </div>

      <div className="dead-letter-toolbar">
        <select value={deadLetterFilter} onChange={(event) => setDeadLetterFilter(event.target.value as DeadLetterFilter)}>
          <option value="all">Todas</option>
          <option value="open">Abertas</option>
          <option value="resolved">Resolvidas</option>
        </select>
        <input
          placeholder="Filtrar por evento, handler, erro ou ID"
          value={deadLetterSearch}
          onChange={(event) => setDeadLetterSearch(event.target.value)}
        />
        <button className="btn-secondary" onClick={() => fetchAll()}>Recarregar</button>
      </div>

      {deadLetterNotice && <div className="dead-letter-banner success">{deadLetterNotice}</div>}
      {deadLetterError && <div className="dead-letter-banner error">{deadLetterError}</div>}

      <table className="data-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Evento</th>
            <th>Handler</th>
            <th>Erro</th>
            <th>Retry</th>
            <th>Falha em</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {filteredDeadLetters.map((entry) => (
            <tr
              key={entry.id}
              className={selectedDeadLetter?.id === entry.id ? 'row-selected' : ''}
              onClick={() => setSelectedDeadLetterId(entry.id)}
            >
              <td>
                <span className={`badge ${entry.resolved ? 'active' : 'inactive'}`}>
                  {entry.resolved ? 'Resolvida' : 'Aberta'}
                </span>
              </td>
              <td>
                <strong>{entry.eventType}</strong>
                <div className="table-subtext mono">{entry.eventId}</div>
              </td>
              <td>{entry.handlerName}</td>
              <td className="dead-letter-error-cell">{entry.error}</td>
              <td>
                <span className="mono">{entry.retryCount}</span>
                <div className="table-subtext">{deadLetterReplayLabel(entry)}</div>
              </td>
              <td>{formatDate(entry.failedAt)}</td>
              <td>
                <div className="table-actions">
                  <button
                    className="btn-secondary-sm"
                    disabled={!entry.sourceEvent || entry.resolved || deadLetterActionId === entry.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDeadLetterAction(entry, 'retry');
                    }}
                  >
                    {deadLetterActionId === entry.id ? '...' : 'Retry'}
                  </button>
                  <button
                    className="btn-secondary-sm"
                    disabled={entry.resolved || deadLetterActionId === entry.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDeadLetterAction(entry, 'resolve');
                    }}
                  >
                    Marcar resolvida
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="dead-letter-detail">
        {selectedDeadLetter ? (
          <>
            <div className="detail-header">
              <div>
                <h4>{selectedDeadLetter.eventType}</h4>
                <p>{selectedDeadLetter.id}</p>
              </div>
              <span className={`badge ${selectedDeadLetter.resolved ? 'active' : 'inactive'}`}>
                {selectedDeadLetter.resolved ? 'Resolvida' : 'Aberta'}
              </span>
            </div>

            <div className="detail-grid">
              <div>
                <span className="detail-label">Handler</span>
                <strong>{selectedDeadLetter.handlerName}</strong>
              </div>
              <div>
                <span className="detail-label">Erro</span>
                <strong>{selectedDeadLetter.error}</strong>
              </div>
              <div>
                <span className="detail-label">Retry count</span>
                <strong>{selectedDeadLetter.retryCount}</strong>
              </div>
              <div>
                <span className="detail-label">Falha em</span>
                <strong>{formatDate(selectedDeadLetter.failedAt)}</strong>
              </div>
              <div>
                <span className="detail-label">Resolved at</span>
                <strong>{formatDate(selectedDeadLetter.resolvedAt)}</strong>
              </div>
              <div>
                <span className="detail-label">Replay</span>
                <strong>{selectedDeadLetter.sourceEvent ? 'Disponível' : 'Indisponível'}</strong>
              </div>
              <div>
                <span className="detail-label">Contexto</span>
                <strong>{deadLetterFailureSummary(selectedDeadLetter)}</strong>
              </div>
            </div>

            <div className="detail-json-grid">
              <section>
                <h5>Payload</h5>
                <pre>{safeJson(selectedDeadLetter.payload)}</pre>
              </section>
              <section>
                <h5>Source event</h5>
                <pre>{safeJson(selectedDeadLetter.sourceEvent || { note: 'Replay automático não disponível para esta entrada.' })}</pre>
              </section>
              <section>
                <h5>Failure context</h5>
                <pre>{safeJson(selectedDeadLetter.failureContext || { note: 'Contexto estruturado indisponível.' })}</pre>
              </section>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <p>Nenhuma dead-letter disponível.</p>
          </div>
        )}
      </div>
    </div>
  );

  const tabs: { key: Tab; label: string; icon: string; description: string }[] = [
    {
      key: 'users',
      label: 'Usuários',
      icon: 'US',
      description: 'Pessoas que acessam o sistema (atendentes, veterinários, recepcionistas). Cada usuário tem login, senha e permissões específicas por setor.',
    },
    {
      key: 'roles',
      label: 'Papéis',
      icon: 'AC',
      description: 'Grupos de permissões pré-definidos (ex: Admin, Veterinário, Recepcionista). Ao atribuir um papel a um usuário, ele ganha todas as permissões daquele papel automaticamente.',
    },
    {
      key: 'queues',
      label: 'Filas',
      icon: 'FL',
      description: 'Fila de espera para distribuir atendimentos. Ex: quando chega uma mensagem, ela pode ser direcionada para a "Fila Recepção" e depois para a "Fila Clínica". Útil para organizar o fluxo de trabalho.',
    },
    {
      key: 'teams',
      label: 'Times',
      icon: 'TM',
      description: 'Grupos de usuários que trabalham juntos. Ex: "Equipe Clínica" (Dr. João + Dra. Maria), "Equipe Recepção" (Ana + Pedro). Facilita a atribuição de conversas para grupos.',
    },
    {
      key: 'dead-letters',
      label: 'Dead-letter',
      icon: 'DL',
      description: 'Fila operacional de eventos que falharam após retry. Permite filtrar, inspecionar o payload e executar retry quando o backend tiver contexto suficiente, ou marcar como resolvida após tratamento manual.',
    },
  ];

  const currentTab = tabs.find((item) => item.key === tab);

  return (
    <div className="admin-page">
      <div className="page-hero">
        <div className="hero-left">
          <h2>Administração</h2>
          <p>Gerencie usuários, papéis, filas, times e dead-letters</p>
        </div>
        {tab !== 'dead-letters' && (
          <button className="btn-create" onClick={() => { setShowCreate(!showCreate); setNewItem({}); }}>
            {showCreate ? '✕ Cancelar' : `＋ Novo${tab === 'users' ? ' Usuário' : tab === 'roles' ? ' Papel' : tab === 'queues' ? ' Fila' : ' Time'}`}
          </button>
        )}
      </div>

      <div className="admin-tabs">
        {tabs.map((item) => (
          <div key={item.key} className="tab-wrapper">
            <button
              className={`admin-tab ${tab === item.key ? 'active' : ''}`}
              onClick={() => {
                setTab(item.key);
                setShowCreate(false);
                if (item.key !== 'dead-letters') {
                  setDeadLetterNotice(null);
                  setDeadLetterError(null);
                }
              }}
              onMouseEnter={() => setHoveredTab(item.key)}
              onMouseLeave={() => setHoveredTab(null)}
            >
              {item.icon} {item.label}
              <span className="tab-info-icon">ⓘ</span>
            </button>
            {hoveredTab === item.key && (
              <div className="tab-tooltip">
                <div className="tooltip-title">{item.icon} {item.label}</div>
                <div className="tooltip-desc">{item.description}</div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="tab-description">
        {currentTab?.icon} <strong>{currentTab?.label}:</strong> {currentTab?.description}
      </div>

      {showCreate && tab !== 'dead-letters' && (
        <form className="create-panel" onSubmit={handleCreate}>
          {renderCreateForm()}
          <button type="submit" className="btn-create">Criar</button>
        </form>
      )}

      {loading ? (
        <div className="loading-state"><div className="spinner" /> Carregando...</div>
      ) : (
        <>
          {tab === 'users' && renderUsersTable()}
          {tab === 'roles' && (
            <table className="data-table">
              <thead><tr><th>Nome</th><th>Descrição</th><th>Ações</th></tr></thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.id}>
                    <td><strong>{role.name}</strong></td>
                    <td>{role.description || '—'}</td>
                    <td><button className="btn-delete-sm" onClick={() => handleDelete(role.id)}>DEL</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'queues' && (
            <table className="data-table">
              <thead><tr><th>Nome</th><th>Descrição</th><th>Status</th><th>Ações</th></tr></thead>
              <tbody>
                {queues.map((queue) => (
                  <tr key={queue.id}>
                    <td><strong>{queue.name}</strong></td>
                    <td>{queue.description || '—'}</td>
                    <td><span className={`badge ${queue.isActive ? 'active' : 'inactive'}`}>{queue.isActive ? 'Ativa' : 'Inativa'}</span></td>
                    <td><button className="btn-delete-sm" onClick={() => handleDelete(queue.id)}>DEL</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'teams' && (
            <table className="data-table">
              <thead><tr><th>Nome</th><th>Descrição</th><th>Status</th><th>Ações</th></tr></thead>
              <tbody>
                {teams.map((team) => (
                  <tr key={team.id}>
                    <td><strong>{team.name}</strong></td>
                    <td>{team.description || '—'}</td>
                    <td><span className={`badge ${team.isActive ? 'active' : 'inactive'}`}>{team.isActive ? 'Ativo' : 'Inativo'}</span></td>
                    <td><button className="btn-delete-sm" onClick={() => handleDelete(team.id)}>DEL</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'dead-letters' && renderDeadLetters()}
        </>
      )}
    </div>
  );
}
