import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import './Sectors.css';

interface Sector {
  id: string;
  name: string;
  code: string;
  description: string | null;
  color: string;
  icon: string;
  isActive: boolean;
  autoAssign: boolean;
  maxConcurrent: number;
}

export function Sectors() {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newSector, setNewSector] = useState({ name: '', code: '', description: '', color: '#4361ee', icon: '📋' });

  const fetchSectors = async () => {
    try {
      const data = await api.get<Sector[]>('/sectors?all=true');
      setSectors(data);
    } catch (err) {
      console.error('Erro ao carregar setores:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSectors(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSector.name.trim() || !newSector.code.trim()) return;
    try {
      await api.post('/sectors', newSector);
      setNewSector({ name: '', code: '', description: '', color: '#4361ee', icon: '📋' });
      setShowCreate(false);
      fetchSectors();
    } catch (err: any) {
      alert(err.message || 'Erro ao criar setor');
    }
  };

  const handleToggleActive = async (sector: Sector) => {
    try {
      await api.put(`/sectors/${sector.id}`, { isActive: !sector.isActive });
      fetchSectors();
    } catch (err) {
      console.error('Erro ao atualizar setor:', err);
    }
  };

  const iconOptions = ['📋', '🏥', '🩺', '🏨', '⚕️', '💼', '💊', '🦷', '🔬', '📞', '🛒', '🐾'];

  return (
    <div className="sectors-page">
      <div className="page-header">
        <h2>🏢 Setores</h2>
        <button className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? '✕ Cancelar' : '+ Novo Setor'}
        </button>
      </div>

      {showCreate && (
        <form className="create-form" onSubmit={handleCreate}>
          <input placeholder="Nome do setor" value={newSector.name} onChange={e => setNewSector({ ...newSector, name: e.target.value })} required />
          <input placeholder="Código (ex: recepcao)" value={newSector.code} onChange={e => setNewSector({ ...newSector, code: e.target.value.toLowerCase().replace(/\s/g, '-') })} required />
          <div className="icon-picker">
            {iconOptions.map(icon => (
              <button key={icon} type="button" className={`icon-option ${newSector.icon === icon ? 'selected' : ''}`} onClick={() => setNewSector({ ...newSector, icon })}>{icon}</button>
            ))}
          </div>
          <input type="color" value={newSector.color} onChange={e => setNewSector({ ...newSector, color: e.target.value })} className="color-picker" />
          <input placeholder="Descrição" value={newSector.description} onChange={e => setNewSector({ ...newSector, description: e.target.value })} />
          <button type="submit" className="btn-primary">Criar Setor</button>
        </form>
      )}

      {loading ? (
        <div className="loading">Carregando setores...</div>
      ) : (
        <div className="sectors-grid">
          {sectors.map(sector => (
            <div key={sector.id} className="sector-card" style={{ borderTopColor: sector.color }}>
              <div className="sector-icon" style={{ background: sector.color }}>{sector.icon}</div>
              <div className="sector-info">
                <div className="sector-name">{sector.name}</div>
                <div className="sector-code">{sector.code}</div>
                {sector.description && <div className="sector-desc">{sector.description}</div>}
                <div className="sector-badges">
                  <span className={`badge ${sector.isActive ? 'active' : 'inactive'}`}>{sector.isActive ? 'Ativo' : 'Inativo'}</span>
                  {sector.autoAssign && <span className="badge auto">Auto-assign</span>}
                  {sector.maxConcurrent > 0 && <span className="badge limit">Max: {sector.maxConcurrent}</span>}
                </div>
              </div>
              <div className="sector-actions">
                <button className={`btn-toggle ${sector.isActive ? 'on' : 'off'}`} onClick={() => handleToggleActive(sector)}>
                  {sector.isActive ? '🟢' : '🔴'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
