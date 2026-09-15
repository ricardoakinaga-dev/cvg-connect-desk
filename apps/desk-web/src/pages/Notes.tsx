import { useCallback, useEffect, useRef, useState } from 'react';
import { api, noteApi, type InternalNote } from '../lib/api';
import { useConversationContext } from '../hooks/useConversationContext';
import { Link } from 'react-router-dom';
import { Button, EmptyState, ErrorState, Icon, LoadingState, type IconName } from '../components/ui';
import './Notes.css';

interface Note {
  id: string;
  referenceType: string;
  referenceId: string;
  content: string;
  authorUserId: string | null;
  createdAt: string;
}

interface LoadFailure {
  title: string;
  message: string;
  retryable: boolean;
}

const refConfig: Record<string, { label: string; icon: IconName; tone: string }> = {
  conversation: { label: 'Conversa', icon: 'message', tone: 'conversation' },
  task: { label: 'Tarefa', icon: 'tasks', tone: 'task' },
  tutor: { label: 'Tutor', icon: 'tutors', tone: 'tutor' },
  patient: { label: 'Paciente', icon: 'patients', tone: 'patient' },
};

function loadFailureFrom(error: unknown): LoadFailure {
  const status = (error as { status?: number } | null)?.status ?? 0;
  const raw = error instanceof Error ? error.message : '';
  if (status === 403) {
    return { title: 'Acesso negado', message: 'Você não tem permissão para ver estas notas.', retryable: false };
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

function toPageNote(note: InternalNote | Note): Note {
  return {
    id: note.id,
    referenceType: note.referenceType ?? '',
    referenceId: note.referenceId ?? '',
    content: note.content,
    authorUserId: 'authorId' in note ? note.authorId ?? null : (note as Note).authorUserId,
    createdAt: note.createdAt,
  };
}

export function Notes() {
  const conversationContext = useConversationContext();
  const contextConversationId = conversationContext.conversationId;
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadFailure | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [newNote, setNewNote] = useState({ content: '', referenceType: 'conversation', referenceId: '' });
  const [createErrors, setCreateErrors] = useState<{ content?: string; referenceId?: string }>({});
  const [createApiError, setCreateApiError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const referenceRef = useRef<HTMLInputElement>(null);

  const fetchNotes = useCallback(async () => {
    if (conversationContext.invalid) {
      setNotes([]);
      setLoadError({
        title: 'Contexto inválido',
        message: 'O identificador de conversa no link não é válido. Remova o filtro para ver suas notas.',
        retryable: false,
      });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // C04: com contexto, a consulta é da CONVERSA (autorizada no servidor);
      // sem contexto, mantém-se a consulta explícita "minhas notas".
      const data = contextConversationId
        ? (await noteApi.list({ conversationId: contextConversationId, limit: 100 })).map(toPageNote)
        : await api.get<Note[]>('/notes?mine=true');
      setNotes(data);
      setLoadError(null);
    } catch (err) {
      const status = (err as { status?: number } | null)?.status ?? 0;
      if (status === 404 && contextConversationId) {
        setNotes([]);
        setLoadError({
          title: 'Contexto inacessível',
          message: 'A conversa deste link não está disponível para o seu acesso. Remova o filtro para ver suas notas.',
          retryable: false,
        });
      } else {
        setLoadError(loadFailureFrom(err));
      }
    } finally {
      setLoading(false);
    }
  }, [contextConversationId, conversationContext.invalid]);

  useEffect(() => { void fetchNotes(); }, [fetchNotes]);

  // C04: o contexto preenche a referência de criação (sem ID manual).
  useEffect(() => {
    if (!contextConversationId) return;
    setNewNote(current => ({
      ...current,
      referenceType: 'conversation',
      referenceId: contextConversationId,
    }));
  }, [contextConversationId]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const openCreate = () => {
    setCreateErrors({});
    setCreateApiError(null);
    setShowCreate(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const errors: { content?: string; referenceId?: string } = {};
    if (!newNote.content.trim()) errors.content = 'Escreva o conteúdo da nota.';
    if (!newNote.referenceId.trim()) errors.referenceId = 'Informe o ID da referência.';
    if (errors.content || errors.referenceId) {
      setCreateErrors(errors);
      setCreateApiError(null);
      (errors.content ? contentRef : referenceRef).current?.focus();
      return;
    }
    setSaving(true);
    setCreateApiError(null);
    setCreateErrors({});
    try {
      await api.post('/notes', { ...newNote, content: newNote.content.trim(), referenceId: newNote.referenceId.trim() });
      setNewNote({ content: '', referenceType: 'conversation', referenceId: '' });
      setShowCreate(false);
      setFeedback('Nota registrada.');
      await fetchNotes();
    } catch (err) {
      setCreateApiError(messageFromError(err));
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (d: string) => {
    const date = new Date(d);
    const diff = Date.now() - date.getTime();
    const mins = Math.max(0, Math.floor(diff / 60000));
    if (mins < 1) return 'agora';
    if (mins < 60) return `${mins}min atrás`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h atrás`;
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  };

  const filtered = filterType ? notes.filter(n => n.referenceType === filterType) : notes;
  const filterLabel = filterType ? refConfig[filterType]?.label || filterType : null;

  return (
    <div className="notes-page" aria-busy={loading || undefined}>
      <div className="page-hero">
        <div className="hero-left">
          <span className="page-kicker">Memória clínica</span>
          <h1><Icon name="notes" /> Notas internas</h1>
          <p>Registre observações sobre conversas, tarefas e contatos</p>
        </div>
        <Button icon={showCreate ? 'close' : 'plus'} onClick={() => (showCreate ? setShowCreate(false) : openCreate())}>
          {showCreate ? 'Cancelar' : 'Nova nota'}
        </Button>
      </div>

      {feedback && (
        <div className="ui-alert ui-alert--success notes-feedback" role="status">
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
              : 'Mostrando apenas as notas da conversa selecionada.'}
          </span>
          <Link className="context-banner__link" to={`/inbox?conversation=${encodeURIComponent(conversationContext.rawValue)}`}>Voltar à conversa</Link>
          <button type="button" className="context-banner__clear" onClick={conversationContext.clear}>Remover filtro</button>
        </div>
      )}

      {showCreate && (
        <form className="create-panel" onSubmit={handleCreate} noValidate>
          {createApiError && (
            <div className="ui-alert" role="alert">
              <Icon name="warning" size={18} />
              <span>Não foi possível salvar a nota: {createApiError}. O conteúdo digitado foi mantido.</span>
            </div>
          )}
          <div className="create-row">
            <select aria-label="Tipo da referência" value={newNote.referenceType} disabled={Boolean(contextConversationId)} onChange={e => setNewNote({ ...newNote, referenceType: e.target.value })}>
              {Object.entries(refConfig).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <div className="ui-field">
              <input
                ref={referenceRef}
                className="ui-input"
                aria-label="ID da referência"
                aria-invalid={createErrors.referenceId ? true : undefined}
                aria-describedby={createErrors.referenceId ? 'note-reference-error' : undefined}
                placeholder={contextConversationId ? 'Conversa selecionada' : 'ID da referência'}
                value={newNote.referenceId}
                readOnly={Boolean(contextConversationId)}
                disabled={Boolean(contextConversationId)}
                onChange={e => { setNewNote({ ...newNote, referenceId: e.target.value }); setCreateErrors(current => ({ ...current, referenceId: undefined })); }}
              />
              {createErrors.referenceId && <p id="note-reference-error" className="ui-field__error" role="alert">{createErrors.referenceId}</p>}
            </div>
          </div>
          <textarea
            ref={contentRef}
            aria-label="Conteúdo da nota"
            aria-invalid={createErrors.content ? true : undefined}
            aria-describedby={createErrors.content ? 'note-content-error' : undefined}
            placeholder="Escreva sua nota..."
            value={newNote.content}
            onChange={e => { setNewNote({ ...newNote, content: e.target.value }); setCreateErrors(current => ({ ...current, content: undefined })); }}
            rows={3}
          />
          {createErrors.content && <p id="note-content-error" className="ui-field__error" role="alert">{createErrors.content}</p>}
          <div className="create-actions">
            <Button type="submit" loading={saving}>{saving ? 'Salvando…' : 'Salvar Nota'}</Button>
          </div>
        </form>
      )}

      <div className="filter-bar">
        <div className="filter-group" role="group" aria-label="Filtrar notas por tipo">
          <span className="filter-label">Tipo:</span>
          <button type="button" className={`chip ${filterType === '' ? 'active' : ''}`} aria-pressed={filterType === ''} onClick={() => setFilterType('')}>Todos</button>
          {Object.entries(refConfig).map(([k, v]) => (
            <button type="button" key={k} className={`chip ${filterType === k ? 'active' : ''}`} aria-pressed={filterType === k} onClick={() => setFilterType(k)}><Icon name={v.icon} size={14} /> {v.label}</button>
          ))}
        </div>
        <span className="result-count" role="status">{loading || loadError ? '' : `${filtered.length} ${filtered.length === 1 ? 'nota' : 'notas'}`}</span>
      </div>

      {loading ? (
        <LoadingState label="Carregando notas…" />
      ) : loadError ? (
        <ErrorState
          title={loadError.title}
          message={loadError.message}
          onRetry={loadError.retryable ? () => { void fetchNotes(); } : undefined}
        />
      ) : notes.length === 0 ? (
        <EmptyState
          title="Nenhuma nota registrada"
          description="Registre a primeira observação sobre uma conversa, tarefa ou cadastro."
          icon="notes"
          action={<Button size="sm" icon="plus" onClick={openCreate}>Nova nota</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={`Nenhuma nota de ${filterLabel ?? 'tipo desconhecido'}`}
          description="Ajuste o filtro para ver as demais notas."
          icon="notes"
          action={<Button variant="secondary" size="sm" onClick={() => setFilterType('')}>Mostrar todas</Button>}
        />
      ) : (
        <div className="notes-timeline">
          {filtered.map(note => {
            const ref = refConfig[note.referenceType] || refConfig.conversation;
            return (
              <div key={note.id} className="note-card">
                <div className={`note-timeline-dot note-tone--${ref.tone}`} aria-hidden="true" />
                <div className="note-content-card">
                  <div className="note-header-row">
                    <span className={`note-ref-badge note-tone--${ref.tone}`}><Icon name={ref.icon} size={14} /> {ref.label}</span>
                    <span className="note-time">{formatDate(note.createdAt)}</span>
                  </div>
                  <div className="note-body">{note.content}</div>
                  <div className="note-footer">
                    <span className="note-ref-id">{note.referenceId ? `#${note.referenceId.slice(0, 8)}` : 'sem referência'}</span>
                    {note.authorUserId && <span className="note-author">por {note.authorUserId.slice(0, 8)}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
