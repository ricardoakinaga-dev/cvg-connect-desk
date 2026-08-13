import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getErrorMessage } from '../lib/api';
import './Contacts.css';

interface Contact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  createdAt: string;
}

interface ContactDetail extends Contact {
  externalId: string | null;
  metadata: string | null;
  conversations: { id: string; status: string; statusV2: string; createdAt: string; lastMessage: string | null }[];
  notesCount: number;
  tasksCount: number;
  labels: { id: string; name: string; color: string }[];
  groups: { id: string; name: string; icon: string }[];
}

interface ContactNote {
  id: string;
  content: string;
  createdAt: string;
}

export function Contacts() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<ContactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', phone: '', email: '', notes: '' });
  const [editContact, setEditContact] = useState({ name: '', phone: '', email: '', notes: '' });
  const [contactNotes, setContactNotes] = useState<ContactNote[]>([]);
  const [showNotes, setShowNotes] = useState(false);
  const [newNote, setNewNote] = useState('');

  const fetchContacts = useCallback(async () => {
    try {
      const params = searchTerm ? `?search=${encodeURIComponent(searchTerm)}` : '';
      const data = await api.get<Contact[]>(`/contacts${params}`);
      setContacts(data);
    } catch (err) { console.error('Erro:', err); }
    finally { setLoading(false); }
  }, [searchTerm]);

  const fetchContactDetail = async (id: string) => {
    try {
      const data = await api.get<ContactDetail>(`/contacts/${id}`);
      setSelectedContact(data);
      // Buscar notas
      const notes = await api.get<ContactNote[]>(`/notes?referenceType=conversation&referenceId=${data.conversations[0]?.id || 'none'}`).catch(() => []);
      setContactNotes(notes);
    } catch (err) { console.error('Erro:', err); }
  };

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContact.name.trim() || !newContact.phone.trim()) return;
    try {
      const created = await api.post<Contact>('/contacts', newContact);
      setNewContact({ name: '', phone: '', email: '', notes: '' });
      setShowCreate(false);
      fetchContacts();
      fetchContactDetail(created.id);
    } catch (err: unknown) { alert(getErrorMessage(err)); }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContact) return;
    try {
      await api.put(`/contacts/${selectedContact.id}`, editContact);
      setShowEdit(false);
      fetchContactDetail(selectedContact.id);
    } catch (err: unknown) { alert(getErrorMessage(err)); }
  };

  const handleStartConversation = async () => {
    if (!selectedContact) return;
    try {
      const result = await api.post<{ conversationId: string; isNew: boolean }>(`/contacts/${selectedContact.id}/start-conversation`, {});
      navigate(`/inbox?conversation=${result.conversationId}`);
    } catch (err: unknown) { alert(getErrorMessage(err)); }
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !selectedContact?.conversations[0]) return;
    try {
      await api.post('/notes', {
        content: newNote,
        referenceType: 'conversation',
        referenceId: selectedContact.conversations[0].id,
      });
      setNewNote('');
      setShowNotes(false);
      fetchContactDetail(selectedContact.id);
    } catch (err: unknown) { alert(getErrorMessage(err)); }
  };

  const handleDelete = async () => {
    if (!selectedContact || !confirm('Deseja excluir este contato?')) return;
    try {
      await api.delete(`/contacts/${selectedContact.id}`);
      setSelectedContact(null);
      fetchContacts();
    } catch (err: unknown) { alert(getErrorMessage(err)); }
  };

  const openEdit = () => {
    if (!selectedContact) return;
    const meta = selectedContact.metadata ? JSON.parse(selectedContact.metadata) : {};
    setEditContact({
      name: selectedContact.name || '',
      phone: selectedContact.phone || '',
      email: selectedContact.email || '',
      notes: meta.notes || '',
    });
    setShowEdit(true);
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  const formatPhone = (p: string | null) => {
    if (!p) return '—';
    const clean = p.replace(/\D/g, '');
    if (clean.length === 13) return `+${clean.slice(0,2)} ${clean.slice(2,4)} ${clean.slice(4,9)}-${clean.slice(9)}`;
    if (clean.length === 11) return `+55 ${clean.slice(0,2)} ${clean.slice(2,7)}-${clean.slice(7)}`;
    return p;
  };

  const statusIcon = (s: string) => {
    const map: Record<string, string> = { novo: 'NV', em_atendimento: 'AT', pendente: 'PD', em_espera: 'ES', finalizado: 'OK', arquivado: 'AR' };
    return map[s] || '--';
  };

  return (
    <div className="contacts-page">
      {/* COLUNA 1 — Lista */}
      <div className="contacts-col-list">
        <div className="contacts-topbar">
          <h2>Contatos</h2>
          <button className="btn-new" onClick={() => setShowCreate(true)} title="Novo contato">＋</button>
        </div>

        <div className="contacts-search">
          <span className="search-icon">⌕</span>
          <input placeholder="Buscar por nome, telefone..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>

        <div className="contacts-count">{contacts.length} contatos</div>

        <div className="contacts-list">
          {loading ? (
            <div className="loading-state"><div className="spinner" /></div>
          ) : contacts.length === 0 ? (
            <div className="empty-state"><span className="empty-icon">CT</span><p>Nenhum contato encontrado</p>
              <button className="btn-primary-sm" onClick={() => setShowCreate(true)}>＋ Adicionar contato</button>
            </div>
          ) : (
            contacts.map(contact => (
              <div key={contact.id} className={`contact-item ${selectedContact?.id === contact.id ? 'selected' : ''}`} onClick={() => fetchContactDetail(contact.id)}>
                <div className="contact-avatar">{(contact.name || '?')[0].toUpperCase()}</div>
                <div className="contact-info">
                  <div className="contact-name">{contact.name || 'Sem nome'}</div>
                  <div className="contact-phone">{formatPhone(contact.phone)}</div>
                </div>
                <div className="contact-date">{formatDate(contact.createdAt)}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* COLUNA 2 — Perfil */}
      <div className="contacts-col-profile">
        {selectedContact ? (
          <>
            {/* Header do perfil */}
            <div className="profile-header">
              <div className="profile-avatar-large">{(selectedContact.name || '?')[0].toUpperCase()}</div>
              <div className="profile-info">
                <h2>{selectedContact.name || 'Sem nome'}</h2>
                <div className="profile-phone">{formatPhone(selectedContact.phone)}</div>
                {selectedContact.email && <div className="profile-email">{selectedContact.email}</div>}
              </div>
              <div className="profile-actions">
                <button className="btn-action-icon" onClick={handleStartConversation} title="Iniciar conversa">MSG</button>
                <button className="btn-action-icon" onClick={openEdit} title="Editar">ED</button>
                <button className="btn-action-icon" onClick={() => setShowNotes(!showNotes)} title="Notas">NT</button>
                <button className="btn-action-icon danger" onClick={handleDelete} title="Excluir">DEL</button>
              </div>
            </div>

            {/* Labels e Grupos */}
            {(selectedContact.labels?.length > 0 || selectedContact.groups?.length > 0) && (
              <div className="profile-section">
                <div className="tags-row">
                  {selectedContact.labels?.map(l => (
                    <span key={l.id} className="tag-label" style={{ background: l.color + '20', color: l.color }}>{l.name}</span>
                  ))}
                  {selectedContact.groups?.map(g => (
                    <span key={g.id} className="tag-group">{g.name}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Notas rápidas */}
            {showNotes && (
              <div className="profile-section notes-section">
                <h4>Notas do Contato</h4>
                <div className="add-note">
                  <textarea placeholder="Adicionar nota..." value={newNote} onChange={e => setNewNote(e.target.value)} rows={2} />
                  <button className="btn-primary-sm" onClick={handleAddNote} disabled={!newNote.trim()}>Adicionar</button>
                </div>
                {contactNotes.length > 0 ? (
                  <div className="notes-list">
                    {contactNotes.map((note) => (
                      <div key={note.id} className="note-item">
                        <div className="note-content">{note.content}</div>
                        <div className="note-date">{formatDate(note.createdAt)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-sm">Nenhuma nota ainda</div>
                )}
              </div>
            )}

            {/* Ação principal */}
            <div className="profile-section">
              <button className="btn-start-chat" onClick={handleStartConversation}>
                Iniciar Conversa
              </button>
            </div>

            {/* Conversas */}
            <div className="profile-section">
              <h4>Conversas ({selectedContact.conversations.length})</h4>
              {selectedContact.conversations.length > 0 ? (
                <div className="conversations-list">
                  {selectedContact.conversations.map(conv => (
                    <div key={conv.id} className="conv-mini" onClick={() => navigate(`/inbox?conversation=${conv.id}`)}>
                      <span className="conv-status-icon">{statusIcon(conv.statusV2)}</span>
                      <div className="conv-mini-info">
                        <div className="conv-mini-status">{conv.statusV2}</div>
                        <div className="conv-mini-msg">{conv.lastMessage || 'Sem mensagens'}</div>
                      </div>
                      <div className="conv-mini-date">{formatDate(conv.createdAt)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-sm">Nenhuma conversa ainda</div>
              )}
            </div>

            {/* Estatísticas */}
            <div className="profile-section stats-mini">
              <div className="stat-item">
                <span className="stat-num">{selectedContact.conversations.length}</span>
                <span className="stat-label">Conversas</span>
              </div>
              <div className="stat-item">
                <span className="stat-num">{selectedContact.notesCount}</span>
                <span className="stat-label">Notas</span>
              </div>
              <div className="stat-item">
                <span className="stat-num">{selectedContact.tasksCount}</span>
                <span className="stat-label">Tarefas</span>
              </div>
            </div>

            {/* Info extra */}
            <div className="profile-section">
              <div className="info-grid">
                <div className="info-item">
                  <span className="info-label">ID</span>
                  <span className="info-value mono">{selectedContact.id.slice(0, 12)}...</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Cadastrado</span>
                  <span className="info-value">{new Date(selectedContact.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state profile-empty">
            <span className="empty-icon-big">CT</span>
            <h3>Selecione um contato</h3>
            <p>Escolha um contato na lista para ver o perfil</p>
            <button className="btn-primary" onClick={() => setShowCreate(true)}>＋ Novo Contato</button>
          </div>
        )}
      </div>

      {/* MODAL: Criar contato */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>＋ Novo Contato</h3>
              <button className="btn-close" onClick={() => setShowCreate(false)}>✕</button>
            </div>
            <form className="modal-body" onSubmit={handleCreate}>
              <div className="form-group">
                <label>Nome *</label>
                <input placeholder="Nome completo" value={newContact.name} onChange={e => setNewContact({ ...newContact, name: e.target.value })} required autoFocus />
              </div>
              <div className="form-group">
                <label>Telefone *</label>
                <input placeholder="+55 11 99999-9999" value={newContact.phone} onChange={e => setNewContact({ ...newContact, phone: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" placeholder="email@exemplo.com" value={newContact.email} onChange={e => setNewContact({ ...newContact, email: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Notas</label>
                <textarea placeholder="Informações sobre o contato..." value={newContact.notes} onChange={e => setNewContact({ ...newContact, notes: e.target.value })} rows={3} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowCreate(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Criar Contato</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Editar contato */}
      {showEdit && selectedContact && (
        <div className="modal-overlay" onClick={() => setShowEdit(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Editar Contato</h3>
              <button className="btn-close" onClick={() => setShowEdit(false)}>✕</button>
            </div>
            <form className="modal-body" onSubmit={handleUpdate}>
              <div className="form-group">
                <label>Nome</label>
                <input value={editContact.name} onChange={e => setEditContact({ ...editContact, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Telefone</label>
                <input value={editContact.phone} onChange={e => setEditContact({ ...editContact, phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={editContact.email} onChange={e => setEditContact({ ...editContact, email: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Notas</label>
                <textarea value={editContact.notes} onChange={e => setEditContact({ ...editContact, notes: e.target.value })} rows={3} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowEdit(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
