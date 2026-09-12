import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Icon, type IconName } from '../components/ui/Icon';
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
  const [newGroup, setNewGroup] = useState({ name: '', description: '', groupType: 'custom', color: '#6b7280', icon: '👥' });

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
      setNewGroup({ name: '', description: '', groupType: 'custom', color: '#6b7280', icon: '👥' });
      setShowCreate(false);
      fetchGroups();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deseja excluir este grupo?')) return;
    try {
      await api.delete(`/contact-groups/${id}`);
      if (selectedGroup === id) setSelectedGroup(null);
      fetchGroups();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const typeLabel = (type: string) => {
    const map: Record<string, string> = { internal: 'Interno', external: 'Externo', mixed: 'Misto', sector: 'Setor', custom: 'Custom' };
    return map[type] || type;
  };

  const iconOptions: Array<{ value: string; label: string; icon: IconName }> = [
    { value: '👥', label: 'Equipe', icon: 'groups' }, { value: '👤', label: 'Pessoa', icon: 'contacts' },
    { value: '🐕', label: 'Cães', icon: 'patients' }, { value: '🐈', label: 'Gatos', icon: 'patients' },
    { value: '🏥', label: 'Clínica', icon: 'sectors' }, { value: '💼', label: 'Trabalho', icon: 'tasks' },
    { value: '⭐', label: 'Destaque', icon: 'activity' }, { value: '🔑', label: 'Acesso', icon: 'settings' },
  ];

  return (
    <div className={`contact-groups-page ${selectedGroup ? 'has-selection' : ''}`}>
      <div className="page-header">
        <h2><Icon name="groups" /> Grupos de contatos</h2>
        <button className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
          <Icon name={showCreate ? 'close' : 'plus'} size={17} /> {showCreate ? 'Cancelar' : 'Novo grupo'}
        </button>
      </div>

      {showCreate && (
        <form className="create-form" onSubmit={handleCreate}>
          <input aria-label="Nome do grupo" placeholder="Nome do grupo" value={newGroup.name} onChange={e => setNewGroup({ ...newGroup, name: e.target.value })} required />
          <select aria-label="Tipo do grupo" value={newGroup.groupType} onChange={e => setNewGroup({ ...newGroup, groupType: e.target.value })}>
            <option value="custom">Custom</option>
            <option value="internal">Interno (Colaboradores)</option>
            <option value="external">Externo (Tutores)</option>
            <option value="mixed">Misto</option>
          </select>
          <div className="icon-picker">
            {iconOptions.map(option => (
              <button key={option.value} aria-label={`Ícone ${option.label}`} title={option.label} type="button" className={`icon-opt ${newGroup.icon === option.value ? 'sel' : ''}`} onClick={() => setNewGroup({ ...newGroup, icon: option.value })}><Icon name={option.icon} size={18} /></button>
            ))}
          </div>
          <input aria-label="Cor do grupo" type="color" value={newGroup.color} onChange={e => setNewGroup({ ...newGroup, color: e.target.value })} className="color-input" />
          <input aria-label="Descrição do grupo" placeholder="Descrição" value={newGroup.description} onChange={e => setNewGroup({ ...newGroup, description: e.target.value })} />
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
                role="button"
                tabIndex={0}
                onClick={() => setSelectedGroup(group.id)}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedGroup(group.id); } }}
                style={{ borderLeftColor: group.color }}
              >
                <div className="group-icon">{group.icon}</div>
                <div className="group-info">
                  <div className="group-name">{group.name}</div>
                  <div className="group-meta">
                    <span className="group-type">{typeLabel(group.groupType)}</span>
                    <span className="group-count">{group.memberCount} membros</span>
                  </div>
                </div>
                <button className="btn-delete-sm" aria-label={`Excluir grupo ${group.name}`} onClick={(e) => { e.stopPropagation(); handleDelete(group.id); }}><Icon name="close" size={15} /></button>
              </div>
            ))}

            {groups.length === 0 && <div className="empty">Nenhum grupo criado.</div>}
          </div>

          <div className="group-detail">
            {selectedGroup ? (
              <>
                <div className="group-detail-header"><button type="button" className="groups-mobile-back" aria-label="Voltar para grupos" onClick={() => setSelectedGroup(null)}><Icon name="back" size={18} /></button><h3>Membros do grupo</h3></div>
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
