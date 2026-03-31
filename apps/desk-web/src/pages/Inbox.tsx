import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api, conversationApi, sectorApi, type Conversation, type Message, type Sector } from '../lib/api';
import { useAuthStore } from '../store/auth';
import './Inbox.css';

export function Inbox() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Data
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  // Selection
  const [selectedSector, setSelectedSector] = useState<string>('all');
  const [selectedConv, setSelectedConv] = useState<string | null>(null);
  const [selectedConvData, setSelectedConvData] = useState<Conversation | null>(null);

  // UI
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showNewConv, setShowNewConv] = useState(false);
  const [newConvTab, setNewConvTab] = useState<'contacts' | 'collaborators'>('contacts');
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactSearch, setContactSearch] = useState('');

  // Fetch
  useEffect(() => {
    sectorApi.list().then(setSectors).catch(() => {});
    api.get<any[]>('/contacts').then(setContacts).catch(() => {});
  }, []);

  const fetchConversations = useCallback(async () => {
    try {
      const params: any = {};
      if (selectedSector !== 'all') params.sectorId = selectedSector;
      const data = await conversationApi.list(params);
      setConversations(data.conversations || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [selectedSector]);

  useEffect(() => { fetchConversations(); const i = setInterval(fetchConversations, 8000); return () => clearInterval(i); }, [fetchConversations]);

  const fetchMessages = useCallback(async (id: string) => {
    try {
      const data = await conversationApi.getMessages(id);
      setMessages(data.messages || []);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (err) { console.error(err); }
  }, []);

  useEffect(() => { if (selectedConv) fetchMessages(selectedConv); }, [selectedConv, fetchMessages]);
  useEffect(() => { const c = searchParams.get('conversation'); if (c) setSelectedConv(c); }, [searchParams]);

  // Select
  const selectConv = (conv: Conversation) => {
    setSelectedConv(conv.id);
    setSelectedConvData(conv);
    setShowNewConv(false);
  };

  // Send
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && !selectedFile) || !selectedConv) return;
    try {
      if (selectedFile) {
        const base64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.readAsDataURL(selectedFile); r.onload = () => res(r.result as string); r.onerror = rej; });
        const mediaType = selectedFile.type.startsWith('image/') ? 'image' : selectedFile.type.startsWith('audio/') ? 'audio' : 'document';
        await api.post('/messages', { conversationId: selectedConv, content: newMessage || '', recipient: selectedConvData?.contactId || '', mediaUrl: base64, mediaType, mediaMimetype: selectedFile.type, mediaFilename: selectedFile.name });
        setSelectedFile(null);
      } else {
        await conversationApi.sendMessage({ conversationId: selectedConv, content: newMessage, recipient: selectedConvData?.contactId || '' });
      }
      setNewMessage('');
      fetchMessages(selectedConv);
      fetchConversations();
    } catch (err) { console.error(err); }
  };

  // Start new conversation
  const handleStartConversation = async (contactId: string) => {
    try {
      const result = await api.post<{ conversationId: string; isNew: boolean }>(`/contacts/${contactId}/start-conversation`, { sectorId: selectedSector !== 'all' ? selectedSector : undefined });
      setShowNewConv(false);
      fetchConversations();
      setSelectedConv(result.conversationId);
    } catch (err: any) { alert(err.message); }
  };

  // Helpers
  const statusColor = (s: string) => {
    const map: Record<string, string> = { novo: '#22c55e', em_atendimento: '#3b82f6', pendente: '#eab308', em_espera: '#f97316', finalizado: '#9ca3af', open: '#22c55e', pending: '#eab308', closed: '#9ca3af' };
    return map[s] || '#999';
  };

  const timeAgo = (d: string) => { const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000); if (m < 1) return 'agora'; if (m < 60) return `${m}min`; if (m < 1440) return `${Math.floor(m / 60)}h`; return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); };

  const filtered = conversations.filter(c => !searchTerm || (c.contactId || '').toLowerCase().includes(searchTerm.toLowerCase()));

  const filteredContacts = contacts.filter(c => !contactSearch || (c.name || '').toLowerCase().includes(contactSearch.toLowerCase()) || (c.phone || '').includes(contactSearch));

  const sectorCount = (id: string) => conversations.filter(c => c.sectorId === id).length;

  const activeSector = sectors.find(s => s.id === selectedSector);

  return (
    <div className="inbox-v2">
      {/* ===== COLUNA CONVERSAS ===== */}
      <div className="inbox-sidebar">
        {/* Header */}
        <div className="sidebar-top">
          <div className="sidebar-title-row">
            <h2>💬 Conversas</h2>
            <button className="btn-new-conv" onClick={() => setShowNewConv(!showNewConv)} title="Nova conversa">
              {showNewConv ? '✕' : '✏️'}
            </button>
          </div>

          {/* Setores tabs */}
          <div className="sector-tabs">
            <button className={`sector-tab ${selectedSector === 'all' ? 'active' : ''}`} onClick={() => setSelectedSector('all')}>
              Todos <span className="tab-badge">{conversations.length}</span>
            </button>
            {sectors.filter(s => s.isActive).map(s => (
              <button key={s.id} className={`sector-tab ${selectedSector === s.id ? 'active' : ''}`} onClick={() => setSelectedSector(s.id)} style={selectedSector === s.id ? { borderColor: s.color, color: s.color } : {}}>
                {s.icon} {s.name.split(' ')[0]} {sectorCount(s.id) > 0 && <span className="tab-badge">{sectorCount(s.id)}</span>}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="sidebar-search">
            <input placeholder="🔍 Pesquisar conversas..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
        </div>

        {/* Nova conversa panel */}
        {showNewConv && (
          <div className="new-conv-panel">
            <div className="new-conv-tabs">
              <button className={`new-conv-tab ${newConvTab === 'contacts' ? 'active' : ''}`} onClick={() => setNewConvTab('contacts')}>👤 Clientes</button>
              <button className={`new-conv-tab ${newConvTab === 'collaborators' ? 'active' : ''}`} onClick={() => setNewConvTab('collaborators')}>👩‍⚕️ Colaboradores</button>
            </div>
            <input className="new-conv-search" placeholder="Buscar..." value={contactSearch} onChange={e => setContactSearch(e.target.value)} />
            <div className="new-conv-list">
              {filteredContacts.map(c => (
                <div key={c.id} className="new-conv-item" onClick={() => handleStartConversation(c.id)}>
                  <div className="new-conv-avatar">{(c.name || '?')[0].toUpperCase()}</div>
                  <div className="new-conv-info">
                    <div className="new-conv-name">{c.name}</div>
                    <div className="new-conv-phone">{c.phone}</div>
                  </div>
                  <span className="new-conv-arrow">💬</span>
                </div>
              ))}
              {filteredContacts.length === 0 && <div className="new-conv-empty">Nenhum contato encontrado</div>}
            </div>
            <button className="btn-add-contact" onClick={() => navigate('/contacts')}>
              ＋ Cadastrar novo contato
            </button>
          </div>
        )}

        {/* Lista de conversas */}
        <div className="conv-list-v2">
          {loading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="empty-list">
              <span>📭</span>
              <p>Nenhuma conversa</p>
            </div>
          ) : (
            filtered.map(conv => {
              const isActive = selectedConv === conv.id;
              const sector = sectors.find(s => s.id === conv.sectorId);
              return (
                <div key={conv.id} className={`conv-row ${isActive ? 'active' : ''}`} onClick={() => selectConv(conv)}>
                  <div className="conv-avatar-v2" style={{ background: sector?.color || '#4361ee' }}>
                    {(conv.contactId || '?')[0].toUpperCase()}
                  </div>
                  <div className="conv-content">
                    <div className="conv-header-row">
                      <span className="conv-name-v2">{conv.contactId?.slice(0, 16) || 'Contato'}</span>
                      <span className="conv-time-v2">{timeAgo(conv.createdAt)}</span>
                    </div>
                    <div className="conv-preview-row">
                      <span className="conv-last-msg">{conv.externalConversationId || 'Nova conversa'}</span>
                      <span className="conv-status-dot" style={{ background: statusColor(conv.statusV2 || conv.status) }} />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ===== COLUNA CHAT ===== */}
      <div className="inbox-main">
        {selectedConv && selectedConvData ? (
          <>
            {/* Chat Header */}
            <div className="main-header">
              <div className="header-left">
                <div className="header-avatar" style={{ background: activeSector?.color || '#4361ee' }}>
                  {(selectedConvData.contactId || '?')[0].toUpperCase()}
                </div>
                <div className="header-info">
                  <div className="header-name">{selectedConvData.contactId?.slice(0, 20) || 'Contato'}</div>
                  <div className="header-meta">
                    <span className="header-sector" style={{ background: (activeSector?.color || '#666') + '20', color: activeSector?.color || '#666' }}>
                      {activeSector?.icon || '📋'} {activeSector?.name || 'Sem setor'}
                    </span>
                    <span className="header-status" style={{ color: statusColor(selectedConvData.statusV2 || selectedConvData.status) }}>
                      ● {(selectedConvData.statusV2 || selectedConvData.status || 'novo').replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
              </div>
              <div className="header-actions">
                <button className="header-btn" title="Buscar na conversa">🔍</button>
                <button className="header-btn" title="Transferir">🔄</button>
                <button className="header-btn" title="Informações">ℹ️</button>
                <button className="header-btn" title="Mais opções">⋮</button>
              </div>
            </div>

            {/* Chat Background Pattern */}
            <div className="chat-bg">
              <div className="chat-messages-v2">
                {messages.length === 0 ? (
                  <div className="empty-chat-v2">
                    <div className="empty-bubble">👋</div>
                    <p>Início da conversa</p>
                    <span>Envie uma mensagem para começar o atendimento</span>
                  </div>
                ) : (
                  <>
                    {/* Date separator */}
                    <div className="date-separator">
                      <span>Hoje</span>
                    </div>

                    {messages.map(msg => (
                      <div key={msg.id} className={`message ${msg.direction}`}>
                        {(msg as any).mediaType === 'image' && (msg as any).mediaUrl && (
                          <div className="msg-media-v2">
                            <img src={(msg as any).mediaUrl} alt="Imagem" />
                          </div>
                        )}
                        {(msg as any).mediaType === 'audio' && (msg as any).mediaUrl && (
                          <div className="msg-media-v2">
                            <audio controls><source src={(msg as any).mediaUrl} /></audio>
                          </div>
                        )}
                        {msg.content && <div className="msg-text">{msg.content}</div>}
                        <div className="msg-footer">
                          <span className="msg-timestamp">
                            {new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {msg.direction === 'outbound' && <span className="msg-ticks">✓✓</span>}
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>
            </div>

            {/* Composer */}
            <div className="composer-v2">
              {selectedFile && (
                <div className="file-bar">
                  <span>📎 {selectedFile.name}</span>
                  <button onClick={() => setSelectedFile(null)}>✕</button>
                </div>
              )}
              <form className="composer-row" onSubmit={handleSend}>
                <button type="button" className="composer-btn" title="Emoji">😊</button>
                <input ref={fileInputRef} type="file" accept="image/*,audio/*" onChange={e => { const f = e.target.files?.[0]; if (f && f.size <= 16 * 1024 * 1024) setSelectedFile(f); e.target.value = ''; }} style={{ display: 'none' }} />
                <button type="button" className="composer-btn" title="Anexar" onClick={() => fileInputRef.current?.click()}>📎</button>
                <input className="composer-input-v2" placeholder="Mensagem" value={newMessage} onChange={e => setNewMessage(e.target.value)} autoFocus />
                <button type="submit" className="composer-send">
                  {newMessage.trim() || selectedFile ? '➤' : '🎤'}
                </button>
              </form>
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="inbox-empty">
            <div className="empty-center">
              <div className="empty-logo">🐾</div>
              <h2>CVG Connect Desk</h2>
              <p>Selecione uma conversa ou inicie uma nova</p>
              <button className="btn-start-new" onClick={() => setShowNewConv(true)}>
                ✏️ Nova Conversa
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
