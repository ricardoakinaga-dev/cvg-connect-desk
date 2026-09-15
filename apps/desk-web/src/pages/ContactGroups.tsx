import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Badge, Button, EmptyState, ErrorState, Icon, LoadingState } from '../components/ui';
import { useModalFocus } from '../hooks/useModalFocus';
import './ContactGroups.css';

interface ContactGroup {
  id: string;
  name: string;
  description: string | null;
  groupType: string;
  color: string;
  icon: string;
  memberCount: number;
}

interface GroupMember {
  id: string;
  contactId: string;
  contactName: string | null;
  contactPhone: string | null;
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
    return { title: 'Acesso negado', message: 'Você não tem permissão para ver os grupos de contatos.', retryable: false };
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

const emptyGroup = { name: '', description: '', groupType: 'custom', color: '#6b7280', icon: '👥' };

export function ContactGroups() {
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadFailure | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newGroup, setNewGroup] = useState(emptyGroup);
  const [formError, setFormError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<LoadFailure | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContactGroup | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const memberRequest = useRef(0);
  const deleteModal = useModalFocus(Boolean(deleteTarget), () => { if (!deleting) closeDelete(); });

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<ContactGroup[]>('/contact-groups');
      setGroups(Array.isArray(data) ? data : []);
      setLoadError(null);
    } catch (err) {
      setLoadError(loadFailureFrom(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMembers = useCallback(async (groupId: string) => {
    const requestId = memberRequest.current + 1;
    memberRequest.current = requestId;
    setMembersLoading(true);
    setMembersError(null);
    try {
      const data = await api.get<GroupMember[]>(`/contact-groups/${groupId}/members`);
      if (memberRequest.current !== requestId) return;
      setMembers(Array.isArray(data) ? data : []);
    } catch (err) {
      if (memberRequest.current !== requestId) return;
      setMembers([]);
      setMembersError(loadFailureFrom(err));
    } finally {
      if (memberRequest.current === requestId) setMembersLoading(false);
    }
  }, []);

  useEffect(() => { void fetchGroups(); }, [fetchGroups]);

  useEffect(() => {
    if (selectedGroup) {
      void fetchMembers(selectedGroup);
    } else {
      memberRequest.current += 1;
      setMembers([]);
      setMembersError(null);
      setMembersLoading(false);
    }
  }, [selectedGroup, fetchMembers]);

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
    if (!newGroup.name.trim()) {
      setNameError('Informe o nome do grupo.');
      setFormError(null);
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await api.post('/contact-groups', {
        ...newGroup,
        name: newGroup.name.trim(),
        description: newGroup.description.trim() || undefined,
      });
      setNewGroup(emptyGroup);
      setShowCreate(false);
      setFeedback('Grupo criado.');
      await fetchGroups();
    } catch (err) {
      setFormError(messageFromError(err));
    } finally {
      setSaving(false);
    }
  };

  const requestDelete = (group: ContactGroup, trigger?: HTMLElement) => {
    deleteModal.rememberTrigger(trigger);
    setDeleteTarget(group);
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
      const deletedId = deleteTarget.id;
      await api.delete(`/contact-groups/${deletedId}`);
      if (selectedGroup === deletedId) setSelectedGroup(null);
      setFeedback(`Grupo “${deleteTarget.name}” excluído.`);
      closeDelete();
      await fetchGroups();
    } catch (err) {
      setDeleteError(messageFromError(err));
    } finally {
      setDeleting(false);
    }
  };

  const typeLabel = (type: string) => {
    const map: Record<string, string> = { internal: 'Interno', external: 'Externo', mixed: 'Misto', sector: 'Setor', custom: 'Custom' };
    return map[type] || type;
  };

  const iconOptions: Array<{ value: string; label: string }> = [
    { value: '👥', label: 'Equipe' }, { value: '👤', label: 'Pessoa' },
    { value: '🐕', label: 'Cães' }, { value: '🐈', label: 'Gatos' },
    { value: '🏥', label: 'Clínica' }, { value: '💼', label: 'Trabalho' },
    { value: '⭐', label: 'Destaque' }, { value: '🔑', label: 'Acesso' },
  ];

  const selectedGroupData = groups.find(group => group.id === selectedGroup) || null;
  const selectedMemberCount = selectedGroupData ? selectedGroupData.memberCount : members.length;

  return (
    <div className={`contact-groups-page ${selectedGroup ? 'has-selection' : ''}`} aria-busy={loading || undefined}>
      <div className="page-header">
        <h1><Icon name="groups" /> Grupos de contatos</h1>
        <Button icon={showCreate ? 'close' : 'plus'} onClick={() => (showCreate ? closeCreate() : openCreate())}>
          {showCreate ? 'Cancelar' : 'Novo grupo'}
        </Button>
      </div>

      {feedback && (
        <div className="ui-alert ui-alert--success groups-feedback" role="status">
          <Icon name="check" size={18} />
          <span>{feedback}</span>
        </div>
      )}

      {showCreate && (
        <form className="create-form" onSubmit={handleCreate} noValidate>
          {formError && (
            <div className="ui-alert create-form-error" role="alert">
              <Icon name="warning" size={18} />
              <span>Não foi possível criar o grupo: {formError}. Os dados digitados foram mantidos.</span>
            </div>
          )}
          <div className="ui-field">
            <label className="ui-field__label" htmlFor="group-name">Nome *</label>
            <input
              ref={nameRef}
              id="group-name"
              className="ui-input"
              maxLength={100}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'group-name-error' : undefined}
              value={newGroup.name}
              onChange={e => { setNewGroup({ ...newGroup, name: e.target.value }); setNameError(null); }}
            />
            {nameError && <p id="group-name-error" className="ui-field__error" role="alert">{nameError}</p>}
          </div>
          <div className="ui-field">
            <label className="ui-field__label" htmlFor="group-type">Tipo</label>
            <select id="group-type" className="ui-input" value={newGroup.groupType} onChange={e => setNewGroup({ ...newGroup, groupType: e.target.value })}>
              <option value="custom">Custom</option>
              <option value="internal">Interno (Colaboradores)</option>
              <option value="external">Externo (Tutores)</option>
              <option value="mixed">Misto</option>
            </select>
          </div>
          <div className="ui-field icon-field">
            <span className="ui-field__label" id="group-icon-label">Ícone</span>
            <div className="icon-picker" role="group" aria-labelledby="group-icon-label">
              {iconOptions.map(option => (
                <button
                  key={option.value}
                  aria-label={`Ícone ${option.label}`}
                  aria-pressed={newGroup.icon === option.value}
                  title={option.label}
                  type="button"
                  className={`icon-opt ${newGroup.icon === option.value ? 'sel' : ''}`}
                  onClick={() => setNewGroup({ ...newGroup, icon: option.value })}
                >
                  <span aria-hidden="true">{option.value}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="ui-field color-field">
            <label className="ui-field__label" htmlFor="group-color">Cor</label>
            <input aria-label="Cor do grupo" id="group-color" type="color" value={newGroup.color} onChange={e => setNewGroup({ ...newGroup, color: e.target.value })} className="color-input" />
          </div>
          <div className="ui-field description-field">
            <label className="ui-field__label" htmlFor="group-description">Descrição (opcional)</label>
            <input id="group-description" className="ui-input" value={newGroup.description} onChange={e => setNewGroup({ ...newGroup, description: e.target.value })} />
          </div>
          <Button type="submit" loading={saving}>{saving ? 'Criando…' : 'Criar'}</Button>
        </form>
      )}

      {loading ? (
        <LoadingState label="Carregando grupos…" />
      ) : loadError ? (
        <ErrorState
          title={loadError.title}
          message={loadError.message}
          onRetry={loadError.retryable ? () => { void fetchGroups(); } : undefined}
        />
      ) : groups.length === 0 ? (
        <EmptyState
          title="Nenhum grupo criado"
          description="Crie o primeiro grupo para organizar contatos por equipe, clínica ou assunto."
          icon="groups"
          action={<Button size="sm" icon="plus" onClick={openCreate}>Novo grupo</Button>}
        />
      ) : (
        <div className="groups-layout">
          <div className="groups-list">
            {groups.map(group => (
              <div
                key={group.id}
                className={`group-card ${selectedGroup === group.id ? 'selected' : ''}`}
                style={{ borderLeftColor: group.color }}
              >
                <button
                  type="button"
                  className="group-select"
                  aria-pressed={selectedGroup === group.id}
                  onClick={() => setSelectedGroup(group.id)}
                >
                  <span className="group-icon" aria-hidden="true">{group.icon}</span>
                  <span className="group-info">
                    <span className="group-name">{group.name}</span>
                    <span className="group-meta">
                      <span className="group-type">{typeLabel(group.groupType)}</span>
                      <span className="group-count">{group.memberCount} {group.memberCount === 1 ? 'membro' : 'membros'}</span>
                    </span>
                  </span>
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="close"
                  aria-label={`Excluir grupo ${group.name}`}
                  onClick={(event) => requestDelete(group, event.currentTarget)}
                />
              </div>
            ))}
          </div>

          <div className="group-detail">
            {selectedGroup ? (
              <>
                <div className="group-detail-header">
                  <button type="button" className="groups-mobile-back" aria-label="Voltar para grupos" onClick={() => setSelectedGroup(null)}><Icon name="back" size={18} /></button>
                  <h3>{selectedGroupData?.name || 'Membros do grupo'}</h3>
                  <Badge tone="neutral">{selectedMemberCount} {selectedMemberCount === 1 ? 'membro' : 'membros'}</Badge>
                </div>
                {membersLoading ? (
                  <LoadingState label="Carregando membros…" />
                ) : membersError ? (
                  <ErrorState
                    title={membersError.title}
                    message={membersError.message}
                    onRetry={membersError.retryable ? () => { void fetchMembers(selectedGroup); } : undefined}
                  />
                ) : members.length > 0 ? (
                  <div className="members-list">
                    {members.map(m => (
                      <div key={m.id} className="member-card">
                        <span className="member-name">{m.contactName || 'Sem nome'}</span>
                        <span className="member-phone">{m.contactPhone || '—'}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="Nenhum membro neste grupo"
                    description="Adicione contatos ao grupo pela ficha do contato."
                    icon="contacts"
                  />
                )}
              </>
            ) : (
              <EmptyState
                title="Selecione um grupo"
                description="Escolha um grupo na lista para ver os membros."
                icon="groups"
              />
            )}
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="groups-modal-backdrop" role="presentation" onMouseDown={() => { if (!deleting) closeDelete(); }}>
          <div
            ref={deleteModal.dialogRef}
            className="groups-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-delete-title"
            aria-describedby="group-delete-description"
            tabIndex={-1}
            onMouseDown={event => event.stopPropagation()}
          >
            <h3 id="group-delete-title">Excluir grupo</h3>
            <p id="group-delete-description">
              Excluir o grupo “{deleteTarget.name}”? Os contatos permanecem cadastrados. Esta ação não pode ser desfeita.
            </p>
            {deleteError && (
              <div className="ui-alert" role="alert">
                <Icon name="warning" size={18} />
                <span>Não foi possível excluir o grupo: {deleteError}</span>
              </div>
            )}
            <div className="groups-modal-actions">
              <Button variant="secondary" disabled={deleting} onClick={closeDelete}>Cancelar</Button>
              <Button variant="danger" loading={deleting} onClick={() => void confirmDelete()}>{deleting ? 'Excluindo…' : 'Excluir'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
