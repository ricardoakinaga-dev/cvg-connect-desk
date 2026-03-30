import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import './Admin.css';

interface User { id: string; name: string; email: string; isActive: boolean; createdAt: string; }
interface Role { id: string; name: string; description: string | null; }
interface Queue { id: string; name: string; description: string | null; isActive: boolean; }
interface Team { id: string; name: string; description: string | null; isActive: boolean; }
interface Sector { id: string; name: string; code: string; icon: string; color: string; }
interface UserSector { sectorId: string; sectorName: string; sectorIcon: string; sectorColor: string; accessLevel: string; }

type Tab = 'users' | 'roles' | 'queues' | 'teams';

export function Admin() {
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newItem, setNewItem] = useState<Record<string, string>>({});

  // Permissões por setor
  const [editUserSectors, setEditUserSectors] = useState<string | null>(null);
  const [userSectors, setUserSectors] = useState<UserSector[]>([]);
  const [selectedSectors, setSelectedSectors] = useState<Record<string, string>>({});

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [u, r, q, t, s] = await Promise.all([
        api.get<User[]>('/admin/users').catch(() => []),
        api.get<Role[]>('/admin/roles').catch(() => []),
        api.get<Queue[]>('/admin/queues').catch(() => []),
        api.get<Team[]>('/admin/teams').catch(() => []),
        api.get<Sector[]>('/sectors?all=true').catch(() => []),
      ]);
      setUsers(u); setRoles(r); setQueues(q); setTeams(t); setSectors(s);
    } catch (err) { console.error('Erro:', err); }
    finally { setLoading(false); }
  };

  const fetchUserSectors = async (userId: string) => {
    try {
      const data = await api.get<UserSector[]>(`/admin/users/${userId}/sectors`);
      setUserSectors(data);
      const sel: Record<string, string> = {};
      data.forEach(s => { sel[s.sectorId] = s.accessLevel; });
      setSelectedSectors(sel);
    } catch { setUserSectors([]); setSelectedSectors({}); }
  };

  useEffect(() => { fetchAll(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post(`/admin/${tab}`, newItem);
      setNewItem({}); setShowCreate(false); fetchAll();
    } catch (err: any) { alert(err.message); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza?')) return;
    try { await api.delete(`/admin/${tab}/${id}`); fetchAll(); }
    catch (err: any) { alert(err.message); }
  };

  const handleSaveUserSectors = async () => {
    if (!editUserSectors) return;
    const sectorList = Object.entries(selectedSectors)
      .filter(([_, level]) => level)
      .map(([sectorId, accessLevel]) => ({ sectorId, accessLevel }));
    try {
      await api.put(`/admin/users/${editUserSectors}/sectors`, { sectors: sectorList });
      alert('Permissões salvas!');
      fetchUserSectors(editUserSectors);
    } catch (err: any) { alert(err.message); }
  };

  const toggleSector = (sectorId: string) => {
    setSelectedSectors(prev => {
      const next = { ...prev };
      if (next[sectorId]) { delete next[sectorId]; }
      else { next[sectorId] = 'read'; }
      return next;
    });
  };

  const changeAccessLevel = (sectorId: string, level: string) => {
    setSelectedSectors(prev => ({ ...prev, [sectorId]: level }));
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('pt-BR');

  const renderCreateForm = () => {
    switch (tab) {
      case 'users': return <>
        <input placeholder="Nome" value={newItem.name || ''} onChange={e => setNewItem({ ...newItem, name: e.target.value })} required />
        <input placeholder="Email" type="email" value={newItem.email || ''} onChange={e => setNewItem({ ...newItem, email: e.target.value })} required />
        <input placeholder="Senha" type="password" value={newItem.password || ''} onChange={e => setNewItem({ ...newItem, password: e.target.value })} required />
      </>;
      case 'roles': return <>
        <input placeholder="Nome do papel" value={newItem.name || ''} onChange={e => setNewItem({ ...newItem, name: e.target.value })} required />
        <input placeholder="Descrição" value={newItem.description || ''} onChange={e => setNewItem({ ...newItem, description: e.target.value })} />
      </>;
      case 'queues': return <>
        <input placeholder="Nome da fila" value={newItem.name || ''} onChange={e => setNewItem({ ...newItem, name: e.target.value })} required />
        <input placeholder="Descrição" value={newItem.description || ''} onChange={e => setNewItem({ ...newItem, description: e.target.value })} />
      </>;
      case 'teams': return <>
        <input placeholder="Nome do time" value={newItem.name || ''} onChange={e => setNewItem({ ...newItem, name: e.target.value })} required />
        <input placeholder="Descrição" value={newItem.description || ''} onChange={e => setNewItem({ ...newItem, description: e.target.value })} />
      </>;
    }
  };

  const renderTable = () => {
    if (loading) return <div className="loading-state"><div className="spinner" /> Carregando...</div>;

    switch (tab) {
      case 'users': return (
        <>
          <table className="data-table">
            <thead><tr><th>Nome</th><th>Email</th><th>Status</th><th>Criado</th><th>Setores</th><th>Ações</th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td><strong>{u.name}</strong></td>
                  <td className="mono">{u.email}</td>
                  <td><span className={`badge ${u.isActive ? 'active' : 'inactive'}`}>{u.isActive ? 'Ativo' : 'Inativo'}</span></td>
                  <td>{formatDate(u.createdAt)}</td>
                  <td>
                    <button className="btn-sector" onClick={() => { setEditUserSectors(u.id); fetchUserSectors(u.id); }}>
                      🏢 Setores
                    </button>
                  </td>
                  <td><button className="btn-delete-sm" onClick={() => handleDelete(u.id)}>🗑️</button></td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Modal de permissões por setor */}
          {editUserSectors && (
            <div className="modal-overlay" onClick={() => setEditUserSectors(null)}>
              <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>🏢 Permissões por Setor</h3>
                  <button className="btn-close" onClick={() => setEditUserSectors(null)}>✕</button>
                </div>
                <div className="modal-body">
                  <p className="modal-desc">Selecione os setores que este usuário pode acessar e o nível de permissão:</p>

                  <div className="sectors-permission-grid">
                    {sectors.map(sector => {
                      const isSelected = !!selectedSectors[sector.id];
                      const level = selectedSectors[sector.id] || 'read';
                      return (
                        <div key={sector.id} className={`sector-perm-card ${isSelected ? 'selected' : ''}`}>
                          <div className="sector-perm-header">
                            <label className="sector-checkbox">
                              <input type="checkbox" checked={isSelected} onChange={() => toggleSector(sector.id)} />
                              <span className="sector-icon" style={{ background: sector.color }}>{sector.icon}</span>
                              <span className="sector-name">{sector.name}</span>
                            </label>
                          </div>
                          {isSelected && (
                            <div className="access-level-select">
                              <select value={level} onChange={e => changeAccessLevel(sector.id, e.target.value)}>
                                <option value="read">👁️ Somente Leitura</option>
                                <option value="write">✏️ Leitura e Escrita</option>
                                <option value="admin">🔑 Admin do Setor</option>
                              </select>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="modal-actions">
                    <button className="btn-cancel" onClick={() => setEditUserSectors(null)}>Cancelar</button>
                    <button className="btn-save" onClick={handleSaveUserSectors}>💾 Salvar Permissões</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      );
      case 'roles': return (
        <table className="data-table">
          <thead><tr><th>Nome</th><th>Descrição</th><th>Ações</th></tr></thead>
          <tbody>{roles.map(r => <tr key={r.id}><td><strong>{r.name}</strong></td><td>{r.description || '—'}</td><td><button className="btn-delete-sm" onClick={() => handleDelete(r.id)}>🗑️</button></td></tr>)}</tbody>
        </table>
      );
      case 'queues': return (
        <table className="data-table">
          <thead><tr><th>Nome</th><th>Descrição</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>{queues.map(q => <tr key={q.id}><td><strong>{q.name}</strong></td><td>{q.description || '—'}</td><td><span className={`badge ${q.isActive ? 'active' : 'inactive'}`}>{q.isActive ? 'Ativa' : 'Inativa'}</span></td><td><button className="btn-delete-sm" onClick={() => handleDelete(q.id)}>🗑️</button></td></tr>)}</tbody>
        </table>
      );
      case 'teams': return (
        <table className="data-table">
          <thead><tr><th>Nome</th><th>Descrição</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>{teams.map(t => <tr key={t.id}><td><strong>{t.name}</strong></td><td>{t.description || '—'}</td><td><span className={`badge ${t.isActive ? 'active' : 'inactive'}`}>{t.isActive ? 'Ativo' : 'Inativo'}</span></td><td><button className="btn-delete-sm" onClick={() => handleDelete(t.id)}>🗑️</button></td></tr>)}</tbody>
        </table>
      );
    }
  };

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'users', label: 'Usuários', icon: '👥' },
    { key: 'roles', label: 'Papéis', icon: '🔑' },
    { key: 'queues', label: 'Filas', icon: '📋' },
    { key: 'teams', label: 'Times', icon: '🏢' },
  ];

  return (
    <div className="admin-page">
      <div className="page-hero">
        <div className="hero-left">
          <h2>⚙️ Administração</h2>
          <p>Gerencie usuários, papéis, filas e times</p>
        </div>
        <button className="btn-create" onClick={() => { setShowCreate(!showCreate); setNewItem({}); }}>
          {showCreate ? '✕ Cancelar' : `＋ Novo${tab === 'users' ? ' Usuário' : tab === 'roles' ? ' Papel' : tab === 'queues' ? ' Fila' : ' Time'}`}
        </button>
      </div>

      <div className="admin-tabs">
        {tabs.map(t => (
          <button key={t.key} className={`admin-tab ${tab === t.key ? 'active' : ''}`} onClick={() => { setTab(t.key); setShowCreate(false); }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {showCreate && (
        <form className="create-panel" onSubmit={handleCreate}>
          {renderCreateForm()}
          <button type="submit" className="btn-create">Criar</button>
        </form>
      )}

      {renderTable()}
    </div>
  );
}
