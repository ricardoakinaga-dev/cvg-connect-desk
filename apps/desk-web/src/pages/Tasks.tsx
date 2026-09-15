import { useCallback, useEffect, useRef, useState } from 'react';
import { api, taskApi, type Conversation, type Patient, type Task, type Tutor } from '../lib/api';
import { useAuthStore } from '../store/auth';
import { useConversationContext } from '../hooks/useConversationContext';
import { Link } from 'react-router-dom';
import { Badge, Button, EmptyState, ErrorState, Icon, LoadingState, TextField, type BadgeTone, type IconName } from '../components/ui';
import './Tasks.css';

type TaskRecord = Task & {
  tutorId?: string | null;
  patientId?: string | null;
};

type TaskStatusUpdatePayload = {
  status: Task['status'];
  /** CAS fornecido pelo contrato HTTP atual de tarefas. */
  expectedStatus: Task['status'];
};

type TaskCreatePayload = {
  title: string;
  description?: string;
  conversationId?: string;
  tutorId?: string;
  patientId?: string;
  priority?: Task['priority'];
  assignedTo?: string;
  dueAt?: string;
};

interface NewTaskForm extends TaskCreatePayload {
  description: string;
  conversationId: string;
  tutorId: string;
  patientId: string;
  assignedTo: string;
  dueAt: string;
  priority: Task['priority'];
  status: Task['status'];
}

interface ConversationListResponse {
  conversations?: Conversation[];
  items?: Conversation[];
}

interface LoadFailure {
  title: string;
  message: string;
  retryable: boolean;
}

interface TaskReferences {
  conversations: Array<Conversation & { contactName?: string | null; contactPhone?: string | null }>;
  tutors: Tutor[];
  patients: Patient[];
}

const emptyReferences: TaskReferences = { conversations: [], tutors: [], patients: [] };
const emptyTask: NewTaskForm = {
  title: '',
  description: '',
  conversationId: '',
  tutorId: '',
  patientId: '',
  assignedTo: '',
  dueAt: '',
  priority: 'medium',
  status: 'pending',
};

function loadFailureFrom(error: unknown, fallback = 'Não foi possível carregar os dados necessários.'): LoadFailure {
  const status = (error as { status?: number } | null)?.status ?? 0;
  const raw = error instanceof Error ? error.message : '';
  if (status === 403) {
    return { title: 'Acesso negado', message: 'Você não tem permissão para ver as tarefas.', retryable: false };
  }
  if (status === 401) {
    return { title: 'Sessão expirada', message: 'Entre novamente para continuar.', retryable: false };
  }
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (!status && (offline || /failed to fetch|network|sem conexão/i.test(raw))) {
    return { title: 'Sem conexão', message: 'Não foi possível alcançar o servidor. Verifique sua conexão e tente novamente.', retryable: true };
  }
  return { title: 'Não foi possível carregar', message: raw || fallback, retryable: true };
}

