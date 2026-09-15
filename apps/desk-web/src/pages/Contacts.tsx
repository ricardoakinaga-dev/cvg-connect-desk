import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Badge, Button, EmptyState, ErrorState, Icon, LoadingState, TextField, type BadgeTone } from '../components/ui';
import { useModalFocus } from '../hooks/useModalFocus';
import './Contacts.css';

interface Contact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  createdAt: string;
}

interface ContactDetail extends Contact {
  externalId: string | null;
  metadata: string | null;
  conversations: { id: string; status: string; statusV2: string; createdAt: string; lastMessage: string | null }[];
  notesCount: number;
  tasksCount: number;
  labels: { id: string; name: string; color: string }[];
  groups: { id: string; name: string; icon: string }[];
}

interface ContactNote {
  id: string;
  content: string;
  createdAt: string;
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
    return { title: 'Acesso negado', message: 'Você não tem permissão para ver estes contatos.', retryable: false };
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

const STATUS_PRESENTATION: Record<string, { label: string; tone: BadgeTone }> = {
  novo: { label: 'Novo', tone: 'info' },
  em_atendimento: { label: 'Em atendimento', tone: 'info' },
  pendente: { label: 'Pendente', tone: 'warning' },
  em_espera: { label: 'Em espera', tone: 'neutral' },
  finalizado: { label: 'Finalizado', tone: 'success' },
  arquivado: { label: 'Arquivado', tone: 'neutral' },
};

function statusPresentation(status: string): { label: string; tone: BadgeTone } {
  return STATUS_PRESENTATION[status] || { label: status || 'Sem status', tone: 'neutral' };
}

function formatPhone(phone: string | null): string {
  if (!phone) return '—';
  const clean = phone.replace(/\D/g, '');
  if (clean.length === 13) return `+${clean.slice(0, 2)} ${clean.slice(2, 4)} ${clean.slice(4, 9)}-${clean.slice(9)}`;
  if (clean.length === 11) return `+55 ${clean.slice(0, 2)} ${clean.slice(2, 7)}-${clean.slice(7)}`;
  return phone;
}

function openCreateInitialForm() {
  return { name: '', phone: '', email: '', notes: '' };
}

function readMetadataNotes(metadata: string | null): string {
  if (!metadata) return '';
  try {
    const meta = JSON.parse(metadata);
    return typeof meta?.notes === 'string' ? meta.notes : '';
  } catch {
    return '';
  }
}

export function Contacts() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listLoadedOnce, setListLoadedOnce] = useState(false);
  const [listError, setListError] = useState<LoadFailure | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedContact, setSelectedContact] = useState<ContactDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<LoadFailure | null>(null);
  const [pendingDetailId, setPendingDetailId] = useState<string | null>(null);
  const [contactNotes, setContactNotes] = useState<ContactNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [newContact, setNewContact] = useState(openCreateInitialForm);
  const [editContact, setEditContact] = useState(openCreateInitialForm);
  const [createErrors, setCreateErrors] = useState<{ name?: string; phone?: string; email?: string }>({});
  const [editErrors, setEditErrors] = useState<{ name?: string; phone?: string; email?: string }>({});
  const [createApiError, setCreateApiError] = useState<string | null>(null);
  const [editApiError, setEditApiError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const createNameRef = useRef<HTMLInputElement>(null);
  const createPhoneRef = useRef<HTMLInputElement>(null);
  const createEmailRef = useRef<HTMLInputElement>(null);
  const editNameRef = useRef<HTMLInputElement>(null);
  const editEmailRef = useRef<HTMLInputElement>(null);
  const createModal = useModalFocus(showCreate, () => !saving && setShowCreate(false));
  const editModal = useModalFocus(showEdit, () => !saving && setShowEdit(false));
  const detailRequestRef = useRef(0);
  const notesRequestRef = useRef(0);

  const fetchContacts = useCallback(async (signal?: AbortSignal) => {
    setListLoading(true);
    try {
      const params = searchTerm ? `?search=${encodeURIComponent(searchTerm)}` : '';
      const data = await api.get<Contact[]>(`/contacts${params}`);
      if (!signal?.aborted) {
        setContacts(data);
        setListError(null);
        setListLoadedOnce(true);
      }
    } catch (err) {
      if (!signal?.aborted) {
        setListError(loadFailureFrom(err));
        setListLoadedOnce(true);
      }
    } finally {
      if (!signal?.aborted) setListLoading(false);
    }
  }, [searchTerm]);

  const loadContactNotes = useCallback(async (conversationId: string) => {
    const requestId = notesRequestRef.current + 1;
    notesRequestRef.current = requestId;
    setNotesLoading(true);
    setNotesError(null);
    try {
      const notes = await api.get<ContactNote[]>(`/notes?referenceType=conversation&referenceId=${conversationId}`);
      if (requestId !== notesRequestRef.current) return;
      setContactNotes(notes);
    } catch (notesFailure) {
      if (requestId !== notesRequestRef.current) return;
      setNotesError(messageFromError(notesFailure));
    } finally {
      if (requestId === notesRequestRef.current) setNotesLoading(false);
    }
  }, []);

  const fetchContactDetail = useCallback(async (id: string) => {
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    notesRequestRef.current += 1;
    setPendingDetailId(id);
    setDetailLoading(true);
    setDetailError(null);
    setSelectedContact(null);
    setContactNotes([]);
    setNotesError(null);
    setStartError(null);
    setNoteError(null);
    try {
      const data = await api.get<ContactDetail>(`/contacts/${id}`);
      if (requestId !== detailRequestRef.current) return;
      setSelectedContact(data);
      setPendingDetailId(null);
      const conversationId = data.conversations[0]?.id;
      if (conversationId) void loadContactNotes(conversationId);
    } catch (detailFailure) {
      if (requestId !== detailRequestRef.current) return;
      setDetailError(loadFailureFrom(detailFailure));
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false);
    }
  }, [loadContactNotes]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void fetchContacts(controller.signal); }, 220);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [fetchContacts]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const openCreate = (trigger?: HTMLElement) => {
    createModal.rememberTrigger(trigger);
    setNewContact(openCreateInitialForm());
    setCreateErrors({});
    setCreateApiError(null);
    setShowCreate(true);
  };

  const openEdit = (trigger?: HTMLElement) => {
    if (!selectedContact) return;
    editModal.rememberTrigger(trigger);
    setEditContact({
      name: selectedContact.name || '',
      phone: selectedContact.phone || '',
      email: selectedContact.email || '',
      notes: readMetadataNotes(selectedContact.metadata),
    });
    setEditErrors({});
    setEditApiError(null);
    setShowEdit(true);
  };

  const validateContact = (form: { name: string; phone: string; email: string }, requirePhone: boolean) => {
    const errors: { name?: string; phone?: string; email?: string } = {};
    if (!form.name.trim()) errors.name = 'Informe o nome do contato.';
    if (requirePhone && !form.phone.trim()) errors.phone = 'Informe o telefone do contato.';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'Informe um e-mail válido.';
    return errors;
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const errors = validateContact(newContact, true);
    if (Object.keys(errors).length) {
      setCreateErrors(errors);
      setCreateApiError(null);
      if (errors.name) createNameRef.current?.focus();
      else if (errors.phone) createPhoneRef.current?.focus();
      else createEmailRef.current?.focus();
      return;
    }
    setSaving(true);
    setCreateApiError(null);
    setCreateErrors({});
    try {
      const created = await api.post<Contact>('/contacts', newContact);
      setShowCreate(false);
      setFeedback({ tone: 'success', message: 'Contato criado.' });
      await fetchContacts();
      await fetchContactDetail(created.id);
    } catch (err) {
      setCreateApiError(messageFromError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContact || saving) return;
    const errors = validateContact(editContact, false);
    if (Object.keys(errors).length) {
      setEditErrors(errors);
      setEditApiError(null);
      (errors.name ? editNameRef : editEmailRef).current?.focus();
      return;
    }
    setSaving(true);
    setEditApiError(null);
    setEditErrors({});
    try {
      await api.put(`/contacts/${selectedContact.id}`, editContact);
      setShowEdit(false);
      setFeedback({ tone: 'success', message: 'Contato atualizado.' });
      await fetchContactDetail(selectedContact.id);
    } catch (err) {
      setEditApiError(messageFromError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleStartConversation = async () => {
    if (!selectedContact) return;
    setStartError(null);
    try {
      const result = await api.post<{ conversationId: string; isNew: boolean }>(`/contacts/${selectedContact.id}/start-conversation`, {});
      navigate(`/inbox?conversation=${result.conversationId}`);
    } catch (err) {
      setStartError(messageFromError(err));
    }
  };

  const handleAddNote = async () => {
    const conversationId = selectedContact?.conversations[0]?.id;
    if (!newNote.trim() || !conversationId || noteSaving) return;
    setNoteSaving(true);
    setNoteError(null);
    try {
      await api.post('/notes', {
        content: newNote.trim(),
        referenceType: 'conversation',
        referenceId: conversationId,
      });
      setNewNote('');
      setFeedback({ tone: 'success', message: 'Nota adicionada.' });
      setSelectedContact((current) => (current ? { ...current, notesCount: current.notesCount + 1 } : current));
      await loadContactNotes(conversationId);
    } catch (err) {
      setNoteError(messageFromError(err));
    } finally {
      setNoteSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedContact || !window.confirm('Deseja excluir este contato?')) return;
    try {
      await api.delete(`/contacts/${selectedContact.id}`);
      setSelectedContact(null);
      setFeedback({ tone: 'success', message: 'Contato excluído.' });
      await fetchContacts();
    } catch (err) {
      setFeedback({ tone: 'error', message: `Não foi possível excluir: ${messageFromError(err)}` });
    }
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  const formatLongDate = (d: string) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  const activeConversationId = selectedContact?.conversations[0]?.id ?? null;
  const listIsEmpty = listLoadedOnce && !listError && contacts.length === 0;

  return (
    <div className={`contacts-page ${selectedContact || detailLoading || detailError ? 'has-selection' : ''}`}>
      {feedback && (
        <div className={`contacts-feedback ui-alert ${feedback.tone === 'success' ? 'ui-alert--success' : ''}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>
          <Icon name={feedback.tone === 'success' ? 'check' : 'warning'} size={18} />
          <span>{feedback.message}</span>
        </div>
      )}

      {/* COLUNA 1 — Lista */}
      <div className="contacts-col-list">
        <div className="contacts-topbar">
          <h1><Icon name="contacts" /> Contatos</h1>
          <button className="btn-new" onClick={(event) => openCreate(event.currentTarget)} aria-label="Novo contato"><Icon name="plus" /></button>
        </div>

        <div className="contacts-search">
          <span className="search-icon" aria-hidden="true"><Icon name="search" size={17} /></span>
          <input aria-label="Buscar contatos" placeholder="Buscar por nome, telefone..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>

        <div className="contacts-count">{listLoadedOnce ? `${contacts.length} contatos` : '—'}</div>

        <div className="contacts-list" aria-busy={listLoading || undefined}>
          {listLoading && !listLoadedOnce ? (
            <LoadingState label="Carregando contatos…" />
          ) : listError && contacts.length === 0 ? (
            <ErrorState
              title={listError.title}
              message={listError.message}
              onRetry={listError.retryable ? () => { void fetchContacts(); } : undefined}
            />
          ) : listIsEmpty ? (
            <EmptyState
              title="Nenhum contato encontrado"
              description={searchTerm ? 'Nenhum contato corresponde à busca.' : 'Cadastre o primeiro contato para começar.'}
              icon="contacts"
              action={<Button size="sm" icon="plus" onClick={(event) => openCreate(event.currentTarget)}>Adicionar contato</Button>}
            />
          ) : (
            <>
              {listError && (
                <div className="ui-alert ui-alert--warning" role="alert">
                  <Icon name="warning" size={18} />
                  <span>{listError.title}: {listError.message}</span>
                  {listError.retryable && <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void fetchContacts(); }}>Tentar novamente</Button>}
                </div>
              )}
              {contacts.map(contact => (
                <button type="button" key={contact.id} className={`contact-item ${selectedContact?.id === contact.id ? 'selected' : ''}`} aria-pressed={selectedContact?.id === contact.id} onClick={() => void fetchContactDetail(contact.id)}>
                  <div className="contact-avatar" aria-hidden="true">{(contact.name || '?')[0].toUpperCase()}</div>
                  <div className="contact-info">
                    <div className="contact-name">{contact.name || 'Sem nome'}</div>
                    <div className="contact-phone">{formatPhone(contact.phone)}</div>
                  </div>
                  <div className="contact-date">{formatDate(contact.createdAt)}</div>
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* COLUNA 2 — Perfil */}
      <div className="contacts-col-profile">
        {detailError ? (
          <ErrorState
            title={detailError.title}
            message={detailError.message}
            onRetry={detailError.retryable && pendingDetailId ? () => { void fetchContactDetail(pendingDetailId); } : undefined}
          />
        ) : detailLoading ? (
          <LoadingState label="Carregando contato…" />
        ) : selectedContact ? (
          <>
            {/* Header do perfil */}
            <div className="profile-header">
              <button type="button" className="contacts-mobile-back" aria-label="Voltar para lista de contatos" onClick={() => setSelectedContact(null)}><Icon name="back" /></button>
              <div className="profile-avatar-large" aria-hidden="true">{(selectedContact.name || '?')[0].toUpperCase()}</div>
              <div className="profile-info">
                <h2>{selectedContact.name || 'Sem nome'}</h2>
                <div className="profile-phone">{formatPhone(selectedContact.phone)}</div>
                {selectedContact.email && <div className="profile-email">📧 {selectedContact.email}</div>}
              </div>
              <div className="profile-actions">
                <button className="btn-action-icon" aria-label="Iniciar conversa" onClick={handleStartConversation}><Icon name="message" /></button>
                <button className="btn-action-icon" aria-label="Editar contato" onClick={(event) => openEdit(event.currentTarget)}><Icon name="settings" /></button>
                <button className="btn-action-icon" aria-label="Notas do contato" aria-expanded={showNotes} onClick={() => setShowNotes(!showNotes)}><Icon name="notes" /></button>
                <button className="btn-action-icon danger" aria-label="Excluir contato" onClick={handleDelete}><Icon name="close" /></button>
              </div>
            </div>

            {startError && (
              <div className="profile-section">
                <div className="ui-alert" role="alert">
                  <Icon name="warning" size={18} />
                  <span>Não foi possível iniciar a conversa: {startError}</span>
                  <Button variant="secondary" size="sm" icon="refresh" onClick={handleStartConversation}>Tentar novamente</Button>
                </div>
              </div>
            )}

            {/* Labels e Grupos */}
            {(selectedContact.labels?.length > 0 || selectedContact.groups?.length > 0) && (
              <div className="profile-section">
                <div className="tags-row">
                  {selectedContact.labels?.map(l => (
                    <span key={l.id} className="tag-label" style={{ background: `${l.color}20`, color: l.color }}>{l.name}</span>
                  ))}
                  {selectedContact.groups?.map(g => (
                    <span key={g.id} className="tag-group">{g.icon} {g.name}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Notas rápidas */}
            {showNotes && (
              <div className="profile-section notes-section">
                <h4>📝 Notas do Contato</h4>
                {activeConversationId ? (
                  <div className="add-note">
                    <textarea aria-label="Adicionar nota ao contato" placeholder="Adicionar nota..." value={newNote} onChange={e => setNewNote(e.target.value)} rows={2} />
                    <button className="btn-primary-sm" onClick={handleAddNote} disabled={!newNote.trim() || noteSaving}>{noteSaving ? 'Salvando…' : 'Adicionar'}</button>
                  </div>
                ) : (
                  <p className="muted-note">As notas são vinculadas a uma conversa. Inicie uma conversa para registrar notas.</p>
                )}
                {noteError && (
                  <div className="ui-alert" role="alert">
                    <Icon name="warning" size={18} />
                    <span>Não foi possível salvar a nota: {noteError}</span>
                  </div>
                )}
                {notesLoading ? (
                  <LoadingState label="Carregando notas…" />
                ) : notesError ? (
                  <div className="ui-alert ui-alert--warning" role="alert">
                    <Icon name="warning" size={18} />
                    <span>Não foi possível carregar as notas: {notesError}</span>
                    {activeConversationId && <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void loadContactNotes(activeConversationId); }}>Tentar novamente</Button>}
                  </div>
                ) : contactNotes.length > 0 ? (
                  <div className="notes-list">
                    {contactNotes.map(note => (
                      <div key={note.id} className="note-item">
                        <div className="note-content">{note.content}</div>
                        <div className="note-date">{formatDate(note.createdAt)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-sm">Nenhuma nota ainda</div>
                )}
              </div>
            )}

            {/* Ação principal */}
            <div className="profile-section">
              <button className="btn-start-chat" onClick={handleStartConversation}>
                <Icon name="message" /> Iniciar conversa
              </button>
            </div>

            {/* Conversas */}
            <div className="profile-section">
              <h4>💬 Conversas ({selectedContact.conversations.length})</h4>
              {selectedContact.conversations.length > 0 ? (
                <div className="conversations-list">
                  {selectedContact.conversations.map(conv => {
                    const status = statusPresentation(conv.statusV2);
                    return (
                      <button type="button" key={conv.id} className="conv-mini" onClick={() => navigate(`/inbox?conversation=${conv.id}`)}>
                        <Badge tone={status.tone}>{status.label}</Badge>
                        <div className="conv-mini-info">
                          <div className="conv-mini-msg">{conv.lastMessage || 'Sem mensagens'}</div>
                        </div>
                        <div className="conv-mini-date">{formatDate(conv.createdAt)}</div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-sm">Nenhuma conversa ainda</div>
              )}
            </div>

            {/* Estatísticas */}
            <div className="profile-section stats-mini">
              <div className="stat-item">
                <span className="stat-num">{selectedContact.conversations.length}</span>
                <span className="stat-label">Conversas</span>
              </div>
              <div className="stat-item">
                <span className="stat-num">{selectedContact.notesCount}</span>
                <span className="stat-label">Notas</span>
              </div>
              <div className="stat-item">
                <span className="stat-num">{selectedContact.tasksCount}</span>
                <span className="stat-label">Tarefas</span>
              </div>
            </div>

            {/* Info extra */}
            <div className="profile-section">
              <div className="info-grid">
                <div className="info-item">
                  <span className="info-label">ID</span>
                  <span className="info-value mono">{selectedContact.id.slice(0, 12)}...</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Cadastrado</span>
                  <span className="info-value">{formatLongDate(selectedContact.createdAt)}</span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            className="profile-empty"
            title="Selecione um contato"
            description="Escolha um contato na lista para ver o perfil"
            icon="contacts"
            action={<Button icon="plus" onClick={(event) => openCreate(event.currentTarget)}>Novo contato</Button>}
          />
        )}
      </div>

      {/* MODAL: Criar contato */}
      {showCreate && (
        <div className="modal-overlay" role="presentation" onClick={() => !saving && setShowCreate(false)}>
          <div ref={createModal.dialogRef} className="modal-content" role="dialog" aria-modal="true" aria-labelledby="create-contact-title" tabIndex={-1} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 id="create-contact-title">Novo contato</h3>
              <button className="btn-close" aria-label="Fechar" onClick={() => setShowCreate(false)} disabled={saving}><Icon name="close" /></button>
            </div>
            <form className="modal-body" onSubmit={handleCreate} noValidate>
              {createApiError && (
                <div className="ui-alert" role="alert">
                  <Icon name="warning" size={18} />
                  <span>{createApiError}</span>
                </div>
              )}
              <TextField
                ref={createNameRef}
                label="Nome *"
                id="new-contact-name"
                placeholder="Nome completo"
                value={newContact.name}
                error={createErrors.name}
                autoFocus
                onChange={e => { setNewContact({ ...newContact, name: e.target.value }); setCreateErrors(current => ({ ...current, name: undefined })); }}
              />
              <TextField
                ref={createPhoneRef}
                label="Telefone *"
                id="new-contact-phone"
                placeholder="+55 11 99999-9999"
                value={newContact.phone}
                error={createErrors.phone}
                onChange={e => { setNewContact({ ...newContact, phone: e.target.value }); setCreateErrors(current => ({ ...current, phone: undefined })); }}
              />
              <TextField
                ref={createEmailRef}
                label="Email"
                id="new-contact-email"
                type="email"
                placeholder="email@exemplo.com"
                value={newContact.email}
                error={createErrors.email}
                onChange={e => { setNewContact({ ...newContact, email: e.target.value }); setCreateErrors(current => ({ ...current, email: undefined })); }}
              />
              <div className="form-group">
                <label htmlFor="new-contact-notes">Notas</label>
                <textarea id="new-contact-notes" placeholder="Informações sobre o contato..." value={newContact.notes} onChange={e => setNewContact({ ...newContact, notes: e.target.value })} rows={3} />
              </div>
              <div className="modal-actions">
                <Button variant="secondary" disabled={saving} onClick={() => setShowCreate(false)}>Cancelar</Button>
                <Button type="submit" loading={saving}>{saving ? 'Criando…' : 'Criar Contato'}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Editar contato */}
      {showEdit && selectedContact && (
        <div className="modal-overlay" role="presentation" onClick={() => !saving && setShowEdit(false)}>
          <div ref={editModal.dialogRef} className="modal-content" role="dialog" aria-modal="true" aria-labelledby="edit-contact-title" tabIndex={-1} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 id="edit-contact-title">Editar contato</h3>
              <button className="btn-close" aria-label="Fechar" onClick={() => setShowEdit(false)} disabled={saving}><Icon name="close" /></button>
            </div>
            <form className="modal-body" onSubmit={handleUpdate} noValidate>
              {editApiError && (
                <div className="ui-alert" role="alert">
                  <Icon name="warning" size={18} />
                  <span>{editApiError}</span>
                </div>
              )}
              <TextField
                ref={editNameRef}
                label="Nome"
                id="edit-contact-name"
                value={editContact.name}
                error={editErrors.name}
                autoFocus
                onChange={e => { setEditContact({ ...editContact, name: e.target.value }); setEditErrors(current => ({ ...current, name: undefined })); }}
              />
              <TextField
                label="Telefone"
                id="edit-contact-phone"
                value={editContact.phone}
                error={editErrors.phone}
                onChange={e => { setEditContact({ ...editContact, phone: e.target.value }); setEditErrors(current => ({ ...current, phone: undefined })); }}
              />
              <TextField
                ref={editEmailRef}
                label="Email"
                id="edit-contact-email"
                type="email"
                value={editContact.email}
                error={editErrors.email}
                onChange={e => { setEditContact({ ...editContact, email: e.target.value }); setEditErrors(current => ({ ...current, email: undefined })); }}
              />
              <div className="form-group">
                <label htmlFor="edit-contact-notes">Notas</label>
                <textarea id="edit-contact-notes" value={editContact.notes} onChange={e => setEditContact({ ...editContact, notes: e.target.value })} rows={3} />
              </div>
              <div className="modal-actions">
                <Button variant="secondary" disabled={saving} onClick={() => setShowEdit(false)}>Cancelar</Button>
                <Button type="submit" loading={saving}>{saving ? 'Salvando…' : 'Salvar'}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
