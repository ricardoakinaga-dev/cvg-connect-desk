import { useCallback, useEffect, useRef, useState } from 'react';
import { tutorApi, type Tutor } from '../lib/api';
import { Badge, Button, EmptyState, ErrorState, Icon, LoadingState, TextField } from '../components/ui';
import { useModalFocus } from '../hooks/useModalFocus';
import './EntityPages.css';
import './Tutors.css';

interface ActionFeedback {
  tone: 'success' | 'error' | 'warning';
  message: string;
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
    return { title: 'Acesso negado', message: 'Você não tem permissão para ver os tutores.', retryable: false };
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

function formatPhone(phone: string | null): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11) return `+55 ${digits.slice(0, 2)} ${digits.slice(2, 7)}-${digits.slice(7)}`;
  return phone;
}

export function Tutors() {
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [selected, setSelected] = useState<Tutor | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState<LoadFailure | null>(null);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Tutor | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string }>({});
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const nameInputRef = useRef<HTMLInputElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const modal = useModalFocus(modalOpen, () => !saving && setModalOpen(false));

  const clearFieldError = (field: 'name' | 'email') => {
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  };

  const loadTutors = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const data = await tutorApi.list(search || undefined);
      if (!signal?.aborted) {
        setTutors(data);
        setLoadError(null);
        setLoadedOnce(true);
      }
    } catch (loadFailure) {
      if (!signal?.aborted) {
        setLoadError(loadFailureFrom(loadFailure));
        setLoadedOnce(true);
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void loadTutors(controller.signal); }, 220);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [loadTutors]);

  const openCreate = (trigger?: HTMLElement) => {
    modal.rememberTrigger(trigger);
    setEditing(null);
    setForm({ name: '', phone: '', email: '' });
    setFormError(null);
    setFieldErrors({});
    setModalOpen(true);
  };

  const openEdit = (tutor: Tutor, trigger?: HTMLElement) => {
    modal.rememberTrigger(trigger);
    setEditing(tutor);
    setForm({ name: tutor.name, phone: tutor.phone || '', email: tutor.email || '' });
    setFormError(null);
    setFieldErrors({});
    setModalOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const errors: { name?: string; email?: string } = {};
    if (!form.name.trim()) errors.name = 'Informe o nome do tutor para salvar.';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'Informe um e-mail válido.';
    if (errors.name || errors.email) {
      setFieldErrors(errors);
      setFormError(null);
      (errors.name ? nameInputRef : emailInputRef).current?.focus();
      return;
    }
    setSaving(true);
    setFormError(null);
    setFieldErrors({});
    try {
      if (editing) await tutorApi.update(editing.id, { name: form.name.trim(), phone: form.phone || null, email: form.email || null });
      else await tutorApi.create({ name: form.name.trim(), phone: form.phone || undefined, email: form.email || undefined });
      setModalOpen(false);
      setFeedback({ tone: 'success', message: editing ? 'Tutor atualizado.' : 'Tutor cadastrado.' });
      if (editing && selected?.id === editing.id) setSelected(null);
      await loadTutors();
    } catch (saveError) {
      setFormError(messageFromError(saveError));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (tutor: Tutor) => {
    if (!window.confirm(`Excluir o tutor “${tutor.name}”?`)) return;
    setFeedback(null);
    try {
      await tutorApi.delete(tutor.id);
      if (selected?.id === tutor.id) setSelected(null);
      setFeedback({ tone: 'success', message: 'Tutor excluído.' });
      await loadTutors();
    } catch (removeError) {
      setFeedback({ tone: 'error', message: `Não foi possível excluir: ${messageFromError(removeError)}` });
    }
  };

  const showDetails = async (tutor: Tutor) => {
    setSelected(tutor);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const details = await tutorApi.get(tutor.id);
      setSelected(details);
    } catch (detailFailure) {
      setDetailError(messageFromError(detailFailure));
    } finally {
      setDetailLoading(false);
    }
  };

  const listIsEmpty = loadedOnce && !loadError && tutors.length === 0;

  return (
    <div className={`entity-page ${selected ? 'has-selection' : ''}`}>
      <header className="entity-header">
        <div className="entity-title">
          <h1>Tutores</h1>
          <p>Cadastre responsáveis e acompanhe os vínculos da operação.</p>
        </div>
        <div className="entity-actions">
          <input className="entity-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou telefone" aria-label="Buscar tutores" />
          <Button icon="plus" onClick={(event) => openCreate(event.currentTarget)}>Novo tutor</Button>
        </div>
      </header>

      {feedback && (
        <div className={`ui-alert ${feedback.tone === 'error' ? '' : `ui-alert--${feedback.tone}`}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>
          <Icon name={feedback.tone === 'error' ? 'warning' : 'check'} size={18} />
          <span>{feedback.message}</span>
        </div>
      )}

      <div className="entity-layout">
        <section className="entity-card" aria-label="Lista de tutores" aria-busy={loading || undefined}>
          {loading && !loadedOnce ? (
            <LoadingState label="Carregando tutores…" />
          ) : loadError && tutors.length === 0 ? (
            <ErrorState
              title={loadError.title}
              message={loadError.message}
              onRetry={loadError.retryable ? () => { void loadTutors(); } : undefined}
            />
          ) : listIsEmpty ? (
            <EmptyState
              title="Nenhum tutor encontrado"
              description={search ? 'Nenhum responsável corresponde à busca.' : 'Adicione o primeiro responsável para começar.'}
              icon="tutors"
              action={<Button icon="plus" size="sm" onClick={(event) => openCreate(event.currentTarget)}>Novo tutor</Button>}
            />
          ) : (
            <>
              {loadError && (
                <div className="ui-alert ui-alert--warning" role="alert">
                  <Icon name="warning" size={18} />
                  <span>{loadError.title}: {loadError.message}</span>
                  {loadError.retryable && <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void loadTutors(); }}>Tentar novamente</Button>}
                </div>
              )}
              <div className="entity-table-wrap">
                <table className="entity-table">
                  <thead><tr><th>Nome</th><th>Telefone</th><th>E-mail</th><th>Cadastro</th><th>Ações</th></tr></thead>
                  <tbody>
                    {tutors.map((tutor) => (
                      <tr key={tutor.id} className={selected?.id === tutor.id ? 'selected' : ''} onClick={() => void showDetails(tutor)}>
                        <td className="primary-cell">
                          <button type="button" className="entity-row-detail" onClick={(event) => { event.stopPropagation(); void showDetails(tutor); }}>
                            {tutor.name}
                          </button>
                        </td>
                        <td>{formatPhone(tutor.phone)}</td>
                        <td className="muted">{tutor.email || '—'}</td>
                        <td className="muted">{new Date(tutor.createdAt).toLocaleDateString('pt-BR')}</td>
                        <td>
                          <div className="entity-row-actions">
                            <button className="entity-row-action" type="button" title={`Editar tutor ${tutor.name}`} onClick={(event) => { event.stopPropagation(); openEdit(tutor, event.currentTarget); }}>Editar</button>
                            <button className="entity-row-action danger" type="button" title={`Excluir tutor ${tutor.name}`} onClick={(event) => { event.stopPropagation(); void remove(tutor); }}>Excluir</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <aside className="entity-card entity-detail" aria-live="polite">
          {detailError ? (
            <ErrorState
              title="Não foi possível carregar os detalhes"
              message={detailError}
              onRetry={selected ? () => { void showDetails(selected); } : undefined}
            />
          ) : selected ? (
            <>
              <button type="button" className="entity-mobile-back" aria-label="Voltar para tutores" onClick={() => { setSelected(null); setDetailError(null); }}><Icon name="back" size={18} /></button>
              <h3>{selected.name}</h3>
              <p className="entity-detail-subtitle">Detalhes do responsável</p>
              {detailLoading && <LoadingState label="Carregando detalhes…" />}
              <dl className="entity-detail-list">
                <div><dt>Telefone</dt><dd>{formatPhone(selected.phone)}</dd></div>
                <div><dt>E-mail</dt><dd>{selected.email || '—'}</dd></div>
                <div><dt>Conversas</dt><dd>{selected.conversationCount ?? 0}</dd></div>
                <div><dt>Tarefas</dt><dd>{selected.taskCount ?? 0}</dd></div>
              </dl>
              <div className="entity-detail-section">
                <h4>Pacientes vinculados</h4>
                {selected.patients?.length ? (
                  <div className="entity-mini-list">
                    {selected.patients.map((patient) => (
                      <div className="entity-mini-item" key={patient.id}>
                        <span>{patient.name}</span>
                        <Badge tone="info">{patient.species || 'Espécie não informada'}</Badge>
                      </div>
                    ))}
                  </div>
                ) : <span className="muted">Nenhum paciente vinculado.</span>}
              </div>
            </>
          ) : <EmptyState title="Selecione um tutor" description="Os detalhes e vínculos aparecerão aqui." icon="tutors" />}
        </aside>
      </div>

      {modalOpen && <div className="entity-modal-backdrop" role="presentation" onMouseDown={() => !saving && setModalOpen(false)}>
        <div ref={modal.dialogRef} className="entity-modal" role="dialog" aria-modal="true" aria-labelledby="tutor-form-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
          <h3 id="tutor-form-title">{editing ? 'Editar tutor' : 'Novo tutor'}</h3>
          {formError && (
            <div className="ui-alert" role="alert">
              <Icon name="warning" size={18} />
              <span>{formError}</span>
            </div>
          )}
          <form className="entity-form" onSubmit={save} noValidate>
            <TextField
              ref={nameInputRef}
              label="Nome *"
              maxLength={200}
              value={form.name}
              error={fieldErrors.name}
              autoFocus
              onChange={(event) => { setForm({ ...form, name: event.target.value }); clearFieldError('name'); }}
            />
            <TextField label="Telefone" maxLength={32} value={form.phone} placeholder="(11) 99999-0000" onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            <TextField ref={emailInputRef} label="E-mail" type="email" maxLength={320} value={form.email} error={fieldErrors.email} onChange={(event) => { setForm({ ...form, email: event.target.value }); clearFieldError('email'); }} />
            <div className="entity-form-actions">
              <Button variant="secondary" disabled={saving} onClick={() => setModalOpen(false)}>Cancelar</Button>
              <Button type="submit" loading={saving}>{saving ? 'Salvando…' : 'Salvar'}</Button>
            </div>
          </form>
        </div>
      </div>}
    </div>
  );
}
