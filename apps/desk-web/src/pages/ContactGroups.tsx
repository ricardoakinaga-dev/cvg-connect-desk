import { useState, useEffect } from 'react';
import { api, getErrorMessage } from '../lib/api';
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

export function ContactGroups() {
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [newGroup, setNewGroup] = useState({ name: '', description: '', groupType: 'custom', color: '#64748b', icon: 'GP' });

  const fetchGroups = async () => {
    try {
      const data = await api.get<ContactGroup[]>('/contact-groups');
      setGroups(data);
    } catch (err) {
      console.error('Erro:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMembers = async (groupId: string) => {
    try {
      const data = await api.get<GroupMember[]>(`/contact-groups/${groupId}/members`);
      setMembers(data);
    } catch (err) {
      console.error('Erro:', err);
    }
  };

  useEffect(() => { fetchGroups(); }, []);
  useEffect(() => { if (selectedGroup) fetchMembers(selectedGroup); }, [selectedGroup]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroup.name.trim()) return;
    try {
      await api.post('/contact-groups', newGroup);
      setNewGroup({ name: '', description: '', groupType: 'custom', color: '#64748b', icon: 'GP' });
      setShowCreate(false);
      fetchGroups();
    } catch (err: unknown) {
      alert(getErrorMessage(err));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deseja excluir este grupo?')) return;
    try {
      await api.delete(`/contact-groups/${id}`);
      if (selectedGroup === id) setSelectedGroup(null);
      fetchGroups();
    } catch (err: unknown) {
      alert(getErrorMessage(err));
    }
  };

  const typeLabel = (type: string) => {
    const map: Record<string, string> = { internal: 'Interno', external: 'Externo', mixed: 'Misto', sector: 'Setor', custom: 'Custom' };
    return map[type] || type;
  };

  const iconOptions = ['GP', 'CT', 'VIP', 'EXT', 'CL', 'AD', 'PR', 'AC'];
  const groupMark = (group: ContactGroup) => (/^[A-Z0-9]{2,4}$/.test(group.icon) ? group.icon : group.name.slice(0, 2).toUpperCase());

  return (
    <div className="contact-groups-page">
      <div className="page-header">
        <h2>Grupos de Contatos</h2>
        <button className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? '✕ Cancelar' : '+ Novo Grupo'}
        </button>
      </div>

      {showCreate && (
        <form className="create-form" onSubmit={handleCreate}>
          <input placeholder="Nome do grupo" value={newGroup.name} onChange={e => setNewGroup({ ...newGroup, name: e.target.value })} required />
          <select value={newGroup.groupType} onChange={e => setNewGroup({ ...newGroup, groupType: e.target.value })}>
            <option value="custom">Custom</option>
            <option value="internal">Interno (Colaboradores)</option>
            <option value="external">Externo (Tutores)</option>
            <option value="mixed">Misto</option>
          </select>
          <div className="icon-picker">
            {iconOptions.map(icon => (
              <button key={icon} type="button" className={`icon-opt ${newGroup.icon === icon ? 'sel' : ''}`} onClick={() => setNewGroup({ ...newGroup, icon })}>{icon}</button>
            ))}
          </div>
          <input type="color" value={newGroup.color} onChange={e => setNewGroup({ ...newGroup, color: e.target.value })} className="color-input" />
          <input placeholder="Descrição" value={newGroup.description} onChange={e => setNewGroup({ ...newGroup, description: e.target.value })} />
          <button type="submit" className="btn-primary">Criar</button>
        </form>
      )}

      {loading ? (
        <div className="loading">Carregando grupos...</div>
      ) : (
        <div className="groups-layout">
          <div className="groups-list">
            {groups.map(group => (
              <div
                key={group.id}
                className={`group-card ${selectedGroup === group.id ? 'selected' : ''}`}
                onClick={() => setSelectedGroup(group.id)}
                style={{ borderLeftColor: group.color }}
              >
                <div className="group-icon">{groupMark(group)}</div>
                <div className="group-info">
                  <div className="group-name">{group.name}</div>
                  <div className="group-meta">
                    <span className="group-type">{typeLabel(group.groupType)}</span>
                    <span className="group-count">{group.memberCount} membros</span>
                  </div>
                </div>
                <button className="btn-delete-sm" onClick={(e) => { e.stopPropagation(); handleDelete(group.id); }}>DEL</button>
              </div>
            ))}

            {groups.length === 0 && <div className="empty">Nenhum grupo criado.</div>}
          </div>

          <div className="group-detail">
            {selectedGroup ? (
              <>
                <h3>Membros do Grupo</h3>
                {members.length > 0 ? (
                  <div className="members-list">
                    {members.map(m => (
                      <div key={m.id} className="member-card">
                        <span className="member-name">{m.contactName || 'Sem nome'}</span>
                        <span className="member-phone">{m.contactPhone || '—'}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty">Nenhum membro neste grupo.</div>
                )}
              </>
            ) : (
              <div className="empty">Selecione um grupo para ver os membros.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
