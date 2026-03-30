import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import './Admin.css';

interface User {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  createdAt: string;
  roles?: string[];
}

interface Role {
  id: string;
  name: string;
  description: string | null;
}

interface Queue {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

interface Team {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

type Tab = 'users' | 'roles' | 'queues' | 'teams';

export function Admin() {
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newItem, setNewItem] = useState<Record<string, string>>({});

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [u, r, q, t] = await Promise.all([
        api.get<User[]>('/admin/users').catch(() => []),
        api.get<Role[]>('/admin/roles').catch(() => []),
        api.get<Queue[]>('/admin/queues').catch(() => []),
        api.get<Team[]>('/admin/teams').catch(() => []),
      ]);
      setUsers(u);
      setRoles(r);
      setQueues(q);
      setTeams(t);
    } catch (err) {
      console.error('Erro ao carregar admin:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const endpoint = `/admin/${tab}`;
      await api.post(endpoint, newItem);
      setNewItem({});
      setShowCreate(false);
      fetchAll();
    } catch (err) {
      console.error('Erro ao criar:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir?')) return;
    try {
      await api.delete(`/admin/${tab}/${id}`);
      fetchAll();
    } catch (err) {
      console.error('Erro ao excluir:', err);
    }
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('pt-BR');

  const renderCreateForm = () => {
    switch (tab) {
      case 'users':
        return (
          <>
            <input placeholder="Nome" value={newItem.name || ''} onChange={e => setNewItem({ ...newItem, name: e.target.value })} required />
            <input placeholder="Email" type="email" value={newItem.email || ''} onChange={e => setNewItem({ ...newItem, email: e.target.value })} required />
            <input placeholder="Senha" type="password" value={newItem.password || ''} onChange={e => setNewItem({ ...newItem, password: e.target.value })} required />
          </>
        );
      case 'roles':
        return (
          <>
            <input placeholder="Nome do papel" value={newItem.name || ''} onChange={e => setNewItem({ ...newItem, name: e.target.value })} required />
            <input placeholder="Descrição" value={newItem.description || ''} onChange={e => setNewItem({ ...newItem, description: e.target.value })} />
          </>
        );
      case 'queues':
        return (
          <>
            <input placeholder="Nome da fila" value={newItem.name || ''} onChange={e => setNewItem({ ...newItem, name: e.target.value })} required />
            <input placeholder="Descrição" value={newItem.description || ''} onChange={e => setNewItem({ ...newItem, description: e.target.value })} />
          </>
        );
      case 'teams':
        return (
          <>
            <input placeholder="Nome do time" value={newItem.name || ''} onChange={e => setNewItem({ ...newItem, name: e.target.value })} required />
            <input placeholder="Descrição" value={newItem.description || ''} onChange={e => setNewItem({ ...newItem, description: e.target.value })} />
          </>
        );
    }
  };

  const renderTable = () => {
    if (loading) return <div className="loading">Carregando...</div>;

    switch (tab) {
      case 'users':
        return (
          <table className="admin-table">
            <thead><tr><th>Nome</th><th>Email</th><th>Status</th><th>Criado em</th><th>Ações</th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td><span className={`badge ${u.isActive ? 'active' : 'inactive'}`}>{u.isActive ? 'Ativo' : 'Inativo'}</span></td>
                  <td>{formatDate(u.createdAt)}</td>
                  <td><button className="btn-danger-sm" onClick={() => handleDelete(u.id)}>Excluir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      case 'roles':
        return (
          <table className="admin-table">
            <thead><tr><th>Nome</th><th>Descrição</th><th>Ações</th></tr></thead>
            <tbody>
              {roles.map(r => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.description || '—'}</td>
                  <td><button className="btn-danger-sm" onClick={() => handleDelete(r.id)}>Excluir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      case 'queues':
        return (
          <table className="admin-table">
            <thead><tr><th>Nome</th><th>Descrição</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>
              {queues.map(q => (
                <tr key={q.id}>
                  <td>{q.name}</td>
                  <td>{q.description || '—'}</td>
                  <td><span className={`badge ${q.isActive ? 'active' : 'inactive'}`}>{q.isActive ? 'Ativa' : 'Inativa'}</span></td>
                  <td><button className="btn-danger-sm" onClick={() => handleDelete(q.id)}>Excluir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      case 'teams':
        return (
          <table className="admin-table">
            <thead><tr><th>Nome</th><th>Descrição</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>
              {teams.map(t => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.description || '—'}</td>
                  <td><span className={`badge ${t.isActive ? 'active' : 'inactive'}`}>{t.isActive ? 'Ativo' : 'Inativo'}</span></td>
                  <td><button className="btn-danger-sm" onClick={() => handleDelete(t.id)}>Excluir</button></td>
                </tr>
              ))}
            </tbody>
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
      <div className="page-header">
        <h2>⚙️ Administração</h2>
        <button className="btn-primary" onClick={() => { setShowCreate(!showCreate); setNewItem({}); }}>
          {showCreate ? '✕ Cancelar' : `+ Novo${tab === 'users' ? ' Usuário' : tab === 'roles' ? ' Papel' : tab === 'queues' ? ' Fila' : ' Time'}`}
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
        <form className="admin-create-form" onSubmit={handleCreate}>
          {renderCreateForm()}
          <button type="submit" className="btn-primary">Criar</button>
        </form>
      )}

      {renderTable()}
    </div>
  );
}
