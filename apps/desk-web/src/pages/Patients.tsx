import { useCallback, useEffect, useRef, useState } from 'react';
import { patientApi, tutorApi, type Patient, type Tutor } from '../lib/api';
import { Badge, Button, EmptyState, ErrorState, Icon, LoadingState, TextField } from '../components/ui';
import { useModalFocus } from '../hooks/useModalFocus';
import './EntityPages.css';
import './Patients.css';

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
    return { title: 'Acesso negado', message: 'Você não tem permissão para ver os pacientes.', retryable: false };
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

function speciesIcon(species: string | null): string {
  const value = species?.toLowerCase() || '';
  if (value.includes('cachorro') || value.includes('cão') || value.includes('dog')) return '🐕';
  if (value.includes('gato') || value.includes('cat')) return '🐈';
  if (value.includes('ave') || value.includes('pássaro') || value.includes('bird')) return '🐦';
  if (value.includes('coelho') || value.includes('rabbit')) return '🐇';
  return '🐾';
}

export function Patients() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [search, setSearch] = useState('');
  const [species, setSpecies] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState<LoadFailure | null>(null);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [tutorsLoading, setTutorsLoading] = useState(true);
  const [tutorsError, setTutorsError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', species: '', breed: '', tutorId: '' });
  const nameInputRef = useRef<HTMLInputElement>(null);
  const modal = useModalFocus(modalOpen, () => !saving && setModalOpen(false));

  const loadPatients = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const data = await patientApi.list({ search: search || undefined, species: species || undefined });
      if (!signal?.aborted) {
        setPatients(data);
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
  }, [search, species]);

  const loadTutorOptions = useCallback(async () => {
    setTutorsLoading(true);
    setTutorsError(null);
    try {
      setTutors(await tutorApi.list());
    } catch (tutorFailure) {
      setTutorsError(messageFromError(tutorFailure));
    } finally {
      setTutorsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void loadPatients(controller.signal); }, 220);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [loadPatients]);

  useEffect(() => { void loadTutorOptions(); }, [loadTutorOptions]);

  const openCreate = (trigger?: HTMLElement) => {
    modal.rememberTrigger(trigger);
    setEditing(null);
    setForm({ name: '', species: '', breed: '', tutorId: '' });
    setFormError(null);
    setNameError(null);
    if (tutorsError) void loadTutorOptions();
    setModalOpen(true);
  };

  const openEdit = (patient: Patient, trigger?: HTMLElement) => {
    modal.rememberTrigger(trigger);
    setEditing(patient);
    setForm({ name: patient.name, species: patient.species || '', breed: patient.breed || '', tutorId: patient.tutorId || '' });
    setFormError(null);
    setNameError(null);
    if (tutorsError) void loadTutorOptions();
    setModalOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!form.name.trim()) {
      setNameError('Informe o nome do paciente para salvar.');
      setFormError(null);
      nameInputRef.current?.focus();
      return;
    }
    setSaving(true);
    setFormError(null);
    setNameError(null);
    try {
      const data = { name: form.name.trim(), species: form.species || undefined, breed: form.breed || undefined, tutorId: form.tutorId || undefined };
      if (editing) await patientApi.update(editing.id, { ...data, species: data.species || null, breed: data.breed || null, tutorId: data.tutorId || null });
      else await patientApi.create(data);
      setModalOpen(false);
      setFeedback({ tone: 'success', message: editing ? 'Paciente atualizado.' : 'Paciente cadastrado.' });
      if (editing && selected?.id === editing.id) setSelected(null);
      await loadPatients();
    } catch (saveError) {
      setFormError(messageFromError(saveError));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (patient: Patient) => {
    if (!window.confirm(`Excluir o paciente “${patient.name}”?`)) return;
    setFeedback(null);
    try {
      await patientApi.delete(patient.id);
      if (selected?.id === patient.id) setSelected(null);
      setFeedback({ tone: 'success', message: 'Paciente excluído.' });
      await loadPatients();
    } catch (removeError) {
      setFeedback({ tone: 'error', message: `Não foi possível excluir: ${messageFromError(removeError)}` });
    }
  };

  const showDetails = async (patient: Patient) => {
    setSelected(patient);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const details = await patientApi.get(patient.id);
      setSelected(details);
    } catch (detailFailure) {
      setDetailError(messageFromError(detailFailure));
    } finally {
      setDetailLoading(false);
    }
  };

  const listIsEmpty = loadedOnce && !loadError && patients.length === 0;
  const tutorOptionsAvailable = tutors.length > 0;
  const currentTutorMissing = !!form.tutorId && !tutors.some((tutor) => tutor.id === form.tutorId);

  return (
    <div className={`entity-page ${selected ? 'has-selection' : ''}`}>
      <header className="entity-header">
        <div className="entity-title">
          <h1>Pacientes</h1>
          <p>Organize pets, espécies e o responsável por cada atendimento.</p>
        </div>
        <div className="entity-actions">
          <input className="entity-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou espécie" aria-label="Buscar pacientes" />
          <select className="entity-select" value={species} onChange={(event) => setSpecies(event.target.value)} aria-label="Filtrar espécie"><option value="">Todas as espécies</option><option value="cachorro">Cachorro</option><option value="gato">Gato</option><option value="pássaro">Pássaro</option><option value="coelho">Coelho</option></select>
          <Button icon="plus" onClick={(event) => openCreate(event.currentTarget)}>Novo paciente</Button>
        </div>
      </header>

      {feedback && (
        <div className={`ui-alert ${feedback.tone === 'error' ? '' : `ui-alert--${feedback.tone}`}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>
          <Icon name={feedback.tone === 'error' ? 'warning' : 'check'} size={18} />
          <span>{feedback.message}</span>
        </div>
      )}

      <div className="entity-layout">
        <section className="entity-card" aria-label="Lista de pacientes" aria-busy={loading || undefined}>
          {loading && !loadedOnce ? (
            <LoadingState label="Carregando pacientes…" />
          ) : loadError && patients.length === 0 ? (
            <ErrorState
              title={loadError.title}
              message={loadError.message}
              onRetry={loadError.retryable ? () => { void loadPatients(); } : undefined}
            />
          ) : listIsEmpty ? (
            <EmptyState
              title="Nenhum paciente encontrado"
              description={search || species ? 'Nenhum paciente corresponde aos filtros.' : 'Cadastre o primeiro paciente para começar.'}
              icon="patients"
              action={<Button icon="plus" size="sm" onClick={(event) => openCreate(event.currentTarget)}>Novo paciente</Button>}
            />
          ) : (
            <>
              {loadError && (
                <div className="ui-alert ui-alert--warning" role="alert">
                  <Icon name="warning" size={18} />
                  <span>{loadError.title}: {loadError.message}</span>
                  {loadError.retryable && <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void loadPatients(); }}>Tentar novamente</Button>}
                </div>
              )}
              <div className="entity-table-wrap">
                <table className="entity-table">
                  <thead><tr><th>Paciente</th><th>Espécie</th><th>Raça</th><th>Tutor</th><th>Ações</th></tr></thead>
                  <tbody>
                    {patients.map((patient) => (
                      <tr key={patient.id} className={selected?.id === patient.id ? 'selected' : ''} onClick={() => void showDetails(patient)}>
                        <td className="primary-cell">
                          <button type="button" className="entity-row-detail" onClick={(event) => { event.stopPropagation(); void showDetails(patient); }}>
                            <span aria-hidden="true">{speciesIcon(patient.species)}</span> {patient.name}
                          </button>
                        </td>
                        <td>{patient.species || '—'}</td>
                        <td className="muted">{patient.breed || '—'}</td>
                        <td className="muted">{patient.tutor?.name || '—'}</td>
                        <td><div className="entity-row-actions"><button className="entity-row-action" type="button" title={`Editar paciente ${patient.name}`} onClick={(event) => { event.stopPropagation(); openEdit(patient, event.currentTarget); }}>Editar</button><button className="entity-row-action danger" type="button" title={`Excluir paciente ${patient.name}`} onClick={(event) => { event.stopPropagation(); void remove(patient); }}>Excluir</button></div></td>
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
              <button type="button" className="entity-mobile-back" aria-label="Voltar para pacientes" onClick={() => { setSelected(null); setDetailError(null); }}><Icon name="back" size={18} /></button>
              <h3><span aria-hidden="true">{speciesIcon(selected.species)}</span> {selected.name}</h3>
              <p className="entity-detail-subtitle">Ficha resumida do paciente</p>
              {detailLoading && <LoadingState label="Carregando detalhes…" />}
              <dl className="entity-detail-list">
                <div><dt>Espécie</dt><dd>{selected.species || '—'}</dd></div>
                <div><dt>Raça</dt><dd>{selected.breed || '—'}</dd></div>
                <div><dt>Tutor</dt><dd>{selected.tutor?.name || '—'}</dd></div>
                <div><dt>Conversas</dt><dd>{selected.conversationCount ?? 0}</dd></div>
                <div><dt>Tarefas</dt><dd>{selected.taskCount ?? 0}</dd></div>
              </dl>
              <div className="entity-detail-section">
                <h4>Vínculo</h4>
                {selected.tutor ? (
                  <div className="entity-mini-item">
                    <span>{selected.tutor.name}</span>
                    <Badge tone="info">Responsável</Badge>
                  </div>
                ) : <span className="muted">Nenhum tutor vinculado.</span>}
              </div>
            </>
          ) : <EmptyState title="Selecione um paciente" description="Os detalhes aparecerão aqui." icon="patients" />}
        </aside>
      </div>

      {modalOpen && <div className="entity-modal-backdrop" role="presentation" onMouseDown={() => !saving && setModalOpen(false)}>
        <div ref={modal.dialogRef} className="entity-modal" role="dialog" aria-modal="true" aria-labelledby="patient-form-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
          <h3 id="patient-form-title">{editing ? 'Editar paciente' : 'Novo paciente'}</h3>
          {formError && (
            <div className="ui-alert" role="alert">
              <Icon name="warning" size={18} />
              <span>{formError}</span>
            </div>
          )}
          <form className="entity-form" onSubmit={save} noValidate>
            <TextField
              ref={nameInputRef}
              label="Nome do paciente *"
              maxLength={200}
              value={form.name}
              error={nameError || undefined}
              autoFocus
              onChange={(event) => { setForm({ ...form, name: event.target.value }); if (nameError) setNameError(null); }}
            />
            <label className="ui-field">
              <span className="ui-field__label">Espécie</span>
              <select className="ui-input" value={form.species} onChange={(event) => setForm({ ...form, species: event.target.value })}><option value="">Selecione…</option><option value="Cachorro">Cachorro</option><option value="Gato">Gato</option><option value="Pássaro">Pássaro</option><option value="Coelho">Coelho</option><option value="Outro">Outro</option></select>
            </label>
            <TextField label="Raça" maxLength={200} value={form.breed} onChange={(event) => setForm({ ...form, breed: event.target.value })} />
            <label className="ui-field">
              <span className="ui-field__label">Tutor</span>
              <select
                className="ui-input"
                value={form.tutorId}
                disabled={tutorsLoading || (!tutorOptionsAvailable && !currentTutorMissing)}
                onChange={(event) => setForm({ ...form, tutorId: event.target.value })}
              >
                {tutorsLoading && <option value="">Carregando tutores…</option>}
                {!tutorsLoading && !tutorOptionsAvailable && <option value="">Sem tutores disponíveis para vincular</option>}
                {!tutorsLoading && tutorOptionsAvailable && <option value="">Sem tutor vinculado</option>}
                {currentTutorMissing && <option value={form.tutorId}>Tutor vinculado atual</option>}
                {tutors.map((tutor) => <option key={tutor.id} value={tutor.id}>{tutor.name}{tutor.phone ? ` · ${tutor.phone}` : ''}</option>)}
              </select>
            </label>
            {tutorsError && (
              <div className="ui-alert ui-alert--warning" role="alert">
                <Icon name="warning" size={18} />
                <span>Não foi possível carregar a lista de tutores: {tutorsError}</span>
                <Button variant="secondary" size="sm" icon="refresh" onClick={() => { void loadTutorOptions(); }}>Tentar novamente</Button>
              </div>
            )}
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
