import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, conversationApi, labelApi, sectorApi, type Conversation, type Message, type Label, type Sector } from '../lib/api';
import { useAuthStore } from '../store/auth';
import './Inbox.css';

export function Inbox() {
  const { user } = useAuthStore();
  const [searchParams] = useSearchParams();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Data
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);

  // Selection
  const [selectedSector, setSelectedSector] = useState<string>('all');
  const [selectedConv, setSelectedConv] = useState<string | null>(null);
  const [selectedConvData, setSelectedConvData] = useState<Conversation | null>(null);

  // UI state
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showLabels, setShowLabels] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);

  // Fetch sectors
  useEffect(() => {
    sectorApi.list().then(setSectors).catch(() => {});
    labelApi.list().then(setLabels).catch(() => {});
  }, []);

  // Fetch conversations
  const fetchConversations = useCallback(async () => {
    try {
      const params: any = {};
      if (selectedSector !== 'all') params.sectorId = selectedSector;
      const data = await conversationApi.list(params);
      setConversations(data.conversations || []);
    } catch (err) { console.error('Erro:', err); }
    finally { setLoading(false); }
  }, [selectedSector]);

  useEffect(() => { fetchConversations(); const i = setInterval(fetchConversations, 10000); return () => clearInterval(i); }, [fetchConversations]);

  // Fetch messages when conversation selected
  const fetchMessages = useCallback(async (id: string) => {
    setLoadingMessages(true);
    try {
      const data = await conversationApi.getMessages(id);
      setMessages(data.messages || []);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (err) { console.error('Erro:', err); }
    finally { setLoadingMessages(false); }
  }, []);

  useEffect(() => { if (selectedConv) fetchMessages(selectedConv); }, [selectedConv, fetchMessages]);

  // Auto-select from URL
  useEffect(() => {
    const convId = searchParams.get('conversation');
    if (convId) setSelectedConv(convId);
  }, [searchParams]);

  // Select conversation
  const selectConv = (conv: Conversation) => {
    setSelectedConv(conv.id);
    setSelectedConvData(conv);
  };

  // Send message
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && !selectedFile) || !selectedConv) return;
    try {
      if (selectedFile) {
        const base64 = await fileToBase64(selectedFile);
        const mediaType = selectedFile.type.startsWith('image/') ? 'image' : selectedFile.type.startsWith('audio/') ? 'audio' : 'document';
        await api.post('/messages', { conversationId: selectedConv, content: newMessage || '', recipient: selectedConvData?.contactId || '', mediaUrl: base64, mediaType, mediaMimetype: selectedFile.type, mediaFilename: selectedFile.name });
        setSelectedFile(null);
      } else {
        await conversationApi.sendMessage({ conversationId: selectedConv, content: newMessage, recipient: selectedConvData?.contactId || '' });
      }
      setNewMessage('');
      fetchMessages(selectedConv);
      fetchConversations();
    } catch (err) { console.error('Erro:', err); }
  };

  const fileToBase64 = (file: File): Promise<string> => new Promise((res, rej) => { const r = new FileReader(); r.readAsDataURL(file); r.onload = () => res(r.result as string); r.onerror = rej; });

  // Transfer conversation
  const handleTransfer = async (toSectorId: string) => {
    if (!selectedConv || !selectedConvData?.contactId) return;
    try {
      await api.post('/transfers', { contactId: selectedConvData.contactId, conversationId: selectedConv, toSectorId, fromSectorId: selectedConvData.sectorId || undefined, autoAccept: true });
      setShowTransfer(false);
      fetchConversations();
    } catch (err: any) { alert(err.message); }
  };

  // Helpers
  const statusBadge = (s: string) => {
    const map: Record<string, { label: string; class: string }> = {
      novo: { label: 'Novo', class: 'novo' }, em_atendimento: { label: 'Atendendo', class: 'atendendo' },
      pendente: { label: 'Pendente', class: 'pendente' }, em_espera: { label: 'Espera', class: 'espera' },
      finalizado: { label: 'Finalizado', class: 'finalizado' }, open: { label: 'Aberto', class: 'novo' },
      pending: { label: 'Pendente', class: 'pendente' }, closed: { label: 'Fechado', class: 'finalizado' },
    };
    return map[s] || { label: s, class: 'default' };
  };

  const timeAgo = (d: string) => { const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000); if (m < 1) return 'agora'; if (m < 60) return `${m}min`; if (m < 1440) return `${Math.floor(m / 60)}h`; return `${Math.floor(m / 1440)}d`; };

  const filtered = conversations.filter(c => !searchTerm || (c.contactId || '').toLowerCase().includes(searchTerm.toLowerCase()) || (c.externalConversationId || '').toLowerCase().includes(searchTerm.toLowerCase()));

  const activeSector = sectors.find(s => s.id === selectedSector);
  const sectorConvCount = (sectorId: string) => conversations.filter(c => c.sectorId === sectorId).length;

  return (
    <div className="inbox-premium">
      {/* COLUNA 0 — SETORES */}
      <div className="inbox-sectors">
        <div className="sectors-header">
          <h3>📥 Inbox</h3>
        </div>

        <div className={`sector-item ${selectedSector === 'all' ? 'active' : ''}`} onClick={() => setSelectedSector('all')}>
          <div className="sector-icon" style={{ background: '#4361ee' }}>💬</div>
          <div className="sector-info">
            <div className="sector-name">Todos</div>
            <div className="sector-count">{conversations.length}</div>
          </div>
        </div>

        <div className="sectors-divider" />

        {sectors.filter(s => s.isActive).map(sector => (
          <div key={sector.id} className={`sector-item ${selectedSector === sector.id ? 'active' : ''}`} onClick={() => setSelectedSector(sector.id)}>
            <div className="sector-icon" style={{ background: sector.color }}>{sector.icon}</div>
            <div className="sector-info">
              <div className="sector-name">{sector.name}</div>
              <div className="sector-count">{sectorConvCount(sector.id)}</div>
            </div>
          </div>
        ))}
      </div>

      {/* COLUNA 1 — LISTA */}
      <div className="inbox-list">
        <div className="list-header">
          <div className="list-title">
            {activeSector ? (
              <><span className="list-sector-icon" style={{ background: activeSector.color }}>{activeSector.icon}</span> {activeSector.name}</>
            ) : (
              <><span className="list-sector-icon" style={{ background: '#4361ee' }}>💬</span> Todas as conversas</>
            )}
          </div>
          <span className="list-count">{filtered.length}</span>
        </div>

        <div className="list-search">
          <span className="search-icon">🔍</span>
          <input placeholder="Buscar conversas..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>

        <div className="conv-list">
          {loading ? (
            <div className="loading-state"><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="empty-sm">Nenhuma conversa {activeSector ? `em ${activeSector.name}` : ''}</div>
          ) : (
            filtered.map(conv => {
              const badge = statusBadge(conv.statusV2 || conv.status);
              const isSelected = selectedConv === conv.id;
              return (
                <div key={conv.id} className={`conv-item ${isSelected ? 'selected' : ''}`} onClick={() => selectConv(conv)}>
                  <div className="conv-avatar">{(conv.contactId || '?')[0].toUpperCase()}</div>
                  <div className="conv-body">
                    <div className="conv-top">
                      <span className="conv-name">{conv.contactId?.slice(0, 14) || 'Contato'}</span>
                      <span className="conv-time">{timeAgo(conv.createdAt)}</span>
                    </div>
                    <div className="conv-bottom">
                      <span className={`status-dot ${badge.class}`} />
                      <span className="conv-preview">{conv.externalConversationId || 'Conversa'}</span>
                      <span className={`badge-mini ${badge.class}`}>{badge.label}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* COLUNA 2 — CHAT */}
      <div className="inbox-chat">
        {selectedConv && selectedConvData ? (
          <>
            {/* Header do chat */}
            <div className="chat-header">
              <div className="chat-contact">
                <div className="chat-avatar">{(selectedConvData.contactId || '?')[0].toUpperCase()}</div>
                <div className="chat-info">
                  <div className="chat-name">{selectedConvData.contactId?.slice(0, 16) || 'Contato'}</div>
                  <div className="chat-meta">
                    {(() => { const b = statusBadge(selectedConvData.statusV2 || selectedConvData.status); return <span className={`badge-mini ${b.class}`}>{b.label}</span>; })()}
                    <span className="chat-sector-badge" style={{ background: activeSector?.color || '#666' }}>
                      {activeSector?.icon || '📋'} {activeSector?.name || 'Sem setor'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="chat-actions">
                <button className="btn-icon" onClick={() => setShowTransfer(!showTransfer)} title="Transferir setor">🔄</button>
                <button className="btn-icon" onClick={() => setShowLabels(!showLabels)} title="Labels">🏷️</button>
                <button className="btn-icon" title="Finalizar conversa">✅</button>
              </div>
            </div>

            {/* Transfer dropdown */}
            {showTransfer && (
              <div className="transfer-dropdown">
                <div className="dropdown-title">Transferir para:</div>
                {sectors.filter(s => s.isActive && s.id !== selectedConvData.sectorId).map(s => (
                  <button key={s.id} className="dropdown-item" onClick={() => handleTransfer(s.id)}>
                    <span style={{ color: s.color }}>{s.icon}</span> {s.name}
                  </button>
                ))}
              </div>
            )}

            {/* Labels dropdown */}
            {showLabels && (
              <div className="labels-dropdown">
                <div className="dropdown-title">Aplicar label:</div>
                {labels.map(l => (
                  <button key={l.id} className="dropdown-item" onClick={async () => { await labelApi.addToConversation(selectedConv, l.id); setShowLabels(false); }}>
                    <span className="label-dot" style={{ background: l.color }} /> {l.name}
                  </button>
                ))}
              </div>
            )}

            {/* Mensagens */}
            <div className="chat-messages">
              {loadingMessages ? (
                <div className="loading-state"><div className="spinner" /></div>
              ) : messages.length === 0 ? (
                <div className="empty-chat">
                  <span>💬</span>
                  <p>Nenhuma mensagem ainda</p>
                  <span className="empty-hint">Envie uma mensagem para iniciar o atendimento</span>
                </div>
              ) : (
                <>
                  {messages.map(msg => (
                    <div key={msg.id} className={`msg ${msg.direction}`}>
                      <div className="msg-bubble">
                        {/* Mídia */}
                        {(msg as any).mediaType === 'image' && (msg as any).mediaUrl && (
                          <div className="msg-media"><img src={(msg as any).mediaUrl} alt="Imagem" className="msg-image" onClick={() => window.open((msg as any).mediaUrl, '_blank')} /></div>
                        )}
                        {(msg as any).mediaType === 'audio' && (msg as any).mediaUrl && (
                          <div className="msg-media"><audio controls className="msg-audio"><source src={(msg as any).mediaUrl} /></audio></div>
                        )}
                        {(msg as any).mediaType === 'document' && (
                          <div className="msg-media"><a href={(msg as any).mediaUrl} target="_blank" className="msg-document">📄 {(msg as any).mediaFilename || 'Documento'}</a></div>
                        )}
                        {msg.content && <div className="msg-content">{msg.content}</div>}
                        <div className="msg-time">
                          {new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          {msg.direction === 'outbound' && <span className="msg-check"> ✓✓</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* Composer */}
            <form className="chat-composer" onSubmit={handleSend}>
              <label className="btn-attach">
                📷
                <input type="file" accept="image/*,audio/*" onChange={e => { const f = e.target.files?.[0]; if (f && f.size <= 16 * 1024 * 1024) setSelectedFile(f); e.target.value = ''; }} style={{ display: 'none' }} />
              </label>
              {selectedFile && (
                <div className="file-preview">
                  <span>📎 {selectedFile.name}</span>
                  <button type="button" onClick={() => setSelectedFile(null)}>✕</button>
                </div>
              )}
              <input
                className="composer-input"
                placeholder={selectedFile ? 'Legenda (opcional)...' : 'Digite uma mensagem...'}
                value={newMessage}
                onChange={e => setNewMessage(e.target.value)}
              />
              <button type="submit" className="btn-send" disabled={!newMessage.trim() && !selectedFile}>
                {newMessage.trim() || selectedFile ? '➤' : '🎤'}
              </button>
            </form>
          </>
        ) : (
          <div className="empty-chat-full">
            <div className="empty-chat-content">
              <div className="empty-icon-big">💬</div>
              <h2>CVG Connect Desk</h2>
              <p>Selecione uma conversa para começar o atendimento</p>
              <div className="empty-tips">
                <div className="tip">📥 Escolha um setor na barra lateral</div>
                <div className="tip">👤 Ou acesse Contatos para iniciar uma nova conversa</div>
                <div className="tip">🔄 Transfira conversas entre setores quando necessário</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
