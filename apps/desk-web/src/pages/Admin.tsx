import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, EmptyState, ErrorState, Icon, LoadingState, TextField, type IconName } from '../components/ui';
import { useModalFocus } from '../hooks/useModalFocus';
import {
  api,
  deadLetterApi,
  webhookSecurityApi,
  type DeadLetterEntry,
  type DeadLetterStats,
  type DeadLetterOperationalSummary,
  type WebhookSecurityStats,
} from '../lib/api';
import './Admin.css';

interface User { id: string; name: string; email: string; isActive: boolean; createdAt: string; }
interface Role { id: string; name: string; description: string | null; }
interface Queue { id: string; name: string; description: string | null; isActive: boolean; }
interface Team { id: string; name: string; description: string | null; isActive: boolean; }
interface Sector { id: string; name: string; code: string; icon: string; color: string; }
interface UserSector { sectorId: string; sectorName: string; sectorIcon: string; sectorColor: string; accessLevel: string; }

type Tab = 'users' | 'roles' | 'queues' | 'teams' | 'dead-letters';
type CreateTab = Exclude<Tab, 'dead-letters'>;
type DeadLetterFilter = 'all' | 'open' | 'resolved';
type ResourceKey = 'users' | 'roles' | 'queues' | 'teams' | 'sectors' | 'deadLetters' | 'deadLetterSummary' | 'webhookStats';

interface ActionFeedback { tone: 'success' | 'error'; message: string; }
interface LoadFailure { title: string; message: string; retryable: boolean; }
interface CreateErrors { name?: string; email?: string; password?: string; }

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

const createNouns: Record<CreateTab, string> = {
  users: 'Usuário',
  roles: 'Papel',
  queues: 'Fila',
  teams: 'Time',
};
const createdMessages: Record<CreateTab, string> = {
  users: 'Usuário criado.',
  roles: 'Papel criado.',
  queues: 'Fila criada.',
  teams: 'Time criado.',
};
const deletedMessages: Record<CreateTab, string> = {
  users: 'Usuário excluído.',
  roles: 'Papel excluído.',
  queues: 'Fila excluída.',
  teams: 'Time excluído.',
};

const resourceLabels: Record<ResourceKey, string> = {
  users: 'usuários',
  roles: 'papéis',
  queues: 'filas',
  teams: 'times',
  sectors: 'setores',
  deadLetters: 'dead-letters',
  deadLetterSummary: 'resumo de dead-letters',
  webhookStats: 'segurança de webhooks',
};

