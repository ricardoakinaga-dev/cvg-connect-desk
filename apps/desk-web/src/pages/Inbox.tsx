import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api, conversationApi, sectorApi, type ConversationListItem, type Message, type Sector } from '../lib/api';
import { realtimeClient } from '../lib/realtime';
import { useAuthStore } from '../store/auth';
import './Inbox.css';

// ==========================================
// Types
// ==========================================
interface Contact {
  id: string;
  name: string | null;
  phone: string | null;
}

interface Collaborator {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
}

type NewConvTab = 'contacts' | 'collaborators';

// ==========================================
// Helpers
// ==========================================
const formatPhone = (p: string | null | undefined): string => {
  if (!p) return '';
  const c = p.replace(/\D/g, '');
  if (c.length === 13) return `+${c.slice(0, 2)} ${c.slice(2, 4)} ${c.slice(4, 9)}-${c.slice(9)}`;
  if (c.length === 11) return `+55 ${c.slice(0, 2)} ${c.slice(2, 7)}-${c.slice(7)}`;
  if (c.length === 10) return `+55 ${c.slice(0, 2)} ${c.slice(2, 6)}-${c.slice(6)}`;
  return p;
};

const statusColor = (s: string | null | undefined): string => {
  const map: Record<string, string> = {
    novo: '#22c55e', em_atendimento: '#3b82f6', pendente: '#eab308',
    em_espera: '#f97316', finalizado: '#9ca3af', arquivado: '#6b7280',
    open: '#22c55e', pending: '#eab308', closed: '#9ca3af',
  };
  return map[s || ''] || '#999';
};

const statusLabel = (s: string | null | undefined): string => {
  const map: Record<string, string> = {
    novo: 'novo', em_atendimento: 'em atendimento', pendente: 'pendente',
    em_espera: 'em espera', finalizado: 'finalizado', arquivado: 'arquivado',
    open: 'novo', pending: 'pendente', closed: 'fechado',
  };
  return map[s || ''] || s || '';
};

