import { useCallback, useEffect, useState } from 'react';
import { patientApi, tutorApi, type Patient, type Tutor } from '../lib/api';
import './EntityPages.css';

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
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
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', species: '', breed: '', tutorId: '' });

  const loadPatients = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const data = await patientApi.list({ search: search || undefined, species: species || undefined });
      if (!signal?.aborted) { setPatients(data); setError(null); }
    } catch (loadError) {
      if (!signal?.aborted) setError(messageFromError(loadError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [search, species]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void loadPatients(controller.signal); }, 220);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [loadPatients]);

  useEffect(() => { void tutorApi.list().then(setTutors).catch((loadError) => setError(messageFromError(loadError))); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', species: '', breed: '', tutorId: '' });
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (patient: Patient) => {
    setEditing(patient);
    setForm({ name: patient.name, species: patient.species || '', breed: patient.breed || '', tutorId: patient.tutorId || '' });
    setError(null);
    setModalOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const data = { name: form.name.trim(), species: form.species || undefined, breed: form.breed || undefined, tutorId: form.tutorId || undefined };
      if (editing) await patientApi.update(editing.id, { ...data, species: data.species || null, breed: data.breed || null, tutorId: data.tutorId || null });
      else await patientApi.create(data);
      setModalOpen(false);
      await loadPatients();
    } catch (saveError) {
      setError(messageFromError(saveError));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (patient: Patient) => {
    if (!window.confirm(`Excluir o paciente “${patient.name}”?`)) return;
    setError(null);
    try {
      await patientApi.delete(patient.id);
      if (selected?.id === patient.id) setSelected(null);
      await loadPatients();
    } catch (removeError) {
      setError(messageFromError(removeError));
    }
  };

  const showDetails = async (patient: Patient) => {
    setSelected(patient);
    try {
      const details = await patientApi.get(patient.id);
      setSelected(details);
    } catch (detailError) {
      setError(messageFromError(detailError));
    }
  };

  return (
    <div className="entity-page">
      <header className="entity-header">
        <div className="entity-title">
          <h2>Pacientes</h2>
          <p>Organize pets, espécies e o responsável por cada atendimento.</p>
        </div>
        <div className="entity-actions">
          <input className="entity-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou espécie" aria-label="Buscar pacientes" />
          <select className="entity-select" value={species} onChange={(event) => setSpecies(event.target.value)} aria-label="Filtrar espécie"><option value="">Todas as espécies</option><option value="cachorro">Cachorro</option><option value="gato">Gato</option><option value="pássaro">Pássaro</option><option value="coelho">Coelho</option></select>
          <button className="entity-button primary" type="button" onClick={openCreate}>+ Novo paciente</button>
        </div>
      </header>

      {error && <div className="entity-error" role="alert">{error}</div>}

      <div className="entity-layout">
        <section className="entity-card" aria-label="Lista de pacientes">
          {loading ? <div className="entity-loading">Carregando pacientes…</div> : patients.length === 0 ? (
            <div className="entity-empty"><strong>Nenhum paciente encontrado</strong><span>Cadastre o primeiro paciente para começar.</span></div>
          ) : (
            <div className="entity-table-wrap">
              <table className="entity-table">
                <thead><tr><th>Paciente</th><th>Espécie</th><th>Raça</th><th>Tutor</th><th>Ações</th></tr></thead>
                <tbody>
                  {patients.map((patient) => (
                    <tr key={patient.id} onClick={() => void showDetails(patient)}>
                      <td className="primary-cell">{speciesIcon(patient.species)} {patient.name}</td>
                      <td>{patient.species || '—'}</td>
                      <td className="muted">{patient.breed || '—'}</td>
                      <td className="muted">{patient.tutor?.name || '—'}</td>
                      <td><div className="entity-row-actions"><button className="entity-row-action" type="button" title="Editar paciente" onClick={(event) => { event.stopPropagation(); openEdit(patient); }}>Editar</button><button className="entity-row-action danger" type="button" title="Excluir paciente" onClick={(event) => { event.stopPropagation(); void remove(patient); }}>Excluir</button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="entity-card entity-detail" aria-live="polite">
          {selected ? (
            <>
              <h3>{speciesIcon(selected.species)} {selected.name}</h3>
              <p className="entity-detail-subtitle">Ficha resumida do paciente</p>
              <dl className="entity-detail-list">
                <div><dt>Espécie</dt><dd>{selected.species || '—'}</dd></div>
                <div><dt>Raça</dt><dd>{selected.breed || '—'}</dd></div>
                <div><dt>Tutor</dt><dd>{selected.tutor?.name || '—'}</dd></div>
                <div><dt>Conversas</dt><dd>{selected.conversationCount ?? 0}</dd></div>
                <div><dt>Tarefas</dt><dd>{selected.taskCount ?? 0}</dd></div>
              </dl>
            </>
          ) : <div className="entity-empty"><strong>Selecione um paciente</strong><span>Os detalhes aparecerão aqui.</span></div>}
        </aside>
      </div>

      {modalOpen && <div className="entity-modal-backdrop" role="presentation" onMouseDown={() => !saving && setModalOpen(false)}>
        <div className="entity-modal" role="dialog" aria-modal="true" aria-labelledby="patient-form-title" onMouseDown={(event) => event.stopPropagation()}>
          <h3 id="patient-form-title">{editing ? 'Editar paciente' : 'Novo paciente'}</h3>
          <form className="entity-form" onSubmit={save}>
            <label>Nome do paciente *<input autoFocus required maxLength={200} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>Espécie<select value={form.species} onChange={(event) => setForm({ ...form, species: event.target.value })}><option value="">Selecione…</option><option value="Cachorro">Cachorro</option><option value="Gato">Gato</option><option value="Pássaro">Pássaro</option><option value="Coelho">Coelho</option><option value="Outro">Outro</option></select></label>
            <label>Raça<input maxLength={200} value={form.breed} onChange={(event) => setForm({ ...form, breed: event.target.value })} /></label>
            <label>Tutor<select value={form.tutorId} onChange={(event) => setForm({ ...form, tutorId: event.target.value })}><option value="">Sem tutor vinculado</option>{tutors.map((tutor) => <option key={tutor.id} value={tutor.id}>{tutor.name}{tutor.phone ? ` · ${tutor.phone}` : ''}</option>)}</select></label>
            <div className="entity-form-actions"><button className="entity-button" type="button" disabled={saving} onClick={() => setModalOpen(false)}>Cancelar</button><button className="entity-button primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button></div>
          </form>
        </div>
      </div>}
    </div>
  );
}