function messageFromError(error: unknown): string {
  const status = (error as { status?: number } | null)?.status ?? 0;
  const raw = error instanceof Error ? error.message.trim() : '';
  if (status === 409) return 'A tarefa mudou em outra sessão. Atualize a lista e tente novamente.';
  return raw || 'Não foi possível concluir a operação.';
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function conversationsFrom(value: unknown): TaskReferences['conversations'] {
  if (Array.isArray(value)) return value as TaskReferences['conversations'];
  const response = value as ConversationListResponse | null | undefined;
  return asArray<Conversation & { contactName?: string | null; contactPhone?: string | null }>(response?.items ?? response?.conversations);
}

const priorityConfig: Record<Task['priority'], { label: string; tone: BadgeTone }> = {
  urgent: { label: 'Urgente', tone: 'error' },
  high: { label: 'Alta', tone: 'warning' },
  medium: { label: 'Média', tone: 'info' },
  low: { label: 'Baixa', tone: 'neutral' },
};

const statusConfig: Record<Task['status'], { label: string; tone: BadgeTone; icon: IconName }> = {
  pending: { label: 'Pendente', tone: 'warning', icon: 'clock' },
  in_progress: { label: 'Em andamento', tone: 'info', icon: 'activity' },
  completed: { label: 'Concluída', tone: 'success', icon: 'check' },
  cancelled: { label: 'Cancelada', tone: 'neutral', icon: 'close' },
};

const statusFilters = [
  { key: '', label: 'Todas' },
  { key: 'pending', label: 'Pendente' },
  { key: 'in_progress', label: 'Em andamento' },
  { key: 'completed', label: 'Concluída' },
  { key: 'cancelled', label: 'Cancelada' },
];

const priorityFilters = [
  { key: '', label: 'Todas' },
  { key: 'urgent', label: 'Urgente' },
  { key: 'high', label: 'Alta' },
  { key: 'medium', label: 'Média' },
  { key: 'low', label: 'Baixa' },
];

const taskStatuses: Task['status'][] = ['pending', 'in_progress', 'completed', 'cancelled'];
const taskPriorities: Task['priority'][] = ['low', 'medium', 'high', 'urgent'];

const createTaskWithContract = taskApi.create as unknown as (data: TaskCreatePayload) => Promise<TaskRecord>;
const updateTaskStatusWithCas = taskApi.updateStatus as unknown as (id: string, data: TaskStatusUpdatePayload) => Promise<unknown>;

export function Tasks() {
  const { user } = useAuthStore();
  const conversationContext = useConversationContext();
  const contextConversationId = conversationContext.conversationId;
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [references, setReferences] = useState<TaskReferences>(emptyReferences);
  const [loading, setLoading] = useState(true);
  const [referencesLoading, setReferencesLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadFailure | null>(null);
  const [referenceError, setReferenceError] = useState<LoadFailure | null>(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newTask, setNewTask] = useState<NewTaskForm>(emptyTask);
  const [formErrors, setFormErrors] = useState<{ title?: string; reference?: string }>({});
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState<{ id: string; status: Task['status'] } | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [retryStatuses, setRetryStatuses] = useState<Record<string, Task['status']>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const fetchTasks = useCallback(async () => {
    if (conversationContext.invalid) {
      setTasks([]);
      setLoadError({
        title: 'Contexto inválido',
        message: 'O identificador de conversa no link não é válido. Remova o filtro para ver todas as tarefas.',
        retryable: false,
      });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await taskApi.list(contextConversationId ? { conversationId: contextConversationId } : undefined);
      setTasks(Array.isArray(data) ? data as TaskRecord[] : []);
      setLoadError(null);
    } catch (err) {
      const status = (err as { status?: number } | null)?.status ?? 0;
      if (status === 404 && contextConversationId) {
        setTasks([]);
        setLoadError({
          title: 'Contexto inacessível',
          message: 'A conversa deste link não está disponível para o seu acesso. Remova o filtro para ver todas as tarefas.',
          retryable: false,
        });
      } else {
        setLoadError(loadFailureFrom(err, 'O servidor não respondeu como esperado.'));
      }
    } finally {
      setLoading(false);
    }
  }, [contextConversationId, conversationContext.invalid]);

  const fetchReferences = useCallback(async () => {
    setReferencesLoading(true);
    const results = await Promise.allSettled([
      api.get<ConversationListResponse>('/conversations?limit=100'),
      api.get<Tutor[]>('/tutors'),
      api.get<Patient[]>('/patients'),
    ]);
    const [conversationResult, tutorResult, patientResult] = results;
    setReferences({
      conversations: conversationResult.status === 'fulfilled' ? conversationsFrom(conversationResult.value) : [],
      tutors: tutorResult.status === 'fulfilled' ? asArray<Tutor>(tutorResult.value) : [],
      patients: patientResult.status === 'fulfilled' ? asArray<Patient>(patientResult.value) : [],
    });
    const failed = results.find(result => result.status === 'rejected');
    setReferenceError(failed && failed.status === 'rejected'
      ? loadFailureFrom(failed.reason, 'Alguns vínculos não puderam ser carregados.')
      : null);
    setReferencesLoading(false);
  }, []);

  useEffect(() => {
    void fetchTasks();
    void fetchReferences();
  }, [fetchReferences, fetchTasks]);

  // C04: o contexto da URL preenche o vínculo de criação sem exigir digitação.
  useEffect(() => {
    if (!contextConversationId) return;
    setNewTask(current => (current.conversationId === contextConversationId
      ? current
      : { ...current, conversationId: contextConversationId }));
  }, [contextConversationId]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const openCreate = () => {
    setFormErrors({});
    setCreateError(null);
    setShowCreate(true);
  };

  const closeCreate = () => {
    if (saving) return;
    setShowCreate(false);
    setCreateError(null);
    setFormErrors({});
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const errors: { title?: string; reference?: string } = {};
    if (!newTask.title.trim()) errors.title = 'Informe o título da tarefa.';
    if (errors.title) {
      setFormErrors(errors);
      setCreateError(null);
      titleRef.current?.focus();
      return;
    }

    const payload: TaskCreatePayload = {
      title: newTask.title.trim(),
      description: newTask.description.trim() || undefined,
      conversationId: newTask.conversationId || undefined,
      tutorId: newTask.tutorId || undefined,
      patientId: newTask.patientId || undefined,
      assignedTo: newTask.assignedTo || undefined,
      priority: newTask.priority,
      dueAt: newTask.dueAt ? new Date(newTask.dueAt).toISOString() : undefined,
    };

    setSaving(true);
    setCreateError(null);
    setFormErrors({});
    try {
      const created = await createTaskWithContract(payload);
      if (newTask.status !== 'pending') {
        if (!created?.id) {
          throw new Error('A API não retornou o identificador da tarefa para aplicar o status inicial.');
        }
        await updateTaskStatusWithCas(created.id, { status: newTask.status, expectedStatus: 'pending' });
      }
      setNewTask(emptyTask);
      setShowCreate(false);
      setFeedback('Tarefa criada.');
      await fetchTasks();
    } catch (err) {
      setCreateError(messageFromError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (task: TaskRecord, status: Task['status']) => {
    if (updating || status === task.status) return;
    setUpdating({ id: task.id, status });
    setActionErrors(current => {
      if (!current[task.id]) return current;
      const next = { ...current };
      delete next[task.id];
      return next;
    });
    setRetryStatuses(current => {
      if (!(task.id in current)) return current;
      const next = { ...current };
      delete next[task.id];
      return next;
    });
    try {
      await updateTaskStatusWithCas(task.id, { status, expectedStatus: task.status });
      setFeedback(`Tarefa “${task.title}” movida para ${statusConfig[status].label}.`);
      await fetchTasks();
    } catch (err) {
      setActionErrors(current => ({ ...current, [task.id]: messageFromError(err) }));
      setRetryStatuses(current => ({ ...current, [task.id]: status }));
    } finally {
      setUpdating(null);
    }
  };

  const isOverdue = (task: TaskRecord) => Boolean(task.dueAt)
    && new Date(task.dueAt as string) < new Date()
    && task.status !== 'completed'
    && task.status !== 'cancelled';

  const timeUntil = (dateValue: string) => {
    const diff = new Date(dateValue).getTime() - Date.now();
    if (diff < 0) return 'Vencida';
    const hours = Math.floor(diff / 3600000);
    if (hours < 24) return `${hours}h restantes`;
    return `${Math.floor(hours / 24)}d restantes`;
  };

  const conversationLabel = (conversationId: string) => {
    const conversation = references.conversations.find(item => item.id === conversationId);
    if (!conversation) return 'Conversa vinculada';
    if (conversation.contactName) return conversation.contactName;
    return `Conversa ${statusConfigForConversation(conversation.status)}`;
  };

  const tutorLabel = (tutorId: string) => references.tutors.find(tutor => tutor.id === tutorId)?.name || 'Tutor vinculado';
  const patientLabel = (patientId: string) => references.patients.find(patient => patient.id === patientId)?.name || 'Paciente vinculado';
  const assigneeLabel = (assignedTo: string) => assignedTo === user?.id ? (user.name || 'Você') : 'Responsável atribuído';

  const stats = {
    total: tasks.length,
    pending: tasks.filter(task => task.status === 'pending').length,
    inProgress: tasks.filter(task => task.status === 'in_progress').length,
    completed: tasks.filter(task => task.status === 'completed').length,
    overdue: tasks.filter(task => isOverdue(task)).length,
  };

  // A09/SA-037: a fila prioriza o que exige ação — vencidas primeiro, depois
  // urgência e prazo — sem depender de rolagem até o conteúdo útil.
  const priorityRank: Record<Task['priority'], number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  const terminal = new Set<Task['status']>(['completed', 'cancelled']);
  const filtered = tasks
    .filter(task =>
      (!filterStatus || task.status === filterStatus) && (!filterPriority || task.priority === filterPriority),
    )
    .slice()
    .sort((a, b) => {
      const aTerminal = terminal.has(a.status) ? 1 : 0;
      const bTerminal = terminal.has(b.status) ? 1 : 0;
      if (aTerminal !== bTerminal) return aTerminal - bTerminal;
      const aOverdue = isOverdue(a) ? 0 : 1;
      const bOverdue = isOverdue(b) ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      const priority = priorityRank[a.priority] - priorityRank[b.priority];
      if (priority !== 0) return priority;
      const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
      const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
      return aDue - bDue;
    });

  return (
    <div className="tasks-page" aria-busy={loading || undefined}>
      <div className="page-hero">
        <div className="hero-left">
          <span className="page-kicker">Fluxo de trabalho</span>
          <h1><Icon name="tasks" /> Tarefas</h1>
          <p>Crie, vincule e acompanhe tarefas com contexto operacional.</p>
        </div>
        <Button icon={showCreate ? 'close' : 'plus'} onClick={() => (showCreate ? closeCreate() : openCreate())}>
          {showCreate ? 'Cancelar' : 'Nova tarefa'}
        </Button>
      </div>

      {feedback && (
        <div className="ui-alert ui-alert--success tasks-feedback" role="status" aria-live="polite">
          <Icon name="check" size={18} />
          <span>{feedback}</span>
        </div>
      )}

      {conversationContext.rawValue && (
        <div className={`context-banner${conversationContext.invalid ? ' context-banner--error' : ''}`} role="status" aria-live="polite">
          <Icon name="inbox" size={18} />
          <span>
            {conversationContext.invalid
              ? 'O link trouxe um identificador de conversa inválido.'
              : 'Mostrando apenas as tarefas da conversa selecionada.'}
          </span>
          <Link className="context-banner__link" to={`/inbox?conversation=${encodeURIComponent(conversationContext.rawValue)}`}>Voltar à conversa</Link>
          <button type="button" className="context-banner__clear" onClick={conversationContext.clear}>Remover filtro</button>
        </div>
      )}

      {!loading && !loadError && (
        <div className="stats-row" role="group" aria-label="Resumo das tarefas">
          <div className="stat-card"><span className="stat-num">{stats.total}</span><span className="stat-label">Total</span></div>
          <div className="stat-card pending"><span className="stat-num">{stats.pending}</span><span className="stat-label">Pendentes</span></div>
          <div className="stat-card progress"><span className="stat-num">{stats.inProgress}</span><span className="stat-label">Em andamento</span></div>
          <div className="stat-card done"><span className="stat-num">{stats.completed}</span><span className="stat-label">Concluídas</span></div>
          {stats.overdue > 0 && <div className="stat-card overdue"><span className="stat-num">{stats.overdue}</span><span className="stat-label">Vencidas</span></div>}
        </div>
      )}

      {showCreate && (
        <form className="create-panel" onSubmit={handleCreate} noValidate>
          <div className="create-panel__heading">
            <div><span className="section-kicker">Nova atividade</span><h2>Detalhes da tarefa</h2></div>
            <span className="create-panel__hint">Os vínculos usam nomes; os identificadores ficam no contrato.</span>
          </div>
          {createError && <div className="ui-alert" role="alert"><Icon name="warning" size={18} /><span>Não foi possível salvar a tarefa: {createError}. Os dados digitados foram mantidos.</span></div>}
          {referenceError && (
            <div className="ui-alert task-reference-warning" role="alert">
              <Icon name="warning" size={18} />
              <span>{referenceError.message} Você ainda pode salvar sem vínculo.</span>
              {referenceError.retryable && <Button type="button" variant="secondary" size="sm" icon="refresh" onClick={() => void fetchReferences()}>Recarregar vínculos</Button>}
            </div>
          )}
          <TextField
            ref={titleRef}
            label="Título *"
            value={newTask.title}
            error={formErrors.title}
            onChange={event => {
              setNewTask({ ...newTask, title: event.target.value });
              setFormErrors(current => ({ ...current, title: undefined }));
            }}
          />
          <div className="ui-field">
            <label className="ui-field__label" htmlFor="task-description">Descrição (opcional)</label>
            <textarea id="task-description" className="ui-input task-textarea" rows={2} value={newTask.description} onChange={event => setNewTask({ ...newTask, description: event.target.value })} />
          </div>

          <fieldset className="task-context-fields">
            <legend>Vínculos da operação</legend>
            <div className="task-form-grid">
              <div className="ui-field">
                <label className="ui-field__label" htmlFor="task-conversation">Conversa</label>
                <select id="task-conversation" className="ui-input" value={newTask.conversationId} onChange={event => setNewTask({ ...newTask, conversationId: event.target.value })}>
                  <option value="">Sem conversa vinculada</option>
                  {referencesLoading && <option disabled>Carregando conversas…</option>}
                  {references.conversations.map(conversation => <option key={conversation.id} value={conversation.id}>{conversationLabel(conversation.id)}</option>)}
                </select>
              </div>
              <div className="ui-field">
                <label className="ui-field__label" htmlFor="task-tutor">Tutor</label>
                <select id="task-tutor" className="ui-input" value={newTask.tutorId} onChange={event => setNewTask({ ...newTask, tutorId: event.target.value })}>
                  <option value="">Sem tutor vinculado</option>
                  {referencesLoading && <option disabled>Carregando tutores…</option>}
                  {references.tutors.map(tutor => <option key={tutor.id} value={tutor.id}>{tutor.name}</option>)}
                </select>
              </div>
              <div className="ui-field">
                <label className="ui-field__label" htmlFor="task-patient">Paciente</label>
                <select id="task-patient" className="ui-input" value={newTask.patientId} onChange={event => setNewTask({ ...newTask, patientId: event.target.value })}>
                  <option value="">Sem paciente vinculado</option>
                  {referencesLoading && <option disabled>Carregando pacientes…</option>}
                  {references.patients.map(patient => <option key={patient.id} value={patient.id}>{patient.name}</option>)}
                </select>
              </div>
            </div>
            {formErrors.reference && <p className="ui-field__error" role="alert">{formErrors.reference}</p>}
          </fieldset>

          <div className="task-form-grid task-form-grid--properties">
            <div className="ui-field">
              <label className="ui-field__label" htmlFor="task-assignee">Responsável</label>
              <select id="task-assignee" className="ui-input" value={newTask.assignedTo} onChange={event => setNewTask({ ...newTask, assignedTo: event.target.value })}>
                <option value="">Sem responsável</option>
                {user && <option value={user.id}>{user.name || 'Você'} (você)</option>}
              </select>
            </div>
            <div className="ui-field"><label className="ui-field__label" htmlFor="task-due">Prazo</label><input id="task-due" className="ui-input" type="datetime-local" value={newTask.dueAt} onChange={event => setNewTask({ ...newTask, dueAt: event.target.value })} /></div>
            <div className="ui-field">
              <label className="ui-field__label" htmlFor="task-priority">Prioridade</label>
              <select id="task-priority" className="ui-input" value={newTask.priority} onChange={event => setNewTask({ ...newTask, priority: event.target.value as Task['priority'] })}>
                {taskPriorities.map(priority => <option key={priority} value={priority}>{priorityConfig[priority].label}</option>)}
              </select>
            </div>
            <div className="ui-field">
              <label className="ui-field__label" htmlFor="task-status">Status inicial</label>
              <select id="task-status" className="ui-input" value={newTask.status} onChange={event => setNewTask({ ...newTask, status: event.target.value as Task['status'] })}>
                {taskStatuses.map(status => <option key={status} value={status}>{statusConfig[status].label}</option>)}
              </select>
              <p className="ui-field__hint">O backend cria como pendente e aplica outro status em seguida com CAS.</p>
            </div>
          </div>
          <div className="create-actions"><Button type="submit" loading={saving}>{saving ? 'Criando…' : 'Criar'}</Button></div>
        </form>
      )}

      <div className="filter-bar">
        <div className="filter-group" role="group" aria-label="Filtrar tarefas por status">
          <span className="filter-label">Status:</span>
          {statusFilters.map(filter => <button type="button" key={filter.key} className={`chip ${filterStatus === filter.key ? 'active' : ''}`} aria-pressed={filterStatus === filter.key} onClick={() => setFilterStatus(filter.key)}>{filter.label}</button>)}
        </div>
        <div className="filter-group" role="group" aria-label="Filtrar tarefas por prioridade">
          <span className="filter-label">Prioridade:</span>
          {priorityFilters.map(filter => <button type="button" key={filter.key} className={`chip priority-filter priority-${filter.key || 'all'} ${filterPriority === filter.key ? 'active' : ''}`} aria-pressed={filterPriority === filter.key} onClick={() => setFilterPriority(filter.key)}>{filter.label}</button>)}
        </div>
        <span className="result-count" role="status">{loading || loadError ? '' : `${filtered.length} ${filtered.length === 1 ? 'tarefa exibida' : 'tarefas exibidas'}`}</span>
      </div>

      {loading ? (
        <LoadingState label="Carregando tarefas…" />
      ) : loadError ? (
        <ErrorState title={loadError.title} message={loadError.message} onRetry={loadError.retryable ? () => { void fetchTasks(); } : undefined} />
      ) : tasks.length === 0 ? (
        <EmptyState title="Nenhuma tarefa encontrada" description="Crie a primeira tarefa para acompanhar o fluxo da operação." icon="tasks" action={<Button size="sm" icon="plus" onClick={openCreate}>Nova tarefa</Button>} />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nenhuma tarefa com estes filtros" description="Ajuste o status ou a prioridade para ver as demais tarefas." icon="search" action={<Button variant="secondary" size="sm" onClick={() => { setFilterStatus(''); setFilterPriority(''); }}>Limpar filtros</Button>} />
      ) : (
        <div className="task-grid">
          {filtered.map(task => {
            const priority = priorityConfig[task.priority] || priorityConfig.medium;
            const status = statusConfig[task.status] || statusConfig.pending;
            const overdue = isOverdue(task);
            const busy = updating?.id === task.id;
            const retryStatus = retryStatuses[task.id];
            const hasContext = Boolean(task.conversationId || task.tutorId || task.patientId);
            return (
              <article id={`task-${task.id}`} key={task.id} className={`task-card ${overdue ? 'overdue' : ''}`} aria-busy={busy || undefined}>
                <div className="task-card-header"><Badge tone={priority.tone} icon={overdue ? 'warning' : undefined}>{overdue ? `${priority.label} · vencida` : priority.label}</Badge><Badge tone={status.tone} icon={status.icon}>{status.label}</Badge></div>
                <h2 className="task-title">{task.title}</h2>
                {task.description && <p className="task-desc">{task.description}</p>}

                {hasContext && (
                  <div className="task-context-list" aria-label={`Vínculos da tarefa ${task.title}`}>
                    {task.conversationId && <a className="task-context-link" href={`/inbox?conversation=${encodeURIComponent(task.conversationId)}`}><Icon name="inbox" size={14} /><span>Conversa · {conversationLabel(task.conversationId)}</span></a>}
                    {task.tutorId && <span className="task-context-link task-context-link--static"><Icon name="tutors" size={14} /><span>Tutor · {tutorLabel(task.tutorId)}</span></span>}
                    {task.patientId && <span className="task-context-link task-context-link--static"><Icon name="patients" size={14} /><span>Paciente · {patientLabel(task.patientId)}</span></span>}
                  </div>
                )}

                <div className="task-meta">
                  {task.dueAt && <span className={`due-badge ${overdue ? 'overdue' : ''}`}><Icon name="clock" size={13} /> {new Date(task.dueAt).toLocaleDateString('pt-BR')} · {timeUntil(task.dueAt)}</span>}
                  {task.assignedTo && <span className="assignee"><Icon name="tutors" size={13} /> {assigneeLabel(task.assignedTo)}</span>}
                  {!task.assignedTo && <span className="assignee assignee--empty">Sem responsável</span>}
                </div>

                <label className="task-status-editor"><span>Status</span><select aria-label={`Alterar status da tarefa ${task.title}`} className="ui-input" value={task.status} disabled={Boolean(updating)} onChange={event => void handleStatusChange(task, event.target.value as Task['status'])}>{taskStatuses.map(nextStatus => <option key={nextStatus} value={nextStatus}>{statusConfig[nextStatus].label}</option>)}</select></label>

                {actionErrors[task.id] && <div className="task-action-error" role="alert"><span>Não foi possível atualizar a tarefa: {actionErrors[task.id]}</span>{retryStatus && <Button type="button" variant="secondary" size="sm" icon="refresh" onClick={() => void handleStatusChange(task, retryStatus)}>Tentar novamente</Button>}</div>}

                <div className="task-actions">
                  {task.status === 'pending' && <Button size="sm" variant="secondary" icon="activity" disabled={Boolean(updating)} loading={busy && updating?.status === 'in_progress'} onClick={() => void handleStatusChange(task, 'in_progress')}>Iniciar</Button>}
                  {task.status === 'in_progress' && <Button size="sm" variant="secondary" icon="check" disabled={Boolean(updating)} loading={busy && updating?.status === 'completed'} onClick={() => void handleStatusChange(task, 'completed')}>Concluir</Button>}
                  {(task.status === 'pending' || task.status === 'in_progress') && <Button size="sm" variant="secondary" icon="close" disabled={Boolean(updating)} loading={busy && updating?.status === 'cancelled'} onClick={() => void handleStatusChange(task, 'cancelled')}>Cancelar</Button>}
                  {(task.status === 'completed' || task.status === 'cancelled') && <Button size="sm" variant="secondary" icon="refresh" disabled={Boolean(updating)} loading={busy && updating?.status === 'pending'} onClick={() => void handleStatusChange(task, 'pending')}>Reabrir</Button>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function statusConfigForConversation(status: Conversation['status']): string {
  if (status === 'open') return 'aberta';
  if (status === 'pending') return 'pendente';
  if (status === 'closed') return 'encerrada';
  return 'arquivada';
}