const timeAgo = (d: string | null | undefined): string => {
  if (!d) return '';
  const now = Date.now();
  const then = new Date(d).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `${diffMin}min`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'ontem';
  if (diffDays < 7) return `${diffDays}d`;

  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const formatMessageDate = (d: string): string => {
  const date = new Date(d);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Hoje';
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';

  return date.toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
};

const getDateKey = (d: string): string => {
  return new Date(d).toDateString();
};

const getInitial = (name: string | null | undefined, phone: string | null | undefined): string => {
  if (name) return name.charAt(0).toUpperCase();
  if (phone) return '📞';
  return '?';
};

// ==========================================
// Component
// ==========================================
export function Inbox() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);

  // State — Data
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);

  // State — Selection
  const [selectedSector, setSelectedSector] = useState<string>('all');
  const [selectedConv, setSelectedConv] = useState<string | null>(null);
  const [selectedConvData, setSelectedConvData] = useState<ConversationListItem | null>(null);

  // State — UI
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showNewConv, setShowNewConv] = useState(false);
  const [newConvTab, setNewConvTab] = useState<NewConvTab>('contacts');
  const [contactSearch, setContactSearch] = useState('');
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [showSectorDropdown, setShowSectorDropdown] = useState(false);

  // ==========================================
  // Data fetching
  // ==========================================

  // Load sectors, contacts and collaborators on mount
  useEffect(() => {
    sectorApi.list().then(setSectors).catch(() => {});
    api.get<Contact[]>('/contacts').then(setContacts).catch(() => {});
    api.get<Collaborator[]>('/admin/users').then(u => setCollaborators(u.filter(x => x.isActive))).catch(() => {});
  }, []);

  // Fetch conversations
  const fetchConversations = useCallback(async () => {
    try {
      const params: { sectorId?: string } = {};
      if (selectedSector !== 'all') params.sectorId = selectedSector;
      const data = await conversationApi.list(params);
      setConversations(data.conversations || []);
    } catch (err) {
      console.error('[Inbox] Erro ao buscar conversas:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedSector]);

  useEffect(() => {
    fetchConversations();
    // Poll less frequently when WebSocket is connected, more when disconnected
    const intervalMs = wsConnected ? 30000 : 8000;
    const interval = setInterval(fetchConversations, intervalMs);
    return () => clearInterval(interval);
  }, [fetchConversations, wsConnected]);

  // Fetch messages for selected conversation
  const fetchMessages = useCallback(async (id: string) => {
    setLoadingMessages(true);
    try {
      const data = await conversationApi.getMessages(id, 100);
      setMessages(data.messages || []);

      // Mark as read
      api.post(`/conversations/${id}/mark-read`).catch(() => {});

      // Scroll to bottom
      requestAnimationFrame(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
      });
    } catch (err) {
      console.error('[Inbox] Erro ao buscar mensagens:', err);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (selectedConv) fetchMessages(selectedConv);
  }, [selectedConv, fetchMessages]);

  // Handle URL param for conversation selection
  useEffect(() => {
    const convId = searchParams.get('conversation');
    if (convId && convId !== selectedConv) setSelectedConv(convId);
  }, [searchParams]);

  // ==========================================
  // Realtime (WebSocket)
  // ==========================================
  useEffect(() => {
    const { user, token } = useAuthStore.getState();
    if (!user?.id || !token) return;

    realtimeClient.connect(user.id, token);

    const checkConnection = () => {
      const ws = (realtimeClient as any).ws;
      setWsConnected(ws?.readyState === WebSocket.OPEN);
    };

    const checkInterval = setInterval(checkConnection, 3000);

    return () => clearInterval(checkInterval);
  }, []);

  // Subscribe to realtime events
  useEffect(() => {
    const onMessagePersisted = (event: any) => {
      const msg = event.payload;
      if (!msg?.conversationId) return;

      if (msg.conversationId === selectedConv) {
        setMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg as Message];
        });
        requestAnimationFrame(() => {
          messagesContainerRef.current?.scrollIntoView({ behavior: 'smooth' });
        });
        api.post(`/conversations/${msg.conversationId}/mark-read`).catch(() => {});
      }
      fetchConversations();
    };

    const onConversationCreated = () => fetchConversations();

    const onConversationStatusChanged = (event: any) => {
      const convId = event.payload?.id;
      if (convId === selectedConv && selectedConvData) {
        setSelectedConvData(prev => prev ? { ...prev, statusV2: event.payload?.status } : null);
      }
      fetchConversations();
    };

    realtimeClient.subscribe('message.persisted', onMessagePersisted);
    realtimeClient.subscribe('conversation.created', onConversationCreated);
    realtimeClient.subscribe('conversation.status.changed', onConversationStatusChanged);

    return () => {
      realtimeClient.unsubscribe('message.persisted', onMessagePersisted);
      realtimeClient.unsubscribe('conversation.created', onConversationCreated);
      realtimeClient.unsubscribe('conversation.status.changed', onConversationStatusChanged);
    };
  }, [selectedConv, selectedConvData, fetchConversations]);

  // ==========================================
  // Actions
  // ==========================================

  const selectConv = useCallback((conv: ConversationListItem) => {
    setSelectedConv(conv.id);
    setSelectedConvData(conv);
    setShowNewConv(false);
    setShowStatusMenu(false);
    setSearchParams({ conversation: conv.id });
  }, [setSearchParams]);

  const handleSend = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && !selectedFile) || !selectedConv || sendingMessage) return;

    setSendingMessage(true);
    try {
      if (selectedFile) {
        const base64 = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.readAsDataURL(selectedFile);
          r.onload = () => res(r.result as string);
          r.onerror = rej;
        });
        const mediaType = selectedFile.type.startsWith('image/') ? 'image'
          : selectedFile.type.startsWith('audio/') ? 'audio' : 'document';

        await api.post('/messages', {
          conversationId: selectedConv,
          content: newMessage || '',
          recipient: selectedConvData?.contactPhone || '',
          mediaUrl: base64,
          mediaType,
          mediaMimetype: selectedFile.type,
          mediaFilename: selectedFile.name,
        });
        setSelectedFile(null);
      } else {
        await conversationApi.sendMessage({
          conversationId: selectedConv,
          content: newMessage,
          recipient: selectedConvData?.contactPhone || '',
        });
      }

      setNewMessage('');
      fetchMessages(selectedConv);
      fetchConversations();
      composerRef.current?.focus();
    } catch (err) {
      console.error('[Inbox] Erro ao enviar mensagem:', err);
    } finally {
      setSendingMessage(false);
    }
  }, [newMessage, selectedFile, selectedConv, selectedConvData, sendingMessage, fetchMessages, fetchConversations]);

  const handleStartConversation = useCallback(async (id: string, isCollaborator?: boolean) => {
    try {
      let contactId = id;

      // Se for colaborador, criar contato a partir do usuário primeiro
      if (isCollaborator) {
        const collab = collaborators.find(c => c.id === id);
        if (collab) {
          try {
            // Tentar criar contato (falha se já existe)
            const newContact = await api.post<Contact>('/contacts', {
              name: collab.name,
              phone: collab.email, // usar email como identificador
            });
            contactId = newContact.id;
          } catch {
            // Contato já existe — buscar pelo nome
            const existing = contacts.find(c => c.name === collab.name);
            if (existing) {
              contactId = existing.id;
            } else {
              // Fallback: recarregar contatos e tentar encontrar
              const refreshed = await api.get<Contact[]>('/contacts');
              setContacts(refreshed);
              const found = refreshed.find(c => c.name === collab.name);
              if (found) contactId = found.id;
              else return; // Não foi possível resolver
            }
          }
        }
      }

      const result = await api.post<{ conversationId: string; isNew: boolean }>(
        `/contacts/${contactId}/start-conversation`,
        { sectorId: selectedSector !== 'all' ? selectedSector : undefined }
      );
      setShowNewConv(false);
      setContactSearch('');
      fetchConversations();
      setSelectedConv(result.conversationId);
    } catch (err: any) {
      console.error('[Inbox] Erro ao iniciar conversa:', err);
    }
  }, [selectedSector, fetchConversations, collaborators, contacts]);

  const handleTransfer = useCallback(async (toSectorId: string) => {
    if (!selectedConv) return;
    try {
      await conversationApi.transfer(selectedConv, toSectorId);
      setShowTransferModal(false);
      fetchConversations();

      // Update local data
      const newSector = sectors.find(s => s.id === toSectorId);
      if (newSector && selectedConvData) {
        setSelectedConvData({
          ...selectedConvData,
          sectorId: toSectorId,
          sectorName: newSector.name,
          sectorIcon: newSector.icon,
          sectorColor: newSector.color,
        });
      }
    } catch (err) {
      console.error('[Inbox] Erro ao transferir:', err);
    }
  }, [selectedConv, selectedConvData, sectors, fetchConversations]);

  const handleStatusChange = useCallback(async (statusV2: string) => {
    if (!selectedConv) return;
    try {
      await conversationApi.updateStatus(selectedConv, statusV2);
      setShowStatusMenu(false);
      fetchConversations();
      if (selectedConvData) {
        setSelectedConvData({ ...selectedConvData, statusV2: statusV2 as any });
      }
    } catch (err) {
      console.error('[Inbox] Erro ao atualizar status:', err);
    }
  }, [selectedConv, selectedConvData, fetchConversations]);

  const handleCloseConversation = useCallback(async () => {
    if (!selectedConv) return;
    try {
      await conversationApi.close(selectedConv);
      fetchConversations();
      setSelectedConv(null);
      setSelectedConvData(null);
    } catch (err) {
      console.error('[Inbox] Erro ao fechar conversa:', err);
    }
  }, [selectedConv, fetchConversations]);

  // ==========================================
  // Computed values
  // ==========================================

  const filteredConversations = useMemo(() => {
    if (!searchTerm) return conversations;
    const term = searchTerm.toLowerCase();
    return conversations.filter(c => {
      const name = (c.contactName || '').toLowerCase();
      const phone = (c.contactPhone || '');
      const lastMsg = (c.lastMessage?.content || '').toLowerCase();
      return name.includes(term) || phone.includes(searchTerm) || lastMsg.includes(term);
    });
  }, [conversations, searchTerm]);

  const filteredContacts = useMemo(() => {
    if (newConvTab === 'collaborators') {
      const list = collaborators.map(c => ({ id: c.id, name: c.name, phone: c.email }));
      if (!contactSearch) return list;
      const term = contactSearch.toLowerCase();
      return list.filter(c => (c.name || '').toLowerCase().includes(term) || (c.phone || '').toLowerCase().includes(term));
    }
    if (!contactSearch) return contacts;
    const term = contactSearch.toLowerCase();
    return contacts.filter(c =>
      (c.name || '').toLowerCase().includes(term) || (c.phone || '').includes(contactSearch)
    );
  }, [contacts, collaborators, contactSearch, newConvTab]);

  const sectorCounts = useMemo(() => {
    const counts: Record<string, number> = { all: conversations.length };
    for (const conv of conversations) {
      if (conv.sectorId) {
        counts[conv.sectorId] = (counts[conv.sectorId] || 0) + 1;
      }
    }
    return counts;
  }, [conversations]);

  const totalUnread = useMemo(() => {
    return conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
  }, [conversations]);

  // Group messages by date
  const messageGroups = useMemo(() => {
    const groups: { date: string; messages: Message[] }[] = [];
    let currentDate = '';

    for (const msg of messages) {
      const dateKey = getDateKey(msg.createdAt);
      if (dateKey !== currentDate) {
        currentDate = dateKey;
        groups.push({ date: msg.createdAt, messages: [] });
      }
      groups[groups.length - 1].messages.push(msg);
    }

    return groups;
  }, [messages]);

  // Active sector data for the selected conversation
  const convSector = useMemo(() => {
    if (!selectedConvData?.sectorId) return null;
    return sectors.find(s => s.id === selectedConvData.sectorId) || null;
  }, [selectedConvData, sectors]);

  // ==========================================
  // Keyboard shortcuts
  // ==========================================
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Escape to deselect conversation
      if (e.key === 'Escape') {
        if (showTransferModal) { setShowTransferModal(false); return; }
        if (showStatusMenu) { setShowStatusMenu(false); return; }
        if (showNewConv) { setShowNewConv(false); return; }
        setSelectedConv(null);
        setSelectedConvData(null);
        setSearchParams({});
      }
      // Ctrl+N for new conversation
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        setShowNewConv(prev => !prev);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showTransferModal, showStatusMenu, showNewConv, setSearchParams]);

  // ==========================================
  // Render
  // ==========================================
  return (
    <div className="inbox">
      {/* ========== SIDEBAR ========== */}
      <aside className="inbox-sidebar">
        {/* Sidebar header */}
        <header className="sidebar-header">
          <div className="sidebar-title">
            <h2>💬 Conversas</h2>
            {totalUnread > 0 && <span className="total-unread-badge">{totalUnread}</span>}
          </div>
        </header>

        {/* Actions row — new conv + sectors dropdown */}
        <div className="sector-btns-row">
          <button
            className={`btn-new-conv ${showNewConv ? 'active' : ''}`}
            onClick={() => { setShowNewConv(!showNewConv); setContactSearch(''); }}
            title="Nova conversa (Ctrl+N)"
          >
            {showNewConv ? '✕' : '＋'}
          </button>

          {/* Sector dropdown */}
          <div className="sector-dropdown-wrapper">
            <button
              className="sector-dropdown-trigger"
              onClick={() => setShowSectorDropdown(!showSectorDropdown)}
            >
              <span>
                {selectedSector === 'all'
                  ? 'Todos'
                  : (() => { const s = sectors.find(s => s.id === selectedSector); return s ? `${s.icon} ${s.name}` : 'Setor'; })()
                }
              </span>
              <span className={`dropdown-arrow ${showSectorDropdown ? 'open' : ''}`}>▾</span>
              {selectedSector !== 'all' && (
                <span className="sector-count">{sectorCounts[selectedSector] || 0}</span>
              )}
            </button>

            {showSectorDropdown && (
              <>
                <div className="sector-dropdown-backdrop" onClick={() => setShowSectorDropdown(false)} />
                <div className="sector-dropdown-menu">
                  <button
                    className={`sector-dropdown-item ${selectedSector === 'all' ? 'active' : ''}`}
                    onClick={() => { setSelectedSector('all'); setShowSectorDropdown(false); }}
                  >
                    <span>📋</span>
                    <span>Todos</span>
                    <span className="sector-count">{sectorCounts.all}</span>
                  </button>
                  {sectors.filter(s => s.isActive).map(s => (
                    <button
                      key={s.id}
                      className={`sector-dropdown-item ${selectedSector === s.id ? 'active' : ''}`}
                      onClick={() => { setSelectedSector(s.id); setShowSectorDropdown(false); }}
                    >
                      <span>{s.icon}</span>
                      <span>{s.name}</span>
                      {(sectorCounts[s.id] || 0) > 0 && (
                        <span className="sector-count">{sectorCounts[s.id]}</span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="sidebar-search">
          <input
            type="text"
            placeholder="🔍 Pesquisar conversas..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button className="search-clear" onClick={() => setSearchTerm('')}>✕</button>
          )}
        </div>

        {/* New conversation panel */}
        {showNewConv && (
          <div className="new-conv-panel">
            <div className="new-conv-tabs">
              <button
                className={`new-conv-tab ${newConvTab === 'contacts' ? 'active' : ''}`}
                onClick={() => setNewConvTab('contacts')}
              >
                👤 Clientes
              </button>
              <button
                className={`new-conv-tab ${newConvTab === 'collaborators' ? 'active' : ''}`}
                onClick={() => setNewConvTab('collaborators')}
              >
                👩‍⚕️ Colaboradores
              </button>
            </div>

            <div className="new-conv-search-wrapper">
              <input
                className="new-conv-search"
                placeholder={newConvTab === 'contacts' ? 'Buscar cliente...' : 'Buscar colaborador...'}
                value={contactSearch}
                onChange={e => setContactSearch(e.target.value)}
                autoFocus
              />
            </div>

            <div className="new-conv-list">
              {filteredContacts.length > 0 ? filteredContacts.map(c => (
                <div key={c.id} className="new-conv-item" onClick={() => handleStartConversation(c.id, newConvTab === 'collaborators')}>
                  <div className="new-conv-avatar">
                    {(c.name || '?')[0].toUpperCase()}
                  </div>
                  <div className="new-conv-info">
                    <span className="new-conv-name">{c.name || 'Sem nome'}</span>
                    <span className="new-conv-phone">
                      {newConvTab === 'collaborators' ? c.phone : formatPhone(c.phone)}
                    </span>
                  </div>
                  <span className="new-conv-action">💬</span>
                </div>
              )) : (
                <div className="new-conv-empty">
                  <span>📭</span>
                  <p>{newConvTab === 'contacts' ? 'Nenhum cliente encontrado' : 'Nenhum colaborador encontrado'}</p>
                </div>
              )}
            </div>

            {newConvTab === 'contacts' && (
              <button className="btn-add-contact" onClick={() => navigate('/contacts')}>
                ＋ Cadastrar novo contato
              </button>
            )}
          </div>
        )}

        {/* Conversation list */}
        <div className="conv-list">
          {loading ? (
            <div className="loading-state">
              <div className="spinner" />
              <span>Carregando conversas...</span>
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">📭</span>
              <p>
                {searchTerm
                  ? 'Nenhuma conversa encontrada'
                  : selectedSector !== 'all'
                    ? 'Nenhuma conversa neste setor'
                    : 'Nenhuma conversa ainda'}
              </p>
              {!searchTerm && (
                <button className="btn-start-conv" onClick={() => setShowNewConv(true)}>
                  Iniciar conversa
                </button>
              )}
            </div>
          ) : (
            filteredConversations.map(conv => {
              const isActive = selectedConv === conv.id;
              const name = conv.contactName || formatPhone(conv.contactPhone) || 'Contato sem nome';
              const initial = getInitial(conv.contactName, conv.contactPhone);
              const lastMsg = conv.lastMessage?.content || 'Nova conversa';
              const unread = conv.unreadCount || 0;
              const sectorColor = conv.sectorColor || '#4361ee';

              return (
                <div
                  key={conv.id}
                  className={`conv-item ${isActive ? 'active' : ''} ${unread > 0 ? 'unread' : ''}`}
                  onClick={() => selectConv(conv)}
                >
                  <div className="conv-avatar" style={{ background: sectorColor }}>
                    {initial}
                  </div>

                  <div className="conv-body">
                    <div className="conv-top-row">
                      <span className="conv-name">{name}</span>
                      <span className="conv-time">{timeAgo(conv.lastMessage?.createdAt || conv.createdAt)}</span>
                    </div>

                    <div className="conv-bottom-row">
                      <span className="conv-preview">
                        {conv.lastMessage?.direction === 'outbound' && <span className="preview-sent">✓ </span>}
                        {lastMsg.length > 40 ? lastMsg.substring(0, 40) + '…' : lastMsg}
                      </span>

                      <div className="conv-badges">
                        {unread > 0 && <span className="unread-badge">{unread}</span>}
                        <span
                          className="status-dot"
                          style={{ background: statusColor(conv.statusV2 || conv.status) }}
                          title={statusLabel(conv.statusV2 || conv.status)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* ========== MAIN CHAT AREA ========== */}
      <main className="inbox-main">
        {selectedConv && selectedConvData ? (
          <>
            {/* Chat header */}
            <header className="chat-header">
              <div className="chat-header-left">
                <div
                  className="chat-avatar"
                  style={{ background: convSector?.color || selectedConvData.sectorColor || '#4361ee' }}
                >
                  {getInitial(selectedConvData.contactName, selectedConvData.contactPhone)}
                </div>

                <div className="chat-header-info">
                  <span className="chat-contact-name">
                    {selectedConvData.contactName || formatPhone(selectedConvData.contactPhone) || 'Contato'}
                  </span>

                  <div className="chat-meta">
                    {selectedConvData.contactPhone && (
                      <span className="chat-phone">{formatPhone(selectedConvData.contactPhone)}</span>
                    )}

                    {convSector && (
                      <span
                        className="chat-sector-badge"
                        style={{
                          background: convSector.color + '20',
                          color: convSector.color,
                        }}
                      >
                        {convSector.icon} {convSector.name}
                      </span>
                    )}

                    <span
                      className="chat-status"
                      style={{ color: statusColor(selectedConvData.statusV2 || selectedConvData.status) }}
                    >
                      ● {statusLabel(selectedConvData.statusV2 || selectedConvData.status)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="chat-header-actions">
                {/* Status change */}
                <div className="action-menu-wrapper">
                  <button
                    className="header-action-btn"
                    title="Alterar status"
                    onClick={() => setShowStatusMenu(!showStatusMenu)}
                  >
                    🏷️
                  </button>

                  {showStatusMenu && (
                    <div className="dropdown-menu status-menu">
                      {['novo', 'em_atendimento', 'pendente', 'em_espera', 'finalizado'].map(s => (
                        <button
                          key={s}
                          className={`dropdown-item ${(selectedConvData.statusV2 || selectedConvData.status) === s ? 'current' : ''}`}
                          onClick={() => handleStatusChange(s)}
                        >
                          <span className="status-indicator" style={{ background: statusColor(s) }} />
                          {statusLabel(s)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Transfer */}
                <div className="action-menu-wrapper">
                  <button
                    className="header-action-btn"
                    title="Transferir setor"
                    onClick={() => setShowTransferModal(!showTransferModal)}
                  >
                    🔄
                  </button>

                  {showTransferModal && (
                    <div className="dropdown-menu transfer-menu">
                      <div className="dropdown-title">Transferir para:</div>
                      {sectors.filter(s => s.isActive && s.id !== selectedConvData.sectorId).map(s => (
                        <button
                          key={s.id}
                          className="dropdown-item"
                          onClick={() => handleTransfer(s.id)}
                        >
                          <span className="sector-icon">{s.icon}</span>
                          {s.name}
                        </button>
                      ))}
                      {sectors.filter(s => s.isActive && s.id !== selectedConvData.sectorId).length === 0 && (
                        <div className="dropdown-empty">Nenhum outro setor disponível</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Close conversation */}
                <button
                  className="header-action-btn close-btn"
                  title="Fechar conversa"
                  onClick={handleCloseConversation}
                >
                  ✅
                </button>
              </div>
            </header>

            {/* Messages area */}
            <div className="chat-area">
              <div className="messages-container" ref={messagesContainerRef}>
                {loadingMessages ? (
                  <div className="loading-messages">
                    <div className="spinner" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="empty-chat">
                    <div className="empty-chat-bubble">👋</div>
                    <h3>Início da conversa</h3>
                    <p>Envie uma mensagem para {selectedConvData.contactName || 'este contato'}</p>
                  </div>
                ) : (
                  messageGroups.map((group, gi) => (
                    <div key={gi} className="message-group">
                      <div className="date-divider">
                        <span>{formatMessageDate(group.date)}</span>
                      </div>

                      {group.messages.map(msg => (
                        <div key={msg.id} className={`msg-bubble ${msg.direction}`}>
                          {/* Media */}
                          {(msg as any).mediaType === 'image' && (msg as any).mediaUrl && (
                            <div className="msg-media">
                              <img src={(msg as any).mediaUrl} alt="Imagem" loading="lazy" />
                            </div>
                          )}
                          {(msg as any).mediaType === 'audio' && (msg as any).mediaUrl && (
                            <div className="msg-media">
                              <audio controls preload="metadata">
                                <source src={(msg as any).mediaUrl} />
                              </audio>
                            </div>
                          )}
                          {(msg as any).mediaType === 'document' && (msg as any).mediaUrl && (
                            <div className="msg-media msg-document">
                              📄 {(msg as any).mediaFilename || 'Documento'}
                            </div>
                          )}

                          {/* Text content */}
                          {msg.content && <span className="msg-text">{msg.content}</span>}

                          {/* Timestamp + ticks */}
                          <span className="msg-meta">
                            {new Date(msg.createdAt).toLocaleTimeString('pt-BR', {
                              hour: '2-digit', minute: '2-digit',
                            })}
                            {msg.direction === 'outbound' && (
                              <span className={`msg-ticks ${msg.status === 'delivered' ? 'read' : ''}`}>
                                {msg.status === 'delivered' ? ' ✓✓' : msg.status === 'sent' ? ' ✓✓' : ' ✓'}
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Composer */}
            <div className="composer">
              {selectedFile && (
                <div className="composer-file-bar">
                  <span className="file-info">
                    📎 {selectedFile.name}
                    <span className="file-size">({(selectedFile.size / 1024).toFixed(0)}KB)</span>
                  </span>
                  <button className="file-remove" onClick={() => setSelectedFile(null)}>✕</button>
                </div>
              )}

              <form className="composer-form" onSubmit={handleSend}>
                <button type="button" className="composer-btn emoji-btn" title="Emoji">
                  😊
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f && f.size <= 16 * 1024 * 1024) setSelectedFile(f);
                    e.target.value = '';
                  }}
                  style={{ display: 'none' }}
                />

                <button
                  type="button"
                  className="composer-btn attach-btn"
                  title="Anexar arquivo"
                  onClick={() => fileInputRef.current?.click()}
                >
                  📎
                </button>

                <input
                  ref={composerRef}
                  className="composer-input"
                  placeholder={selectedFile ? 'Legenda (opcional)...' : 'Mensagem'}
                  value={newMessage}
                  onChange={e => setNewMessage(e.target.value)}
                  autoFocus
                />

                <button
                  type="submit"
                  className={`composer-send ${sendingMessage ? 'sending' : ''}`}
                  disabled={sendingMessage || (!newMessage.trim() && !selectedFile)}
                  title="Enviar mensagem"
                >
                  {sendingMessage ? '⏳' : '➤'}
                </button>
              </form>
            </div>
          </>
        ) : (
          /* Empty state — no conversation selected */
          <div className="inbox-empty-state">
            <div className="empty-state-content">
              <div className="empty-logo">🐾</div>
              <h2>CVG Connect Desk</h2>
              <p>
                Selecione uma conversa na barra lateral<br />
                ou inicie uma nova conversa
              </p>
              <button className="btn-new-chat" onClick={() => setShowNewConv(true)}>
                ✏️ Nova Conversa
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