function loadFailureFrom(error: unknown, resource: string): LoadFailure {
  const status = (error as { status?: number } | null)?.status ?? 0;
  const raw = error instanceof Error ? error.message.trim() : '';
  if (status === 403) {
    return { title: 'Acesso negado', message: `Você não tem permissão para acessar ${resource}.`, retryable: false };
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

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', {
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
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [failures, setFailures] = useState<Partial<Record<ResourceKey, LoadFailure>>>({});
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newItem, setNewItem] = useState<Record<string, string>>({});
  const [createErrors, setCreateErrors] = useState<CreateErrors>({});
  const [createError, setCreateError] = useState<string | null>(null);
  const [savingCreate, setSavingCreate] = useState(false);
  const [deadLetterFilter, setDeadLetterFilter] = useState<DeadLetterFilter>('all');
  const [deadLetterSearch, setDeadLetterSearch] = useState('');
  const [selectedDeadLetterId, setSelectedDeadLetterId] = useState<string | null>(null);
  const [deadLetterActionId, setDeadLetterActionId] = useState<string | null>(null);
  const [deadLetterNotice, setDeadLetterNotice] = useState<string | null>(null);
  const [deadLetterError, setDeadLetterError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string; tab: CreateTab } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [editUserSectors, setEditUserSectors] = useState<string | null>(null);
  const [userSectors, setUserSectors] = useState<UserSector[]>([]);
  const [userSectorsLoading, setUserSectorsLoading] = useState(false);
  const [userSectorsError, setUserSectorsError] = useState<LoadFailure | null>(null);
  const [selectedSectors, setSelectedSectors] = useState<Record<string, string>>({});
  const [initialGrantedCount, setInitialGrantedCount] = useState(0);
  const [permissionFeedback, setPermissionFeedback] = useState<ActionFeedback | null>(null);
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  const sectorDialog = useModalFocus(!!editUserSectors, () => { if (!savingPermissions) setEditUserSectors(null); });
  const confirmDialog = useModalFocus(!!confirmDelete, () => { if (!deleting) setConfirmDelete(null); });

  const tabs: { key: Tab; label: string; icon: IconName; description: string }[] = [
    {
      key: 'users',
      label: 'Usuários',
      icon: 'contacts',
      description: 'Pessoas que acessam o sistema (atendentes, veterinários, recepcionistas). Cada usuário tem login, senha e permissões específicas por setor.',
    },
    {
      key: 'roles',
      label: 'Papéis',
      icon: 'settings',
      description: 'Grupos de permissões pré-definidos (ex: Admin, Veterinário, Recepcionista). Ao atribuir um papel a um usuário, ele ganha todas as permissões daquele papel automaticamente.',
    },
    {
      key: 'queues',
      label: 'Filas',
      icon: 'tasks',
      description: 'Fila de espera para distribuir atendimentos. Ex: quando chega uma mensagem, ela pode ser direcionada para a "Fila Recepção" e depois para a "Fila Clínica". Útil para organizar o fluxo de trabalho.',
    },
    {
      key: 'teams',
      label: 'Times',
      icon: 'sectors',
      description: 'Grupos de usuários que trabalham juntos. Ex: "Equipe Clínica" (Dr. João + Dra. Maria), "Equipe Recepção" (Ana + Pedro). Facilita a atribuição de conversas para grupos.',
    },
    {
      key: 'dead-letters',
      label: 'Dead-letter',
      icon: 'warning',
      description: 'Fila operacional de eventos que falharam após retry. Permite filtrar, inspecionar o payload e executar retry quando o backend tiver contexto suficiente, ou marcar como resolvida após tratamento manual.',
    },
  ];

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      api.get<User[]>('/admin/users'),
      api.get<Role[]>('/admin/roles'),
      api.get<Queue[]>('/admin/queues'),
      api.get<Team[]>('/admin/teams'),
      api.get<Sector[]>('/sectors?all=true'),
      deadLetterApi.list({ limit: 100 }),
      deadLetterApi.stats(),
      webhookSecurityApi.stats(),
    ]);
    const nextFailures: Partial<Record<ResourceKey, LoadFailure>> = {};

    const [u, r, q, t, s, dl, dlSummary, webhookStats] = results;
    if (u.status === 'fulfilled') setUsers(u.value); else nextFailures.users = loadFailureFrom(u.reason, resourceLabels.users);
    if (r.status === 'fulfilled') setRoles(r.value); else nextFailures.roles = loadFailureFrom(r.reason, resourceLabels.roles);
    if (q.status === 'fulfilled') setQueues(q.value); else nextFailures.queues = loadFailureFrom(q.reason, resourceLabels.queues);
    if (t.status === 'fulfilled') setTeams(t.value); else nextFailures.teams = loadFailureFrom(t.reason, resourceLabels.teams);
    if (s.status === 'fulfilled') setSectors(s.value); else nextFailures.sectors = loadFailureFrom(s.reason, resourceLabels.sectors);
    if (dl.status === 'fulfilled') {
      setDeadLetters(dl.value.data);
      setDeadLetterStats(dl.value.stats);
    } else {
      nextFailures.deadLetters = loadFailureFrom(dl.reason, resourceLabels.deadLetters);
    }
    if (dlSummary.status === 'fulfilled') setDeadLetterSummary(dlSummary.value); else nextFailures.deadLetterSummary = loadFailureFrom(dlSummary.reason, resourceLabels.deadLetterSummary);
    if (webhookStats.status === 'fulfilled') setWebhookSecurityStats(webhookStats.value); else nextFailures.webhookStats = loadFailureFrom(webhookStats.reason, resourceLabels.webhookStats);

    setFailures(nextFailures);
    setLoadedOnce(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const fetchUserSectors = useCallback(async (userId: string) => {
    setUserSectorsLoading(true);
    setUserSectorsError(null);
    try {
      const data = await api.get<UserSector[]>(`/admin/users/${userId}/sectors`);
      setUserSectors(data);
      const sel: Record<string, string> = {};
      data.forEach((sector) => {
        sel[sector.sectorId] = sector.accessLevel;
      });
      setSelectedSectors(sel);
      setInitialGrantedCount(data.length);
      setConfirmWipe(false);
    } catch (error) {
      setUserSectorsError(loadFailureFrom(error, 'permissões do usuário'));
    } finally {
      setUserSectorsLoading(false);
    }
  }, []);

  const openSectorDialog = (user: User, trigger?: HTMLElement) => {
    sectorDialog.rememberTrigger(trigger);
    setEditUserSectors(user.id);
    setUserSectors([]);
    setSelectedSectors({});
    setInitialGrantedCount(0);
    setPermissionFeedback(null);
    setConfirmWipe(false);
    void fetchUserSectors(user.id);
  };

  const closeSectorDialog = () => {
    if (savingPermissions) return;
    setEditUserSectors(null);
    setPermissionFeedback(null);
    setConfirmWipe(false);
  };

  const switchTab = (next: Tab) => {
    setTab(next);
    setShowCreate(false);
    setNewItem({});
    setCreateErrors({});
    setCreateError(null);
    setFeedback(null);
    setDeadLetterNotice(null);
    setDeadLetterError(null);
  };

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const { key } = event;
    if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'Home' && key !== 'End') return;
    event.preventDefault();
    const lastIndex = tabs.length - 1;
    const nextIndex = key === 'Home'
      ? 0
      : key === 'End'
        ? lastIndex
        : (index + (key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    switchTab(next.key);
    requestAnimationFrame(() => document.getElementById(`admin-tab-${next.key}`)?.focus());
  };

  useEffect(() => {
    if (!editUserSectors) return;
    setPermissionFeedback(null);
  }, [editUserSectors]);

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
  const deadLetterListFailure = failures.deadLetters;
  const userSectorOptions = sectors.filter((sector) => !!selectedSectors[sector.id]);
  const isWipingPermissions = userSectorOptions.length === 0 && initialGrantedCount > 0;

  const validateCreate = (): CreateErrors => {
    const errors: CreateErrors = {};
    if (!(newItem.name || '').trim()) {
      errors.name = tab === 'users' ? 'Informe o nome do usuário.' : 'Informe o nome.';
    }
    if (tab === 'users') {
      const email = (newItem.email || '').trim();
      if (!email) errors.email = 'Informe o e-mail do usuário.';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Informe um e-mail válido.';
      if (!(newItem.password || '')) errors.password = 'Informe a senha inicial.';
      else if ((newItem.password || '').length < 6) errors.password = 'A senha deve ter pelo menos 6 caracteres.';
    }
    return errors;
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingCreate || tab === 'dead-letters') return;
    const errors = validateCreate();
    if (errors.name || errors.email || errors.password) {
      setCreateErrors(errors);
      setCreateError(null);
      (errors.name ? nameInputRef : errors.email ? emailInputRef : passwordInputRef).current?.focus();
      return;
    }

    setSavingCreate(true);
    setCreateError(null);
    try {
      await api.post(`/admin/${tab}`, { ...newItem, name: (newItem.name || '').trim(), email: (newItem.email || '').trim() });
      setFeedback({ tone: 'success', message: createdMessages[tab] });
      setNewItem({});
      setCreateErrors({});
      setShowCreate(false);
      await fetchAll();
    } catch (error) {
      setCreateError(messageFromError(error));
    } finally {
      setSavingCreate(false);
    }
  };

  const requestDelete = (id: string, label: string, targetTab: CreateTab, trigger?: HTMLElement) => {
    confirmDialog.rememberTrigger(trigger);
    setDeleteError(null);
    setConfirmDelete({ id, label, tab: targetTab });
  };

  const handleDeleteConfirmed = async () => {
    if (!confirmDelete || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.delete(`/admin/${confirmDelete.tab}/${confirmDelete.id}`);
      setFeedback({ tone: 'success', message: deletedMessages[confirmDelete.tab] });
      setConfirmDelete(null);
      await fetchAll();
    } catch (error) {
      setDeleteError(messageFromError(error));
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveUserSectors = async () => {
    if (!editUserSectors || savingPermissions) return;

    const sectorList = Object.entries(selectedSectors)
      .filter(([, level]) => level)
      .map(([sectorId, accessLevel]) => ({ sectorId, accessLevel }));

    if (sectorList.length === 0 && initialGrantedCount > 0 && !confirmWipe) {
      setConfirmWipe(true);
      setPermissionFeedback({ tone: 'error', message: 'Você está removendo todos os acessos deste usuário. Confirme a revogação total para salvar.' });
      return;
    }

    setSavingPermissions(true);
    setPermissionFeedback(null);
    try {
      await api.put(`/admin/users/${editUserSectors}/sectors`, { sectors: sectorList });
      setPermissionFeedback({ tone: 'success', message: sectorList.length ? `Permissões salvas para ${sectorList.length} setor${sectorList.length > 1 ? 'es' : ''}.` : 'Acessos revogados.' });
      setConfirmWipe(false);
      await fetchUserSectors(editUserSectors);
    } catch (error) {
      setPermissionFeedback({ tone: 'error', message: messageFromError(error) });
    } finally {
      setSavingPermissions(false);
    }
  };

  const toggleSector = (sectorId: string) => {
    setConfirmWipe(false);
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
    } catch (error) {
      setDeadLetterError(messageFromError(error) || 'Falha ao executar ação');
    } finally {
      setDeadLetterActionId(null);
    }
  };

  const clearDeadLetterFilters = () => {
    setDeadLetterFilter('all');
    setDeadLetterSearch('');
  };

  const renderCreateFields = () => {
    switch (tab) {
      case 'users':
        return (
          <>
            <TextField
              ref={nameInputRef}
              label="Nome do usuário *"
              maxLength={200}
              value={newItem.name || ''}
              error={createErrors.name}
              disabled={savingCreate}
              onChange={(e) => { setNewItem({ ...newItem, name: e.target.value }); setCreateErrors((current) => ({ ...current, name: undefined })); }}
            />
            <TextField
              ref={emailInputRef}
              label="E-mail do usuário *"
              type="email"
              maxLength={320}
              value={newItem.email || ''}
              error={createErrors.email}
              disabled={savingCreate}
              onChange={(e) => { setNewItem({ ...newItem, email: e.target.value }); setCreateErrors((current) => ({ ...current, email: undefined })); }}
            />
            <TextField
              ref={passwordInputRef}
              label="Senha inicial *"
              type="password"
              value={newItem.password || ''}
              error={createErrors.password}
              disabled={savingCreate}
              onChange={(e) => { setNewItem({ ...newItem, password: e.target.value }); setCreateErrors((current) => ({ ...current, password: undefined })); }}
            />
          </>
        );
      case 'roles':
        return (
          <>
            <TextField
              ref={nameInputRef}
              label="Nome do papel *"
              maxLength={200}
              value={newItem.name || ''}
              error={createErrors.name}
              disabled={savingCreate}
              onChange={(e) => { setNewItem({ ...newItem, name: e.target.value }); setCreateErrors((current) => ({ ...current, name: undefined })); }}
            />
            <TextField
              label="Descrição do papel"
              value={newItem.description || ''}
              disabled={savingCreate}
              onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
            />
          </>
        );
      case 'queues':
        return (
          <>
            <TextField
              ref={nameInputRef}
              label="Nome da fila *"
              maxLength={200}
              value={newItem.name || ''}
              error={createErrors.name}
              disabled={savingCreate}
              onChange={(e) => { setNewItem({ ...newItem, name: e.target.value }); setCreateErrors((current) => ({ ...current, name: undefined })); }}
            />
            <TextField
              label="Descrição da fila"
              value={newItem.description || ''}
              disabled={savingCreate}
              onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
            />
          </>
        );
      case 'teams':
        return (
          <>
            <TextField
              ref={nameInputRef}
              label="Nome do time *"
              maxLength={200}
              value={newItem.name || ''}
              error={createErrors.name}
              disabled={savingCreate}
              onChange={(e) => { setNewItem({ ...newItem, name: e.target.value }); setCreateErrors((current) => ({ ...current, name: undefined })); }}
            />
            <TextField
              label="Descrição do time"
              value={newItem.description || ''}
              disabled={savingCreate}
              onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
            />
          </>
        );
      default:
        return null;
    }
  };

  const renderListFailure = (failure: LoadFailure | undefined) => {
    if (!failure) return null;
    return (
      <ErrorState
        title={failure.title}
        message={failure.message}
        onRetry={failure.retryable ? () => { void fetchAll(); } : undefined}
      />
    );
  };

  const renderUsersTable = () => {
    if (failures.users && users.length === 0) return renderListFailure(failures.users);
    if (loading && !loadedOnce) return <LoadingState label="Carregando usuários…" />;
    if (users.length === 0) {
      return (
        <EmptyState
          title="Nenhum usuário cadastrado"
          description="Crie o primeiro acesso para começar."
          icon="contacts"
          action={<Button icon="plus" size="sm" onClick={() => { setShowCreate(true); setCreateError(null); }}>Novo usuário</Button>}
        />
      );
    }
    return (
      <>
        {failures.users && (
          <div className="ui-alert ui-alert--warning" role="alert">
            <Icon name="warning" size={18} />
            <span>{failures.users.title}: {failures.users.message}</span>
            {failures.users.retryable && <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void fetchAll(); }}>Tentar novamente</Button>}
          </div>
        )}
        <div className="admin-table-scroll" role="region" tabIndex={0} aria-label="Tabela de usuários; deslize horizontalmente para ver todas as colunas">
          <table className="data-table">
            <thead>
              <tr><th>Nome</th><th>Email</th><th>Status</th><th>Criado</th><th>Setores</th><th>Ações</th></tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td><strong>{user.name}</strong></td>
                  <td className="mono">{user.email}</td>
                  <td><Badge tone={user.isActive ? 'success' : 'neutral'} status>{user.isActive ? 'Ativo' : 'Inativo'}</Badge></td>
                  <td>{formatDate(user.createdAt)}</td>
                  <td>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="sectors"
                      onClick={(event) => openSectorDialog(user, event.currentTarget)}
                    >
                      Setores
                    </Button>
                  </td>
                  <td>
                    <Button
                      variant="secondary"
                      size="icon"
                      icon="close"
                      aria-label={`Excluir usuário ${user.name}`}
                      onClick={(event) => requestDelete(user.id, user.name, 'users', event.currentTarget)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  const renderSimpleTable = (
    key: 'roles' | 'queues' | 'teams',
    columns: string[],
    rows: Array<{ id: string; cells: React.ReactNode[]; label: string }>,
  ) => {
    if (failures[key] && rows.length === 0) return renderListFailure(failures[key]);
    if (loading && !loadedOnce) return <LoadingState label={`Carregando ${resourceLabels[key]}…`} />;
    if (rows.length === 0) {
      return (
        <EmptyState
          title={`Nenhum registro em ${resourceLabels[key]}`}
          description="Crie o primeiro registro para começar."
          icon={key === 'roles' ? 'settings' : key === 'queues' ? 'tasks' : 'sectors'}
          action={<Button icon="plus" size="sm" onClick={() => { setShowCreate(true); setCreateError(null); }}>Criar</Button>}
        />
      );
    }
    return (
      <>
        {failures[key] && (
          <div className="ui-alert ui-alert--warning" role="alert">
            <Icon name="warning" size={18} />
            <span>{failures[key]?.title}: {failures[key]?.message}</span>
            {failures[key]?.retryable && <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void fetchAll(); }}>Tentar novamente</Button>}
          </div>
        )}
        <div className="admin-table-scroll" role="region" tabIndex={0} aria-label={`Tabela de ${resourceLabels[key]}; deslize horizontalmente para ver todas as colunas`}>
          <table className="data-table">
            <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {row.cells.map((cell, index) => <td key={index}>{cell}</td>)}
                  <td>
                    <Button
                      variant="secondary"
                      size="icon"
                      icon="close"
                      aria-label={`Excluir ${row.label}`}
                      onClick={(event) => requestDelete(row.id, row.label, key, event.currentTarget)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  const renderRolesTable = () => renderSimpleTable('roles', ['Nome', 'Descrição', 'Ações'], roles.map((role) => ({
    id: role.id,
    label: role.name,
    cells: [<strong key="name">{role.name}</strong>, role.description || '—'],
  })));

  const renderQueuesTable = () => renderSimpleTable('queues', ['Nome', 'Descrição', 'Status', 'Ações'], queues.map((queue) => ({
    id: queue.id,
    label: queue.name,
    cells: [
      <strong key="name">{queue.name}</strong>,
      queue.description || '—',
      <Badge key="status" tone={queue.isActive ? 'success' : 'neutral'} status>{queue.isActive ? 'Ativa' : 'Inativa'}</Badge>,
    ],
  })));

  const renderTeamsTable = () => renderSimpleTable('teams', ['Nome', 'Descrição', 'Status', 'Ações'], teams.map((team) => ({
    id: team.id,
    label: team.name,
    cells: [
      <strong key="name">{team.name}</strong>,
      team.description || '—',
      <Badge key="status" tone={team.isActive ? 'success' : 'neutral'} status>{team.isActive ? 'Ativo' : 'Inativo'}</Badge>,
    ],
  })));

  const renderObservabilitySummary = () => (
    <>
      <section className="observability-card">
        <div className="section-header">
          <h4>Dead-letter operacionais</h4>
          <p>Resumo rápido para triagem sem abrir cada item.</p>
        </div>

        {failures.deadLetterSummary ? (
          <div className="ui-alert ui-alert--warning" role="alert">
            <Icon name="warning" size={18} />
            <span>{failures.deadLetterSummary.title}: {failures.deadLetterSummary.message}</span>
            {failures.deadLetterSummary.retryable && <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void fetchAll(); }}>Tentar novamente</Button>}
          </div>
        ) : (
          <>
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
              <div className="stat-card stat-card--text">
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
          </>
        )}
      </section>

      <section className="observability-card">
        <div className="section-header">
          <h4>Webhook security</h4>
          <p>Bloqueios e permissões por reason operacional.</p>
        </div>

        {failures.webhookStats ? (
          <div className="ui-alert ui-alert--warning" role="alert">
            <Icon name="warning" size={18} />
            <span>{failures.webhookStats.title}: {failures.webhookStats.message}</span>
            {failures.webhookStats.retryable && <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void fetchAll(); }}>Tentar novamente</Button>}
          </div>
        ) : (
          <>
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
              <div className="stat-card stat-card--text">
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
          </>
        )}
      </section>
    </>
  );

  const renderDeadLetters = () => (
    <div className="dead-letter-panel">
      <div className="observability-panels">
        {renderObservabilitySummary()}
      </div>

      {deadLetterListFailure && deadLetters.length === 0 ? (
        <ErrorState
          title={deadLetterListFailure.title}
          message={deadLetterListFailure.message}
          onRetry={deadLetterListFailure.retryable ? () => { void fetchAll(); } : undefined}
        />
      ) : (
        <>
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
            <label className="ui-field dead-letter-toolbar__field">
              <span className="ui-field__label">Filtrar dead-letters</span>
              <select value={deadLetterFilter} onChange={(event) => setDeadLetterFilter(event.target.value as DeadLetterFilter)}>
                <option value="all">Todas</option>
                <option value="open">Abertas</option>
                <option value="resolved">Resolvidas</option>
              </select>
            </label>
            <label className="ui-field dead-letter-toolbar__field dead-letter-toolbar__search">
              <span className="ui-field__label">Pesquisar dead-letters</span>
              <input
                placeholder="Filtrar por evento, handler, erro ou ID"
                value={deadLetterSearch}
                onChange={(event) => setDeadLetterSearch(event.target.value)}
              />
            </label>
            <Button variant="secondary" icon="refresh" onClick={() => { void fetchAll(); }} disabled={loading}>Recarregar</Button>
          </div>

          {deadLetterNotice && (
            <div className="ui-alert ui-alert--success" role="status">
              <Icon name="check" size={18} />
              <span>{deadLetterNotice}</span>
            </div>
          )}
          {deadLetterError && (
            <div className="ui-alert" role="alert">
              <Icon name="warning" size={18} />
              <span>{deadLetterError}</span>
            </div>
          )}
          {failures.deadLetters && deadLetters.length > 0 && (
            <div className="ui-alert ui-alert--warning" role="alert">
              <Icon name="warning" size={18} />
              <span>{failures.deadLetters.title}: {failures.deadLetters.message}</span>
              {failures.deadLetters.retryable && <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void fetchAll(); }}>Tentar novamente</Button>}
            </div>
          )}

          <p className="dead-letter-count" role="status">
            {filteredDeadLetters.length} de {deadLetters.length} dead-letter{deadLetters.length === 1 ? '' : 's'} exibida{filteredDeadLetters.length === 1 ? '' : 's'}
          </p>

          {filteredDeadLetters.length === 0 ? (
            <EmptyState
              title="Nenhuma dead-letter encontrada"
              description="Nenhum registro corresponde ao filtro aplicado."
              icon="check"
              action={<Button variant="secondary" size="sm" onClick={clearDeadLetterFilters}>Limpar filtros</Button>}
            />
          ) : (
            <div className="admin-table-scroll" role="region" tabIndex={0} aria-label="Tabela de dead-letters; deslize horizontalmente para ver todas as colunas">
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
                        <Badge tone={entry.resolved ? 'success' : 'warning'} status>{entry.resolved ? 'Resolvida' : 'Aberta'}</Badge>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="dead-letter-select"
                          aria-pressed={selectedDeadLetter?.id === entry.id}
                          onClick={(event) => { event.stopPropagation(); setSelectedDeadLetterId(entry.id); }}
                        >
                          <strong>{entry.eventType}</strong>
                        </button>
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
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={!entry.sourceEvent || entry.resolved}
                            loading={deadLetterActionId === entry.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleDeadLetterAction(entry, 'retry');
                            }}
                          >
                            Retry
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={entry.resolved}
                            loading={deadLetterActionId === entry.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleDeadLetterAction(entry, 'resolve');
                            }}
                          >
                            Marcar resolvida
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="dead-letter-detail">
            {selectedDeadLetter ? (
              <>
                <div className="detail-header">
                  <div>
                    <h4>{selectedDeadLetter.eventType}</h4>
                    <p>{selectedDeadLetter.id}</p>
                  </div>
                  <Badge tone={selectedDeadLetter.resolved ? 'success' : 'warning'} status>
                    {selectedDeadLetter.resolved ? 'Resolvida' : 'Aberta'}
                  </Badge>
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
              <EmptyState
                title="Nenhuma dead-letter disponível"
                description="Quando um evento falhar após os retries, ele aparece aqui para triagem."
                icon="check"
              />
            )}
          </div>
        </>
      )}
    </div>
  );

  const currentTab = tabs.find((item) => item.key === tab);

  return (
    <div className="admin-page">
      <div className="page-hero">
        <div className="hero-left">
          <span className="page-kicker">Governança operacional</span>
          <h1><Icon name="admin" /> Administração</h1>
          <p>Gerencie usuários, papéis, filas, times e dead-letters</p>
        </div>
        {tab !== 'dead-letters' && (
          <Button
            icon={showCreate ? 'close' : 'plus'}
            onClick={() => { setShowCreate(!showCreate); setNewItem({}); setCreateErrors({}); setCreateError(null); }}
          >
            {showCreate ? 'Cancelar' : `Novo${tab === 'users' ? ' usuário' : tab === 'roles' ? ' papel' : tab === 'queues' ? ' fila' : ' time'}`}
          </Button>
        )}
      </div>

      {loading && loadedOnce && (
        <div className="admin-updating" role="status"><span className="ui-spinner" aria-hidden="true" /> Atualizando dados…</div>
      )}

      {feedback && (
        <div className={`ui-alert ${feedback.tone === 'success' ? 'ui-alert--success' : ''}`} role={feedback.tone === 'success' ? 'status' : 'alert'}>
          <Icon name={feedback.tone === 'success' ? 'check' : 'warning'} size={18} />
          <span>{feedback.message}</span>
        </div>
      )}

      <div className="admin-tabs" role="group" aria-label="Seções de administração">
        {tabs.map((item, index) => (
          <div key={item.key} className="tab-wrapper">
            <button
              id={`admin-tab-${item.key}`}
              type="button"
              aria-pressed={tab === item.key}
              aria-controls={tab === item.key ? `admin-panel-${item.key}` : undefined}
              className={`admin-tab ${tab === item.key ? 'active' : ''}`}
              onClick={() => switchTab(item.key)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              onMouseEnter={() => setHoveredTab(item.key)}
              onMouseLeave={() => setHoveredTab(null)}
              onFocus={() => setHoveredTab(item.key)}
              onBlur={() => setHoveredTab(null)}
            >
              <Icon name={item.icon} size={16} /> {item.label}
              <span className="tab-info-icon" aria-hidden="true">ⓘ</span>
            </button>
            {hoveredTab === item.key && (
              <div className="tab-tooltip" aria-hidden="true">
                <div className="tooltip-title"><Icon name={item.icon} size={15} /> {item.label}</div>
                <div className="tooltip-desc">{item.description}</div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="tab-description">
        {currentTab && <Icon name={currentTab.icon} size={16} />} <strong>{currentTab?.label}:</strong> {currentTab?.description}
      </div>

      <section
        id={`admin-panel-${tab}`}
        aria-labelledby={`admin-tab-${tab}`}
        tabIndex={0}
        className="admin-panel"
      >
        {showCreate && tab !== 'dead-letters' && (
          <form className="create-panel" onSubmit={handleCreate} noValidate>
            {createError && (
              <div className="ui-alert" role="alert">
                <Icon name="warning" size={18} />
                <span>{createError}</span>
              </div>
            )}
            {renderCreateFields()}
            <Button type="submit" loading={savingCreate}>{savingCreate ? 'Criando…' : 'Criar'}</Button>
          </form>
        )}

        {loading && !loadedOnce ? (
          <LoadingState label="Carregando dados administrativos…" />
        ) : (
          <>
            {tab === 'users' && renderUsersTable()}
            {tab === 'roles' && renderRolesTable()}
            {tab === 'queues' && renderQueuesTable()}
            {tab === 'teams' && renderTeamsTable()}
            {tab === 'dead-letters' && renderDeadLetters()}
          </>
        )}
      </section>

      {confirmDelete && (
        <div className="admin-modal-overlay" role="presentation" onMouseDown={() => { if (!deleting) setConfirmDelete(null); }}>
          <div
            ref={confirmDialog.dialogRef}
            className="admin-modal admin-modal--confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-delete-title"
            aria-describedby="confirm-delete-description"
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="admin-modal__header">
              <h3 id="confirm-delete-title">Excluir {createNouns[confirmDelete.tab].toLowerCase()}</h3>
            </div>
            <div className="admin-modal__body">
              <p id="confirm-delete-description">
                Tem certeza que deseja excluir <strong>{confirmDelete.label}</strong>? Esta ação não pode ser desfeita.
              </p>
              {deleteError && (
                <div className="ui-alert" role="alert">
                  <Icon name="warning" size={18} />
                  <span>{deleteError}</span>
                </div>
              )}
              <div className="admin-modal__actions">
                <Button variant="secondary" disabled={deleting} onClick={() => setConfirmDelete(null)}>Cancelar</Button>
                <Button variant="danger" loading={deleting} onClick={() => { void handleDeleteConfirmed(); }}>
                  {deleting ? 'Excluindo…' : 'Excluir'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editUserSectors && (
        <div className="admin-modal-overlay" role="presentation" onMouseDown={closeSectorDialog}>
          <div
            ref={sectorDialog.dialogRef}
            className="admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sector-permissions-title"
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="admin-modal__header">
              <h3 id="sector-permissions-title"><Icon name="sectors" size={19} /> Permissões por setor</h3>
              <Button variant="ghost" size="icon" icon="close" aria-label="Fechar permissões por setor" disabled={savingPermissions} onClick={closeSectorDialog} />
            </div>
            <div className="admin-modal__body">
              <p className="admin-modal__description">Selecione os setores que este usuário pode acessar e o nível de permissão:</p>

              {userSectorsLoading && userSectors.length === 0 ? (
                <LoadingState label="Carregando permissões…" />
              ) : userSectorsError ? (
                <ErrorState
                  title={userSectorsError.title}
                  message={userSectorsError.message}
                  onRetry={userSectorsError.retryable ? () => { void fetchUserSectors(editUserSectors); } : undefined}
                />
              ) : sectors.length === 0 ? (
                <EmptyState title="Nenhum setor disponível" description="Cadastre setores antes de definir permissões." icon="sectors" />
              ) : (
                <div className="sectors-permission-grid">
                  {sectors.map((sector) => {
                    const isSelected = !!selectedSectors[sector.id];
                    const level = selectedSectors[sector.id] || 'read';

                    return (
                      <div key={sector.id} className={`sector-perm-card ${isSelected ? 'selected' : ''}`}>
                        <div className="sector-perm-header">
                          <label className="sector-checkbox">
                            <input
                              aria-label={`Permitir acesso ao setor ${sector.name}`}
                              type="checkbox"
                              checked={isSelected}
                              disabled={savingPermissions}
                              onChange={() => toggleSector(sector.id)}
                            />
                            <span className="sector-icon" aria-hidden="true" style={{ background: sector.color }}>{sector.icon}</span>
                            <span className="sector-name">{sector.name}</span>
                          </label>
                        </div>

                        {isSelected && (
                          <div className="access-level-select">
                            <label className="ui-field">
                              <span className="ui-field__label">Nível de acesso em {sector.name}</span>
                              <select
                                value={level}
                                disabled={savingPermissions}
                                onChange={(event) => changeAccessLevel(sector.id, event.target.value)}
                              >
                                <option value="read">Somente leitura</option><option value="write">Leitura e escrita</option><option value="admin">Admin do setor</option>
                              </select>
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {permissionFeedback && (
                <div className={`ui-alert ${permissionFeedback.tone === 'success' ? 'ui-alert--success' : ''}`} role={permissionFeedback.tone === 'success' ? 'status' : 'alert'}>
                  <Icon name={permissionFeedback.tone === 'success' ? 'check' : 'warning'} size={18} />
                  <span>{permissionFeedback.message}</span>
                </div>
              )}

              <div className="admin-modal__actions">
                <Button variant="secondary" disabled={savingPermissions} onClick={closeSectorDialog}>Cancelar</Button>
                <Button
                  loading={savingPermissions}
                  disabled={!!userSectorsError}
                  onClick={() => { void handleSaveUserSectors(); }}
                >
                  {savingPermissions
                    ? 'Salvando…'
                    : isWipingPermissions
                      ? 'Confirmar revogação total'
                      : 'Salvar permissões'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
