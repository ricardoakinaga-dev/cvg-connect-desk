import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Badge, Button, EmptyState, ErrorState, Icon, LoadingState } from '../components/ui';
import { useModalFocus } from '../hooks/useModalFocus';
import './Labels.css';

interface Label {
  id: string;
  name: string;
  color: string;
  description: string | null;
  category: string | null;
  isSystem: boolean;
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
    return { title: 'Acesso negado', message: 'Você não tem permissão para ver as labels.', retryable: false };
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

const emptyLabel = { name: '', color: '#4361ee', description: '', category: '' };

export function Labels() {
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadFailure | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newLabel, setNewLabel] = useState(emptyLabel);
  const [formError, setFormError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editData, setEditData] = useState<{ name: string; color: string }>({ name: '', color: '#4361ee' });
  const [editError, setEditError] = useState<string | null>(null);
  const [editNameError, setEditNameError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Label | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const createNameRef = useRef<HTMLInputElement>(null);
  const editNameRef = useRef<HTMLInputElement>(null);
  const deleteModal = useModalFocus(Boolean(deleteTarget), () => { if (!deleting) closeDelete(); });

  const fetchLabels = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Label[]>('/labels');
      setLabels(Array.isArray(data) ? data : []);
      setLoadError(null);
    } catch (err) {
      setLoadError(loadFailureFrom(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchLabels(); }, [fetchLabels]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const openCreate = () => {
    setFormError(null);
    setNameError(null);
    setShowCreate(true);
  };

  const closeCreate = () => {
    if (saving) return;
    setShowCreate(false);
    setFormError(null);
    setNameError(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!newLabel.name.trim()) {
      setNameError('Informe o nome da label.');
      setFormError(null);
      createNameRef.current?.focus();
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await api.post('/labels', {
        ...newLabel,
        name: newLabel.name.trim(),
        description: newLabel.description.trim() || undefined,
        category: newLabel.category.trim() || undefined,
      });
      setNewLabel(emptyLabel);
      setShowCreate(false);
      setFeedback('Label criada.');
      await fetchLabels();
    } catch (err) {
      setFormError(messageFromError(err));
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (label: Label) => {
    setEditId(label.id);
    setEditData({ name: label.name, color: label.color });
    setEditError(null);
    setEditNameError(null);
  };

  const cancelEdit = () => {
    if (editSaving) return;
    setEditId(null);
    setEditError(null);
    setEditNameError(null);
  };

  const handleUpdate = async (id: string) => {
    if (editSaving) return;
    if (!editData.name.trim()) {
      setEditNameError('Informe o nome da label.');
      setEditError(null);
      editNameRef.current?.focus();
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      await api.put(`/labels/${id}`, { name: editData.name.trim(), color: editData.color });
      setEditId(null);
      setFeedback('Label atualizada.');
      await fetchLabels();
    } catch (err) {
      setEditError(messageFromError(err));
    } finally {
      setEditSaving(false);
    }
  };

  const requestDelete = (label: Label, trigger?: HTMLElement) => {
    deleteModal.rememberTrigger(trigger);
    setDeleteTarget(label);
    setDeleteError(null);
  };

  const closeDelete = () => {
    setDeleteTarget(null);
    setDeleteError(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.delete(`/labels/${deleteTarget.id}`);
      setFeedback(`Label “${deleteTarget.name}” excluída.`);
      closeDelete();
      await fetchLabels();
    } catch (err) {
      setDeleteError(messageFromError(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className={`labels-page ${deleteTarget ? 'has-modal' : ''}`} aria-busy={loading || undefined}>
      <div className="page-header">
        <h1><Icon name="labels" /> Labels</h1>
        <Button icon={showCreate ? 'close' : 'plus'} onClick={() => (showCreate ? closeCreate() : openCreate())}>
          {showCreate ? 'Cancelar' : 'Nova label'}
        </Button>
      </div>

      {feedback && (
        <div className="ui-alert ui-alert--success labels-feedback" role="status">
          <Icon name="check" size={18} />
          <span>{feedback}</span>
        </div>
      )}

      {showCreate && (
        <form className="create-form" onSubmit={handleCreate} noValidate>
          {formError && (
            <div className="ui-alert create-form-error" role="alert">
              <Icon name="warning" size={18} />
              <span>Não foi possível criar a label: {formError}. Os dados digitados foram mantidos.</span>
            </div>
          )}
          <div className="ui-field">
            <label className="ui-field__label" htmlFor="label-name">Nome *</label>
            <input
              ref={createNameRef}
              id="label-name"
              className="ui-input"
              maxLength={100}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'label-name-error' : undefined}
              value={newLabel.name}
              onChange={e => { setNewLabel({ ...newLabel, name: e.target.value }); setNameError(null); }}
            />
            {nameError && <p id="label-name-error" className="ui-field__error" role="alert">{nameError}</p>}
          </div>
          <div className="ui-field color-field">
            <label className="ui-field__label" htmlFor="label-color">Cor</label>
            <input aria-label="Cor da label" id="label-color" type="color" value={newLabel.color} onChange={e => setNewLabel({ ...newLabel, color: e.target.value })} className="color-picker" />
          </div>
          <div className="ui-field">
            <label className="ui-field__label" htmlFor="label-category">Categoria (opcional)</label>
            <input id="label-category" className="ui-input" value={newLabel.category} onChange={e => setNewLabel({ ...newLabel, category: e.target.value })} />
          </div>
          <div className="ui-field">
            <label className="ui-field__label" htmlFor="label-description">Descrição (opcional)</label>
            <input id="label-description" className="ui-input" value={newLabel.description} onChange={e => setNewLabel({ ...newLabel, description: e.target.value })} />
          </div>
          <Button type="submit" loading={saving}>{saving ? 'Criando…' : 'Criar'}</Button>
        </form>
      )}

      {loading ? (
        <LoadingState label="Carregando labels…" />
      ) : loadError ? (
        <ErrorState
          title={loadError.title}
          message={loadError.message}
          onRetry={loadError.retryable ? () => { void fetchLabels(); } : undefined}
        />
      ) : labels.length === 0 ? (
        <EmptyState
          title="Nenhuma label cadastrada"
          description="Crie a primeira label para classificar conversas e tarefas."
          icon="labels"
          action={<Button size="sm" icon="plus" onClick={openCreate}>Nova label</Button>}
        />
      ) : (
        <div className="labels-grid">
          {labels.map(label => (
            <div key={label.id} className="label-card" style={{ borderLeftColor: label.color }}>
              {editId === label.id ? (
                <div className="label-edit">
                  {editError && (
                    <div className="ui-alert" role="alert">
                      <Icon name="warning" size={18} />
                      <span>Não foi possível salvar a label: {editError}. Os dados foram mantidos.</span>
                    </div>
                  )}
                  <div className="ui-field">
                    <label className="ui-field__label" htmlFor={`label-edit-name-${label.id}`}>Nome *</label>
                    <input
                      ref={editNameRef}
                      id={`label-edit-name-${label.id}`}
                      className="ui-input"
                      maxLength={100}
                      aria-invalid={editNameError ? true : undefined}
                      aria-describedby={editNameError ? `label-edit-error-${label.id}` : undefined}
                      value={editData.name}
                      onChange={e => { setEditData({ ...editData, name: e.target.value }); setEditNameError(null); }}
                    />
                    {editNameError && <p id={`label-edit-error-${label.id}`} className="ui-field__error" role="alert">{editNameError}</p>}
                  </div>
                  <div className="ui-field color-field">
                    <label className="ui-field__label" htmlFor={`label-edit-color-${label.id}`}>Cor</label>
                    <input aria-label={`Cor da label ${label.name}`} id={`label-edit-color-${label.id}`} type="color" value={editData.color} onChange={e => setEditData({ ...editData, color: e.target.value })} className="color-picker-sm" />
                  </div>
                  <div className="edit-actions">
                    <Button size="sm" loading={editSaving} onClick={() => void handleUpdate(label.id)}>{editSaving ? 'Salvando…' : 'Salvar'}</Button>
                    <Button size="sm" variant="secondary" disabled={editSaving} onClick={cancelEdit}>Cancelar</Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="label-header">
                    <span className="label-swatch" style={{ background: label.color }} aria-hidden="true" />
                    <span className="label-name">{label.name}</span>
                    {label.isSystem && <Badge tone="info">Sistema</Badge>}
                  </div>
                  {label.category && <span className="label-category">{label.category}</span>}
                  {label.description && <p className="label-desc">{label.description}</p>}
                  <div className="label-actions">
                    {!label.isSystem && (
                      <>
                        <Button size="sm" variant="ghost" icon="settings" aria-label={`Editar label ${label.name}`} onClick={() => startEdit(label)} />
                        <Button size="sm" variant="ghost" icon="close" aria-label={`Excluir label ${label.name}`} onClick={(event) => requestDelete(label, event.currentTarget)} />
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {deleteTarget && (
        <div className="labels-modal-backdrop" role="presentation" onMouseDown={() => { if (!deleting) closeDelete(); }}>
          <div
            ref={deleteModal.dialogRef}
            className="labels-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="label-delete-title"
            aria-describedby="label-delete-description"
            tabIndex={-1}
            onMouseDown={event => event.stopPropagation()}
          >
            <h3 id="label-delete-title">Excluir label</h3>
            <p id="label-delete-description">
              Excluir a label “{deleteTarget.name}”? Conversas e tarefas deixarão de exibi-la. Esta ação não pode ser desfeita.
            </p>
            {deleteError && (
              <div className="ui-alert" role="alert">
                <Icon name="warning" size={18} />
                <span>Não foi possível excluir a label: {deleteError}</span>
              </div>
            )}
            <div className="labels-modal-actions">
              <Button variant="secondary" disabled={deleting} onClick={closeDelete}>Cancelar</Button>
              <Button variant="danger" loading={deleting} onClick={() => void confirmDelete()}>{deleting ? 'Excluindo…' : 'Excluir'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
