import { useCallback, useEffect, useState } from 'react';
import { tutorApi, type Tutor } from '../lib/api';
import './EntityPages.css';

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
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
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Tutor | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '' });

  const loadTutors = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const data = await tutorApi.list(search || undefined);
      if (!signal?.aborted) {
        setTutors(data);
        setError(null);
      }
    } catch (loadError) {
      if (!signal?.aborted) setError(messageFromError(loadError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void loadTutors(controller.signal); }, 220);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [loadTutors]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', phone: '', email: '' });
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (tutor: Tutor) => {
    setEditing(tutor);
    setForm({ name: tutor.name, phone: tutor.phone || '', email: tutor.email || '' });
    setError(null);
    setModalOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (editing) await tutorApi.update(editing.id, { name: form.name.trim(), phone: form.phone || null, email: form.email || null });
      else await tutorApi.create({ name: form.name.trim(), phone: form.phone || undefined, email: form.email || undefined });
      setModalOpen(false);
      await loadTutors();
    } catch (saveError) {
      setError(messageFromError(saveError));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (tutor: Tutor) => {
    if (!window.confirm(`Excluir o tutor “${tutor.name}”?`)) return;
    setError(null);
    try {
      await tutorApi.delete(tutor.id);
      if (selected?.id === tutor.id) setSelected(null);
      await loadTutors();
    } catch (removeError) {
      setError(messageFromError(removeError));
    }
  };

  const showDetails = async (tutor: Tutor) => {
    setSelected(tutor);
    try {
      const details = await tutorApi.get(tutor.id);
      setSelected(details);
    } catch (detailError) {
      setError(messageFromError(detailError));
    }
  };

  return (
    <div className="entity-page">
      <header className="entity-header">
        <div className="entity-title">
          <h2>Tutores</h2>
          <p>Cadastre responsáveis e acompanhe os vínculos da operação.</p>
        </div>
        <div className="entity-actions">
          <input className="entity-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou telefone" aria-label="Buscar tutores" />
          <button className="entity-button primary" type="button" onClick={openCreate}>+ Novo tutor</button>
        </div>
      </header>

      {error && <div className="entity-error" role="alert">{error}</div>}

      <div className="entity-layout">
        <section className="entity-card" aria-label="Lista de tutores">
          {loading ? <div className="entity-loading">Carregando tutores…</div> : tutors.length === 0 ? (
            <div className="entity-empty"><strong>Nenhum tutor encontrado</strong><span>Adicione o primeiro responsável para começar.</span></div>
          ) : (
            <div className="entity-table-wrap">
              <table className="entity-table">
                <thead><tr><th>Nome</th><th>Telefone</th><th>E-mail</th><th>Cadastro</th><th>Ações</th></tr></thead>
                <tbody>
                  {tutors.map((tutor) => (
                    <tr key={tutor.id} onClick={() => void showDetails(tutor)}>
                      <td className="primary-cell">{tutor.name}</td>
                      <td>{formatPhone(tutor.phone)}</td>
                      <td className="muted">{tutor.email || '—'}</td>
                      <td className="muted">{new Date(tutor.createdAt).toLocaleDateString('pt-BR')}</td>
                      <td>
                        <div className="entity-row-actions">
                          <button className="entity-row-action" type="button" title="Editar tutor" onClick={(event) => { event.stopPropagation(); openEdit(tutor); }}>Editar</button>
                          <button className="entity-row-action danger" type="button" title="Excluir tutor" onClick={(event) => { event.stopPropagation(); void remove(tutor); }}>Excluir</button>
                        </div>
                      </td>
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
              <h3>{selected.name}</h3>
              <p className="entity-detail-subtitle">Detalhes do responsável</p>
              <dl className="entity-detail-list">
                <div><dt>Telefone</dt><dd>{formatPhone(selected.phone)}</dd></div>
                <div><dt>E-mail</dt><dd>{selected.email || '—'}</dd></div>
                <div><dt>Conversas</dt><dd>{selected.conversationCount ?? 0}</dd></div>
                <div><dt>Tarefas</dt><dd>{selected.taskCount ?? 0}</dd></div>
              </dl>
              <div className="entity-detail-section">
                <h4>Pacientes vinculados</h4>
                {selected.patients?.length ? <div className="entity-mini-list">{selected.patients.map((patient) => <div className="entity-mini-item" key={patient.id}><span>{patient.name}</span><span className="entity-badge">{patient.species || 'Espécie não informada'}</span></div>)}</div> : <span className="muted">Nenhum paciente vinculado.</span>}
              </div>
            </>
          ) : <div className="entity-empty"><strong>Selecione um tutor</strong><span>Os detalhes e vínculos aparecerão aqui.</span></div>}
        </aside>
      </div>

      {modalOpen && <div className="entity-modal-backdrop" role="presentation" onMouseDown={() => !saving && setModalOpen(false)}>
        <div className="entity-modal" role="dialog" aria-modal="true" aria-labelledby="tutor-form-title" onMouseDown={(event) => event.stopPropagation()}>
          <h3 id="tutor-form-title">{editing ? 'Editar tutor' : 'Novo tutor'}</h3>
          <form className="entity-form" onSubmit={save}>
            <label>Nome *<input autoFocus required maxLength={200} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>Telefone<input maxLength={32} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="(11) 99999-0000" /></label>
            <label>E-mail<input type="email" maxLength={320} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
            <div className="entity-form-actions"><button className="entity-button" type="button" disabled={saving} onClick={() => setModalOpen(false)}>Cancelar</button><button className="entity-button primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button></div>
          </form>
        </div>
      </div>}
    </div>
  );
}
