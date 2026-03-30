import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import './Labels.css';

interface Label {
  id: string;
  name: string;
  color: string;
  description: string | null;
  category: string | null;
  isSystem: boolean;
}

export function Labels() {
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newLabel, setNewLabel] = useState({ name: '', color: '#4361ee', description: '', category: '' });
  const [editId, setEditId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Label>>({});

  const fetchLabels = async () => {
    try {
      const data = await api.get<Label[]>('/labels');
      setLabels(data);
    } catch (err) {
      console.error('Erro ao carregar labels:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLabels(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabel.name.trim()) return;
    try {
      await api.post('/labels', newLabel);
      setNewLabel({ name: '', color: '#4361ee', description: '', category: '' });
      setShowCreate(false);
      fetchLabels();
    } catch (err) {
      console.error('Erro ao criar label:', err);
    }
  };

  const handleUpdate = async (id: string) => {
    try {
      await api.put(`/labels/${id}`, editData);
      setEditId(null);
      setEditData({});
      fetchLabels();
    } catch (err) {
      console.error('Erro ao atualizar label:', err);
    }
  };

  const handleDelete = async (id: string, isSystem: boolean) => {
    if (isSystem) return alert('Labels do sistema não podem ser deletadas.');
    if (!confirm('Deseja realmente excluir esta label?')) return;
    try {
      await api.delete(`/labels/${id}`);
      fetchLabels();
    } catch (err: any) {
      alert(err.message || 'Erro ao deletar label');
    }
  };

  const categories = [...new Set(labels.map(l => l.category).filter(Boolean))];

  return (
    <div className="labels-page">
      <div className="page-header">
        <h2>🏷️ Labels</h2>
        <button className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? '✕ Cancelar' : '+ Nova Label'}
        </button>
      </div>

      {showCreate && (
        <form className="create-form" onSubmit={handleCreate}>
          <input placeholder="Nome da label" value={newLabel.name} onChange={e => setNewLabel({ ...newLabel, name: e.target.value })} required />
          <input type="color" value={newLabel.color} onChange={e => setNewLabel({ ...newLabel, color: e.target.value })} className="color-picker" />
          <input placeholder="Categoria (opcional)" value={newLabel.category} onChange={e => setNewLabel({ ...newLabel, category: e.target.value })} />
          <input placeholder="Descrição (opcional)" value={newLabel.description} onChange={e => setNewLabel({ ...newLabel, description: e.target.value })} />
          <button type="submit" className="btn-primary">Criar</button>
        </form>
      )}

      {loading ? (
        <div className="loading">Carregando labels...</div>
      ) : (
        <div className="labels-grid">
          {labels.map(label => (
            <div key={label.id} className="label-card" style={{ borderLeftColor: label.color }}>
              {editId === label.id ? (
                <div className="label-edit">
                  <input value={editData.name || ''} onChange={e => setEditData({ ...editData, name: e.target.value })} />
                  <input type="color" value={editData.color || '#6b7280'} onChange={e => setEditData({ ...editData, color: e.target.value })} className="color-picker-sm" />
                  <div className="edit-actions">
                    <button className="btn-save" onClick={() => handleUpdate(label.id)}>Salvar</button>
                    <button className="btn-cancel" onClick={() => setEditId(null)}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="label-header">
                    <span className="label-badge" style={{ background: label.color }}>{label.name}</span>
                    {label.isSystem && <span className="system-badge">Sistema</span>}
                  </div>
                  {label.category && <span className="label-category">{label.category}</span>}
                  {label.description && <p className="label-desc">{label.description}</p>}
                  <div className="label-actions">
                    {!label.isSystem && (
                      <>
                        <button className="btn-edit-sm" onClick={() => { setEditId(label.id); setEditData({ name: label.name, color: label.color }); }}>✏️</button>
                        <button className="btn-delete-sm" onClick={() => handleDelete(label.id, label.isSystem)}>🗑️</button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
