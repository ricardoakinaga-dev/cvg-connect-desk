import { useState, useEffect, useCallback } from 'react';
import { conversationApi, type Conversation, type Message } from '../lib/api';
import { useAuthStore } from '../store/auth';
import './Inbox.css';

export function Inbox() {
  const { user } = useAuthStore();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const fetchConversations = useCallback(async () => {
    try {
      const data = await conversationApi.list(filterStatus ? { status: filterStatus } : undefined);
      setConversations(data.conversations || []);
    } catch (err) {
      console.error('Erro:', err);
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  const fetchMessages = useCallback(async (id: string) => {
    try {
      const data = await conversationApi.getMessages(id);
      setMessages(data.messages || []);
    } catch (err) {
      console.error('Erro:', err);
    }
  }, []);

  useEffect(() => { fetchConversations(); const i = setInterval(fetchConversations, 15000); return () => clearInterval(i); }, [fetchConversations]);
  useEffect(() => { if (selectedId) fetchMessages(selectedId); }, [selectedId, fetchMessages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedId) return;
    const conv = conversations.find(c => c.id === selectedId);
    try {
      await conversationApi.sendMessage({ conversationId: selectedId, content: newMessage, recipient: conv?.contactId || '' });
      setNewMessage('');
      fetchMessages(selectedId);
    } catch (err) {
      console.error('Erro:', err);
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; class: string }> = {
      open: { label: 'Aberto', class: 'open' },
      pending: { label: 'Pendente', class: 'pending' },
      closed: { label: 'Fechado', class: 'closed' },
      archived: { label: 'Arquivado', class: 'archived' },
    };
    return map[status] || { label: status, class: 'default' };
  };

  const timeAgo = (d: string) => {
    const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
    if (mins < 1) return 'agora';
    if (mins < 60) return `${mins}min`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h`;
    return `${Math.floor(mins / 1440)}d`;
  };

  const filtered = conversations.filter(c =>
    !searchTerm || c.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selected = conversations.find(c => c.id === selectedId);
  const badge = selected ? statusBadge(selected.status) : null;

  return (
    <div className="inbox-page">
      {/* COLUNA 1 — Lista */}
      <div className="inbox-col-list">
        <div className="inbox-topbar">
          <h2>📥 Inbox</h2>
          <span className="conv-count">{filtered.length}</span>
        </div>

        <div className="inbox-search">
          <span className="search-icon">🔍</span>
          <input placeholder="Buscar conversas..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>

        <div className="inbox-filters">
          {[
            { key: '', label: 'Todas' },
            { key: 'open', label: 'Abertas' },
            { key: 'pending', label: 'Pendentes' },
            { key: 'closed', label: 'Fechadas' },
          ].map(f => (
            <button key={f.key} className={`filter-chip ${filterStatus === f.key ? 'active' : ''}`} onClick={() => setFilterStatus(f.key)}>
              {f.label}
            </button>
          ))}
        </div>

        <div className="conv-list">
          {loading ? (
            <div className="loading-state"><div className="spinner" /> Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state"><span className="empty-icon">📭</span><p>Nenhuma conversa encontrada</p></div>
          ) : (
            filtered.map(conv => {
              const b = statusBadge(conv.status);
              return (
                <div key={conv.id} className={`conv-item ${selectedId === conv.id ? 'selected' : ''}`} onClick={() => setSelectedId(conv.id)}>
                  <div className="conv-avatar">{(conv.contactId || '?')[0].toUpperCase()}</div>
                  <div className="conv-body">
                    <div className="conv-top">
                      <span className="conv-name">{conv.contactId?.slice(0, 12) || 'Contato'}</span>
                      <span className="conv-time">{timeAgo(conv.createdAt)}</span>
                    </div>
                    <div className="conv-bottom">
                      <span className={`status-dot ${b.class}`} />
                      <span className="conv-preview">{conv.externalConversationId || 'Conversa'}</span>
                      <span className={`status-pill ${b.class}`}>{b.label}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* COLUNA 2 — Chat */}
      <div className="inbox-col-chat">
        {selectedId && selected ? (
          <>
            <div className="chat-header">
              <div className="chat-contact">
                <div className="chat-avatar">{(selected.contactId || '?')[0].toUpperCase()}</div>
                <div>
                  <div className="chat-name">{selected.contactId?.slice(0, 16) || 'Contato'}</div>
                  <div className="chat-meta">
                    {badge && <span className={`status-pill ${badge.class}`}>{badge.label}</span>}
                    <span className="chat-id">#{selected.id.slice(0, 8)}</span>
                  </div>
                </div>
              </div>
              <div className="chat-actions">
                <button className="btn-icon" title="Transferir">🔄</button>
                <button className="btn-icon" title="Finalizar">✅</button>
                <button className="btn-icon" title="Info">ℹ️</button>
              </div>
            </div>

            <div className="chat-messages">
              {messages.length === 0 ? (
                <div className="empty-state"><span className="empty-icon">💬</span><p>Nenhuma mensagem ainda</p></div>
              ) : (
                messages.map(msg => (
                  <div key={msg.id} className={`msg ${msg.direction}`}>
                    <div className="msg-bubble">
                      <div className="msg-content">{msg.content}</div>
                      <div className="msg-time">{new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <form className="chat-composer" onSubmit={handleSend}>
              <button type="button" className="btn-attach" title="Anexo">📎</button>
              <input placeholder="Digite sua mensagem..." value={newMessage} onChange={e => setNewMessage(e.target.value)} />
              <button type="submit" className="btn-send" disabled={!newMessage.trim()}>
                <span>Enviar</span> ➤
              </button>
            </form>
          </>
        ) : (
          <div className="empty-state chat-empty">
            <span className="empty-icon-big">💬</span>
            <h3>Selecione uma conversa</h3>
            <p>Escolha uma conversa na lista para começar o atendimento</p>
          </div>
        )}
      </div>

      {/* COLUNA 3 — Painel */}
      <div className="inbox-col-panel">
        {selected ? (
          <>
            <div className="panel-section">
              <h4>📋 Informações</h4>
              <div className="info-row"><span className="info-label">ID</span><span className="info-value mono">{selected.id.slice(0, 12)}...</span></div>
              <div className="info-row"><span className="info-label">Canal</span><span className="info-value">WhatsApp</span></div>
              <div className="info-row"><span className="info-label">Criado</span><span className="info-value">{new Date(selected.createdAt).toLocaleDateString('pt-BR')}</span></div>
              {selected.closedAt && <div className="info-row"><span className="info-label">Fechado</span><span className="info-value">{new Date(selected.closedAt).toLocaleDateString('pt-BR')}</span></div>}
            </div>

            <div className="panel-section">
              <h4>🏷️ Labels</h4>
              <div className="label-chips">
                <span className="label-chip" style={{ background: '#e8f0fe', color: '#1967d2' }}>+ Adicionar</span>
              </div>
            </div>

            <div className="panel-section">
              <h4>⚡ Ações Rápidas</h4>
              <button className="action-btn">📝 Nova Nota</button>
              <button className="action-btn">✓ Criar Tarefa</button>
              <button className="action-btn">🔔 Criar Alerta</button>
              <button className="action-btn transfer">🔄 Transferir Setor</button>
            </div>
          </>
        ) : (
          <div className="empty-state"><span className="empty-icon">ℹ️</span><p>Selecione uma conversa</p></div>
        )}
      </div>
    </div>
  );
}
