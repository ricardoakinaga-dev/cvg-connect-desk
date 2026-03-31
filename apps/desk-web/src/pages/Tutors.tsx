import { useState, useEffect, useCallback } from 'react';
import { tutorApi, type Tutor } from '../lib/api';
import './shared.css';

export function Tutors() {
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Tutor | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const [saving, setSaving] = useState(false);
  const [selectedTutor, setSelectedTutor] = useState<Tutor | null>(null);

  const fetchTutors = useCallback(async () => {
    try {
      const data = await tutorApi.list(search || undefined);
      setTutors(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { fetchTutors(); }, [fetchTutors]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', phone: '', email: '' });
    setShowForm(true);
  };

  const openEdit = (tutor: Tutor) => {
    setEditing(tutor);
    setForm({ name: tutor.name, phone: tutor.phone || '', email: tutor.email || '' });
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try {
      if (editing) {
        await tutorApi.update(editing.id, form);
      } else {
        await tutorApi.create(form);
      }
      setShowForm(false);
      fetchTutors();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este tutor?')) return;
    try {
      await tutorApi.delete(id);
      fetchTutors();
      if (selectedTutor?.id === id) setSelectedTutor(null);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const viewDetails = async (tutor: Tutor) => {
    try {
      const details = await tutorApi.get(tutor.id);
      setSelectedTutor(details);
    } catch (err) {
      console.error(err);
    }
  };

  const formatPhone = (p: string | null) => {
    if (!p) return '';
    const c = p.replace(/\D/g, '');
    if (c.length === 11) return `+55 ${c.slice(0, 2)} ${c.slice(2, 7)}-${c.slice(7)}`;
    return p;
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>👨‍👩‍👦 Tutores</h1>
        <div className="page-actions">
          <input
            className="page-search"
            placeholder="🔍 Buscar por nome, telefone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="btn-primary" onClick={openCreate}>＋ Novo Tutor</button>
        </div>
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2>{editing ? 'Editar Tutor' : 'Novo Tutor'}</h2>
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label>Nome *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required autoFocus />
              </div>
              <div className="form-group">
                <label>Telefone</label>
                <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+55 11 99999-9999" />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
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
      {selectedTutor && (
        <div className="detail-panel">
          <div className="detail-header">
            <h2>{selectedTutor.name}</h2>
            <button className="btn-close" onClick={() => setSelectedTutor(null)}>✕</button>
          </div>
          <div className="detail-info">
            {selectedTutor.phone && <p>📞 {formatPhone(selectedTutor.phone)}</p>}
            {selectedTutor.email && <p>✉️ {selectedTutor.email}</p>}
            <p>💬 Conversas: {selectedTutor.conversationCount || 0}</p>
          </div>
          {selectedTutor.patients && selectedTutor.patients.length > 0 && (
            <div className="detail-section">
              <h3>🐾 Pacientes</h3>
              {selectedTutor.patients.map(p => (
                <div key={p.id} className="detail-item">
                  <span>{p.name}</span>
                  <span className="badge">{p.species || '—'} {p.breed ? `· ${p.breed}` : ''}</span>
                </div>
              ))}
            </div>
          )}
          <div className="detail-actions">
            <button className="btn-secondary" onClick={() => openEdit(selectedTutor)}>✏️ Editar</button>
            <button className="btn-danger" onClick={() => handleDelete(selectedTutor.id)}>🗑️ Excluir</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="page-table-wrapper">
        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : tutors.length === 0 ? (
          <div className="empty-state">
            <span>👨‍👩‍👦</span>
            <p>Nenhum tutor cadastrado</p>
            <button className="btn-primary" onClick={openCreate}>Cadastrar primeiro tutor</button>
          </div>
        ) : (
          <table className="page-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Telefone</th>
                <th>Email</th>
                <th>Criado em</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {tutors.map(t => (
                <tr key={t.id} onClick={() => viewDetails(t)} className="clickable-row">
                  <td className="cell-name">{t.name}</td>
                  <td>{formatPhone(t.phone)}</td>
                  <td>{t.email || '—'}</td>
                  <td>{new Date(t.createdAt).toLocaleDateString('pt-BR')}</td>
                  <td className="cell-actions">
                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); openEdit(t); }} title="Editar">✏️</button>
                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }} title="Excluir">🗑️</button>
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
