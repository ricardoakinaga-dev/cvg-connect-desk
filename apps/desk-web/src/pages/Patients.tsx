import { useState, useEffect, useCallback } from 'react';
import { patientApi, tutorApi, type Patient, type Tutor } from '../lib/api';
import './shared.css';

export function Patients() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [speciesFilter, setSpeciesFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [form, setForm] = useState({ name: '', species: '', breed: '', tutorId: '' });
  const [saving, setSaving] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  const fetchPatients = useCallback(async () => {
    try {
      const data = await patientApi.list({ search: search || undefined, species: speciesFilter || undefined });
      setPatients(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [search, speciesFilter]);

  useEffect(() => { fetchPatients(); }, [fetchPatients]);
  useEffect(() => { tutorApi.list().then(setTutors).catch(() => {}); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', species: '', breed: '', tutorId: '' });
    setShowForm(true);
  };

  const openEdit = (patient: Patient) => {
    setEditing(patient);
    setForm({
      name: patient.name,
      species: patient.species || '',
      breed: patient.breed || '',
      tutorId: patient.tutorId || '',
    });
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try {
      const data = {
        name: form.name,
        species: form.species || undefined,
        breed: form.breed || undefined,
        tutorId: form.tutorId || undefined,
      };
      if (editing) {
        await patientApi.update(editing.id, data);
      } else {
        await patientApi.create(data);
      }
      setShowForm(false);
      fetchPatients();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este paciente?')) return;
    try {
      await patientApi.delete(id);
      fetchPatients();
      if (selectedPatient?.id === id) setSelectedPatient(null);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const viewDetails = async (patient: Patient) => {
    try {
      const details = await patientApi.get(patient.id);
      setSelectedPatient(details);
    } catch (err) {
      console.error(err);
    }
  };

  const speciesIcon = (s: string | null) => {
    if (!s) return '🐾';
    const lower = s.toLowerCase();
    if (lower.includes('cachorro') || lower.includes('cão') || lower.includes('dog')) return '🐕';
    if (lower.includes('gato') || lower.includes('cat')) return '🐱';
    if (lower.includes('pássaro') || lower.includes('ave') || lower.includes('bird')) return '🐦';
    if (lower.includes('coelho') || lower.includes('rabbit')) return '🐰';
    return '🐾';
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>🐾 Pacientes</h1>
        <div className="page-actions">
          <input
            className="page-search"
            placeholder="🔍 Buscar por nome, espécie..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className="page-filter" value={speciesFilter} onChange={e => setSpeciesFilter(e.target.value)}>
            <option value="">Todas espécies</option>
            <option value="cachorro">🐕 Cachorro</option>
            <option value="gato">🐱 Gato</option>
            <option value="pássaro">🐦 Pássaro</option>
            <option value="coelho">🐰 Coelho</option>
          </select>
          <button className="btn-primary" onClick={openCreate}>＋ Novo Paciente</button>
        </div>
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2>{editing ? 'Editar Paciente' : 'Novo Paciente'}</h2>
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label>Nome do Pet *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required autoFocus />
              </div>
              <div className="form-group">
                <label>Espécie</label>
                <select value={form.species} onChange={e => setForm({ ...form, species: e.target.value })}>
                  <option value="">Selecione...</option>
                  <option value="Cachorro">🐕 Cachorro</option>
                  <option value="Gato">🐱 Gato</option>
                  <option value="Pássaro">🐦 Pássaro</option>
                  <option value="Coelho">🐰 Coelho</option>
                  <option value="Outro">🐾 Outro</option>
                </select>
              </div>
              <div className="form-group">
                <label>Raça</label>
                <input value={form.breed} onChange={e => setForm({ ...form, breed: e.target.value })} placeholder="Ex: Labrador, SRD, Persa..." />
              </div>
              <div className="form-group">
                <label>Tutor</label>
                <select value={form.tutorId} onChange={e => setForm({ ...form, tutorId: e.target.value })}>
                  <option value="">Selecione um tutor...</option>
                  {tutors.map(t => (
                    <option key={t.id} value={t.id}>{t.name} {t.phone ? `(${t.phone})` : ''}</option>
                  ))}
                </select>
              </div>
              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail panel */}
      {selectedPatient && (
        <div className="detail-panel">
          <div className="detail-header">
            <h2>{speciesIcon(selectedPatient.species)} {selectedPatient.name}</h2>
            <button className="btn-close" onClick={() => setSelectedPatient(null)}>✕</button>
          </div>
          <div className="detail-info">
            <p>🐾 Espécie: {selectedPatient.species || 'Não informada'}</p>
            <p>🏷️ Raça: {selectedPatient.breed || 'Não informada'}</p>
            {selectedPatient.tutor && (
              <p>👨‍👩‍👦 Tutor: {selectedPatient.tutor.name}</p>
            )}
            <p>💬 Conversas: {selectedPatient.conversationCount || 0}</p>
            <p>📋 Tarefas: {selectedPatient.taskCount || 0}</p>
          </div>
          <div className="detail-actions">
            <button className="btn-secondary" onClick={() => openEdit(selectedPatient)}>✏️ Editar</button>
            <button className="btn-danger" onClick={() => handleDelete(selectedPatient.id)}>🗑️ Excluir</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="page-table-wrapper">
        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : patients.length === 0 ? (
          <div className="empty-state">
            <span>🐾</span>
            <p>Nenhum paciente cadastrado</p>
            <button className="btn-primary" onClick={openCreate}>Cadastrar primeiro paciente</button>
          </div>
        ) : (
          <table className="page-table">
            <thead>
              <tr>
                <th>Pet</th>
                <th>Espécie</th>
                <th>Raça</th>
                <th>Tutor</th>
                <th>Criado em</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {patients.map(p => (
                <tr key={p.id} onClick={() => viewDetails(p)} className="clickable-row">
                  <td className="cell-name">{speciesIcon(p.species)} {p.name}</td>
                  <td>{p.species || '—'}</td>
                  <td>{p.breed || '—'}</td>
                  <td>{p.tutor?.name || '—'}</td>
                  <td>{new Date(p.createdAt).toLocaleDateString('pt-BR')}</td>
                  <td className="cell-actions">
                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); openEdit(p); }} title="Editar">✏️</button>
                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }} title="Excluir">🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
