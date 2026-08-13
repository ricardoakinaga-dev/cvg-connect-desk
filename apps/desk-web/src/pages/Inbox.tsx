import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api, conversationApi, getErrorMessage, sectorApi, transferApi, type ContactSummary, type Conversation, type Message, type Sector } from '../lib/api';
import { useAuthStore } from '../store/auth';
import { realtimeClient, type RealtimeEvent } from '../lib/realtime';
import './Inbox.css';

type ConversationWithContact = Omit<Conversation, 'lastMessage'> & {
  contactName?: string | null;
  contactPhone?: string | null;
  sectorId?: string;
  statusV2?: string;
  lastMessage?: { content: string; direction: string } | null;
};

export function Inbox() {
  const { isAuthenticated } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sectors, setSectors] = useState<Sector[]>([]);
  const [conversations, setConversations] = useState<ConversationWithContact[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [contacts, setContacts] = useState<ContactSummary[]>([]);

  const [selectedSector, setSelectedSector] = useState<string>('all');
  const [selectedConv, setSelectedConv] = useState<string | null>(null);
  const [selectedConvData, setSelectedConvData] = useState<ConversationWithContact | null>(null);

  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showNewConv, setShowNewConv] = useState(false);
  const [newConvTab, setNewConvTab] = useState<'contacts' | 'collaborators'>('contacts');
  const [contactSearch, setContactSearch] = useState('');
  const [showMessageSearch, setShowMessageSearch] = useState(false);
  const [messageSearch, setMessageSearch] = useState('');
  const [showTransferPanel, setShowTransferPanel] = useState(false);
  const [transferSectorId, setTransferSectorId] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);
  const [showConversationInfo, setShowConversationInfo] = useState(false);

  useEffect(() => {
    sectorApi.list().then(setSectors).catch(() => {});
    api.get<ContactSummary[]>('/contacts').then(setContacts).catch(() => []);
  }, []);

  const fetchConversations = useCallback(async () => {
    try {
      const params: { sectorId?: string } = {};
      if (selectedSector !== 'all') params.sectorId = selectedSector;
      const data = await conversationApi.list(params);
      setConversations(data.conversations || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [selectedSector]);

  const fetchMessages = useCallback(async (id: string) => {
    try {
      const data = await conversationApi.getMessages(id);
      setMessages(data.messages || []);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (err) { console.error(err); }
  }, []);

  // Realtime connection - substitui polling agressivo
  useEffect(() => {
    if (!isAuthenticated) return;

    realtimeClient.connect();

    console.log('[Inbox] Realtime client connected');

    return () => {
      realtimeClient.disconnect();
      console.log('[Inbox] Realtime client disconnected');
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const handleMessagePersisted = (event: RealtimeEvent) => {
      const payload = event.payload as { conversationId?: string };
      if (payload.conversationId && payload.conversationId === selectedConv) {
        fetchMessages(payload.conversationId);
      }
      fetchConversations();
    };

    const handleConversationChanged = () => {
      fetchConversations();
    };

    const handleStatusChanged = () => {
      fetchConversations();
    };

    const handleHandoffCompleted = () => {
      fetchConversations();
    };

    realtimeClient.subscribe('message.persisted', handleMessagePersisted);
    realtimeClient.subscribe('conversation.created', handleConversationChanged);
    realtimeClient.subscribe('conversation.status.changed', handleStatusChanged);
    realtimeClient.subscribe('handoff.completed', handleHandoffCompleted);

    return () => {
      realtimeClient.unsubscribe('message.persisted', handleMessagePersisted);
      realtimeClient.unsubscribe('conversation.created', handleConversationChanged);
      realtimeClient.unsubscribe('conversation.status.changed', handleStatusChanged);
      realtimeClient.unsubscribe('handoff.completed', handleHandoffCompleted);
    };
  }, [isAuthenticated, selectedConv, fetchConversations, fetchMessages]);

  // Polling de fallback (apenas se WS não estiver activo ou a cada 30s para reconectar state)
  useEffect(() => {
    fetchConversations();
    const i = setInterval(fetchConversations, 30000);
    return () => clearInterval(i);
  }, [fetchConversations]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchConversations();
  }, [isAuthenticated, fetchConversations]);

  useEffect(() => { if (selectedConv) fetchMessages(selectedConv); }, [selectedConv, fetchMessages]);
  useEffect(() => { const c = searchParams.get('conversation'); if (c) setSelectedConv(c); }, [searchParams]);
  useEffect(() => {
    if (!selectedConv) return;
    const matched = conversations.find(conv => conv.id === selectedConv);
    if (matched && matched.id !== selectedConvData?.id) {
      setSelectedConvData(matched);
    }
  }, [conversations, selectedConv, selectedConvData?.id]);

  const selectConv = (conv: ConversationWithContact) => {
    setSelectedConv(conv.id);
    setSelectedConvData(conv);
    setShowNewConv(false);
    setShowMessageSearch(false);
    setMessageSearch('');
    setShowTransferPanel(false);
    setTransferReason('');
    setShowConversationInfo(false);
  };

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

  const handleStartConversation = async (contactId: string) => {
    try {
      const result = await api.post<{ conversationId: string; isNew: boolean }>(`/contacts/${contactId}/start-conversation`, { sectorId: selectedSector !== 'all' ? selectedSector : undefined });
      setShowNewConv(false);
      fetchConversations();
      setSelectedConv(result.conversationId);
    } catch (err: unknown) { alert(getErrorMessage(err)); }
  };

  const toggleMessageSearch = () => {
    setShowMessageSearch(value => !value);
    setShowTransferPanel(false);
    setShowConversationInfo(false);
  };

  const openTransferPanel = () => {
    const fallbackSector = sectors.find(s => s.isActive && s.id !== selectedConvData?.sectorId);
    setTransferSectorId(current => current || fallbackSector?.id || '');
    setShowTransferPanel(value => !value);
    setShowMessageSearch(false);
    setShowConversationInfo(false);
  };

  const toggleConversationInfo = () => {
    setShowConversationInfo(value => !value);
    setShowMessageSearch(false);
    setShowTransferPanel(false);
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConvData || !transferSectorId || transferLoading) return;
    if (!selectedConvData.contactId) {
      alert('Esta conversa nao tem contato vinculado para transferencia.');
      return;
    }

    try {
      setTransferLoading(true);
      await transferApi.create({
        contactId: selectedConvData.contactId,
        conversationId: selectedConvData.id,
        fromSectorId: selectedConvData.sectorId,
        toSectorId: transferSectorId,
        reason: transferReason.trim() || undefined,
        autoAccept: true,
      });

      setSelectedConvData({ ...selectedConvData, sectorId: transferSectorId });
      setShowTransferPanel(false);
      setTransferReason('');
      fetchConversations();
    } catch (err: unknown) {
      alert(getErrorMessage(err));
    } finally {
      setTransferLoading(false);
    }
  };

  const copyConversationId = async () => {
    if (!selectedConvData?.id) return;
    await navigator.clipboard?.writeText(selectedConvData.id);
  };

  // Helpers
  const formatPhone = (p: string | null) => {
    if (!p) return '';
    const c = p.replace(/\D/g, '');
    if (c.length === 13) return `+${c.slice(0,2)} ${c.slice(2,4)} ${c.slice(4,9)}-${c.slice(9)}`;
    if (c.length === 11) return `+55 ${c.slice(0,2)} ${c.slice(2,7)}-${c.slice(7)}`;
    return p;
  };

  const statusColor = (s: string) => {
    const map: Record<string, string> = { novo: '#22c55e', em_atendimento: '#3b82f6', pendente: '#eab308', em_espera: '#f97316', finalizado: '#9ca3af', open: '#22c55e', pending: '#eab308', closed: '#9ca3af' };
    return map[s] || '#999';
  };

  const statusLabel = (s: string) => {
    const map: Record<string, string> = { novo: 'novo', em_atendimento: 'atendendo', pendente: 'pendente', em_espera: 'espera', finalizado: 'finalizado', open: 'novo', pending: 'pendente', closed: 'fechado' };
    return map[s] || s;
  };

  const timeAgo = (d: string) => {
    const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
    if (m < 1) return 'agora';
    if (m < 60) return `${m}min`;
    if (m < 1440) return `${Math.floor(m / 60)}h`;
    return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };

  const filtered = conversations.filter(c => {
    if (searchTerm) {
      const name = c.contactName || '';
      const phone = c.contactPhone || '';
      return name.toLowerCase().includes(searchTerm.toLowerCase()) || phone.includes(searchTerm);
    }
    return true;
  });

  const filteredContacts = contacts.filter(c => {
    if (!contactSearch) return true;
    return (c.name || '').toLowerCase().includes(contactSearch.toLowerCase()) || (c.phone || '').includes(contactSearch);
  });

  const sectorCount = (id: string) => conversations.filter(c => c.sectorId === id).length;
  const activeSector = sectors.find(s => s.id === selectedSector);
  const selectedConversationSector = selectedConvData?.sectorId ? sectors.find(s => s.id === selectedConvData.sectorId) : undefined;
  const headerSector = selectedConversationSector ?? activeSector;
  const transferSectorOptions = sectors.filter(s => s.isActive && s.id !== selectedConvData?.sectorId);
  const normalizedMessageSearch = messageSearch.trim().toLowerCase();
  const matchingMessagesCount = normalizedMessageSearch
    ? messages.filter(msg => (msg.content || '').toLowerCase().includes(normalizedMessageSearch)).length
    : 0;

  const getDisplayName = (conv: ConversationWithContact) => {
    if (conv.contactName) return conv.contactName;
    if (conv.contactPhone) return formatPhone(conv.contactPhone);
    return 'Contato sem nome';
  };

  const getInitial = (conv: ConversationWithContact) => {
    if (conv.contactName) return conv.contactName[0].toUpperCase();
    if (conv.contactPhone) return 'TEL';
    return '?';
  };

  return (
    <div className="inbox-v2">
      {/* SIDEBAR */}
      <div className="inbox-sidebar">
        <div className="sidebar-top">
          <div className="sidebar-title-row">
            <h2>Conversas</h2>
            <button className="btn-new-conv" onClick={() => setShowNewConv(!showNewConv)}>
              {showNewConv ? '×' : 'Novo'}
            </button>
          </div>

          {/* Setores tabs */}
          <div className="sector-tabs">
            <button className={`sector-tab ${selectedSector === 'all' ? 'active' : ''}`} onClick={() => setSelectedSector('all')}>
              Todos <span className="tab-badge">{conversations.length}</span>
            </button>
            {sectors.filter(s => s.isActive).map(s => {
              const count = sectorCount(s.id);
              return (
                <button
                  key={s.id}
                  className={`sector-tab ${selectedSector === s.id ? 'active' : ''}`}
                  onClick={() => setSelectedSector(s.id)}
                >
                  {s.name} {count > 0 && <span className="tab-badge">{count}</span>}
                </button>
              );
            })}
          </div>

          <div className="sidebar-search">
            <input placeholder="Pesquisar conversas..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
        </div>

        {/* Nova conversa */}
        {showNewConv && (
          <div className="new-conv-panel">
            <div className="new-conv-tabs">
              <button className={`new-conv-tab ${newConvTab === 'contacts' ? 'active' : ''}`} onClick={() => setNewConvTab('contacts')}>Clientes</button>
              <button className={`new-conv-tab ${newConvTab === 'collaborators' ? 'active' : ''}`} onClick={() => setNewConvTab('collaborators')}>Colaboradores</button>
            </div>
            <input className="new-conv-search" placeholder="Buscar contato..." value={contactSearch} onChange={e => setContactSearch(e.target.value)} />
            <div className="new-conv-list">
              {filteredContacts.length > 0 ? filteredContacts.map(c => (
                <div key={c.id} className="new-conv-item" onClick={() => handleStartConversation(c.id)}>
                  <div className="new-conv-avatar">{(c.name || '?')[0].toUpperCase()}</div>
                  <div className="new-conv-info">
                    <div className="new-conv-name">{c.name}</div>
                    <div className="new-conv-phone">{formatPhone(c.phone)}</div>
                  </div>
                  <span className="new-conv-btn">Abrir</span>
                </div>
              )) : (
                <div className="new-conv-empty">Nenhum contato encontrado</div>
              )}
            </div>
            <button className="btn-add-contact" onClick={() => navigate('/contacts')}>＋ Cadastrar novo contato</button>
          </div>
        )}

        {/* Lista */}
        <div className="conv-list-v2">
          {loading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="empty-list">
              <span>IN</span>
              <p>Nenhuma conversa {activeSector ? `em ${activeSector.name}` : ''}</p>
            </div>
          ) : (
            filtered.map(conv => {
              const isActive = selectedConv === conv.id;
              const sector = sectors.find(s => s.id === conv.sectorId);
              const name = getDisplayName(conv);
              const initial = getInitial(conv);
              const lastMsg = conv.lastMessage?.content || 'Nova conversa';
              const st = statusColor(conv.statusV2 || conv.status);

              return (
                <div key={conv.id} className={`conv-row ${isActive ? 'active' : ''}`} onClick={() => selectConv(conv)}>
                  <div className="conv-avatar-v2" style={{ background: sector?.color || '#4361ee' }}>{initial}</div>
                  <div className="conv-content">
                    <div className="conv-header-row">
                      <span className="conv-name-v2">{name}</span>
                      <span className="conv-time-v2">{timeAgo(conv.createdAt)}</span>
                    </div>
                    <div className="conv-preview-row">
                      <span className="conv-last-msg">{lastMsg.length > 45 ? lastMsg.substring(0, 45) + '...' : lastMsg}</span>
                      <span className="conv-status-dot" style={{ background: st }} />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* CHAT */}
      <div className="inbox-main">
        {selectedConv && selectedConvData ? (
          <>
            {/* Header */}
            <div className="main-header">
              <button type="button" className="header-left header-contact-trigger" onClick={toggleConversationInfo} aria-label="Abrir informacoes do contato">
                <div className="header-avatar" style={{ background: headerSector?.color || '#4361ee' }}>
                  {getInitial(selectedConvData)}
                </div>
                <div className="header-info">
                  <div className="header-name">{getDisplayName(selectedConvData)}</div>
                  <div className="header-meta">
                    <span className="header-phone">{formatPhone(selectedConvData.contactPhone ?? null)}</span>
                    <span className="header-sector" style={{ background: (headerSector?.color || '#666') + '20', color: headerSector?.color || '#666' }}>
                      {headerSector?.name || 'Sem setor'}
                    </span>
                    <span className="header-status" style={{ color: statusColor(selectedConvData.statusV2 ?? selectedConvData.status) }}>
                      ● {statusLabel(selectedConvData.statusV2 ?? selectedConvData.status)}
                    </span>
                  </div>
                </div>
              </button>
              <div className="header-actions">
                <button type="button" className={`header-btn ${showMessageSearch ? 'active' : ''}`} title="Buscar" aria-label="Buscar mensagens" onClick={toggleMessageSearch}>BUS</button>
                <button type="button" className={`header-btn ${showTransferPanel ? 'active' : ''}`} title="Transferir" aria-label="Transferir conversa" onClick={openTransferPanel}>TRF</button>
                <button type="button" className={`header-btn ${showConversationInfo ? 'active' : ''}`} title="Info" aria-label="Informacoes da conversa" onClick={toggleConversationInfo}>ℹ️</button>
              </div>
            </div>

            {showMessageSearch && (
              <div className="message-search-bar">
                <input
                  autoFocus
                  placeholder="Buscar nesta conversa..."
                  value={messageSearch}
                  onChange={e => setMessageSearch(e.target.value)}
                />
                <span className="search-result-count">
                  {normalizedMessageSearch ? `${matchingMessagesCount} resultado${matchingMessagesCount === 1 ? '' : 's'}` : 'Digite para buscar'}
                </span>
                <button type="button" className="panel-close" onClick={() => { setShowMessageSearch(false); setMessageSearch(''); }} aria-label="Fechar busca">✕</button>
              </div>
            )}

            {showTransferPanel && (
              <form className="header-panel transfer-panel" onSubmit={handleTransfer}>
                <label className="transfer-field">
                  <span>Destino</span>
                  <select value={transferSectorId} onChange={e => setTransferSectorId(e.target.value)} required>
                    <option value="" disabled>Selecione um setor</option>
                    {transferSectorOptions.map(sector => (
                      <option key={sector.id} value={sector.id}>{sector.name}</option>
                    ))}
                  </select>
                </label>
                <label className="transfer-field transfer-reason">
                  <span>Motivo</span>
                  <input
                    value={transferReason}
                    onChange={e => setTransferReason(e.target.value)}
                    placeholder="Opcional"
                  />
                </label>
                <button type="submit" className="btn-transfer" disabled={!transferSectorId || transferLoading}>
                  {transferLoading ? 'Transferindo...' : 'Transferir'}
                </button>
                <button type="button" className="panel-close" onClick={() => setShowTransferPanel(false)} aria-label="Fechar transferencia">✕</button>
              </form>
            )}

            {showConversationInfo && (
              <div className="header-panel info-panel">
                <div className="info-item">
                  <span className="info-label">Contato</span>
                  <strong>{getDisplayName(selectedConvData)}</strong>
                  <span>{formatPhone(selectedConvData.contactPhone ?? null) || 'Telefone nao informado'}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Setor</span>
                  <strong>{headerSector?.name || 'Sem setor'}</strong>
                  <span>{statusLabel(selectedConvData.statusV2 ?? selectedConvData.status)}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Criada em</span>
                  <strong>{new Date(selectedConvData.createdAt).toLocaleDateString('pt-BR')}</strong>
                  <span>{new Date(selectedConvData.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="info-actions">
                  <button type="button" onClick={copyConversationId}>Copiar ID</button>
                  <button type="button" onClick={() => navigate('/contacts')}>Abrir contatos</button>
                </div>
                <button type="button" className="panel-close" onClick={() => setShowConversationInfo(false)} aria-label="Fechar informacoes">✕</button>
              </div>
            )}

            {/* Messages */}
            <div className="chat-bg">
              <div className="chat-messages-v2">
                {messages.length === 0 ? (
                  <div className="empty-chat-v2">
                    <div className="empty-bubble">CVG</div>
                    <p>Início da conversa com {getDisplayName(selectedConvData)}</p>
                    <span>Envie uma mensagem para começar o atendimento</span>
                  </div>
                ) : (
                  <>
                    <div className="date-separator"><span>Hoje</span></div>
                    {messages.map(msg => {
                      const isSearchMatch = Boolean(normalizedMessageSearch && (msg.content || '').toLowerCase().includes(normalizedMessageSearch));

                      return (
                        <div key={msg.id} className={`message ${msg.direction} ${isSearchMatch ? 'message-search-match' : ''}`}>
                          {msg.mediaType === 'image' && msg.mediaUrl && (
                            <div className="msg-media-v2"><img src={msg.mediaUrl} alt="Imagem" /></div>
                          )}
                          {msg.mediaType === 'audio' && msg.mediaUrl && (
                            <div className="msg-media-v2"><audio controls><source src={msg.mediaUrl} /></audio></div>
                          )}
                          {msg.content && <span className="msg-text">{msg.content}</span>}
                          <span className="msg-timestamp">
                            {new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            {msg.direction === 'outbound' && <span className="msg-ticks"> ✓✓</span>}
                          </span>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>
            </div>

            {/* Composer */}
            <div className="composer-v2">
              {selectedFile && (
                <div className="file-bar">
                  <span>Anexo: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(0)}KB)</span>
                  <button onClick={() => setSelectedFile(null)}>✕</button>
                </div>
              )}
              <form className="composer-row" onSubmit={handleSend}>
                <button type="button" className="composer-btn" title="Emoji">Aa</button>
                <input ref={fileInputRef} type="file" accept="image/*,audio/*,.pdf,.doc,.docx" onChange={e => { const f = e.target.files?.[0]; if (f && f.size <= 16 * 1024 * 1024) setSelectedFile(f); e.target.value = ''; }} style={{ display: 'none' }} />
                <button type="button" className="composer-btn" title="Anexar" onClick={() => fileInputRef.current?.click()}>+</button>
                <input className="composer-input-v2" placeholder={selectedFile ? 'Legenda (opcional)...' : 'Mensagem'} value={newMessage} onChange={e => setNewMessage(e.target.value)} autoFocus />
                <button type="submit" className="composer-send">{newMessage.trim() || selectedFile ? '➤' : 'REC'}</button>
              </form>
            </div>
          </>
        ) : (
          <div className="inbox-empty">
            <div className="empty-center">
              <div className="empty-logo">CVG</div>
              <h2>CVG Connect Desk</h2>
              <p>Selecione uma conversa na barra lateral<br />ou inicie uma nova conversa</p>
              <button className="btn-start-new" onClick={() => setShowNewConv(true)}>Nova Conversa</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
