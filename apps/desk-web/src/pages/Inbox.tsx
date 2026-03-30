import { useState, useEffect, useCallback } from 'react';
import { conversationApi, taskApi, alertApi, Conversation, Message, Task, Alert } from '../lib/api';
import { realtimeClient } from '../lib/realtime';
import { useAuthStore } from '../store/auth';
import './Inbox.css';

export function Inbox() {
  const { user, token } = useAuthStore();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationTasks, setConversationTasks] = useState<Task[]>([]);
  const [conversationAlerts, setConversationAlerts] = useState<Alert[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  const fetchConversations = useCallback(async () => {
    try {
      const result = await conversationApi.list();
      setConversations(result.conversations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations');
    }
  }, []);

  const fetchMessages = useCallback(async (conversationId: string) => {
    setMessagesLoading(true);
    try {
      const result = await conversationApi.getMessages(conversationId);
      setMessages(result.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  const fetchConversationContext = useCallback(async (conversationId: string) => {
    try {
      const [tasksResult, alertsResult] = await Promise.all([
        taskApi.list({}),
        alertApi.list({}),
      ]);
      const filteredTasks = tasksResult.filter(t => t.conversationId === conversationId);
      const filteredAlerts = alertsResult.filter(a => a.conversationId === conversationId);
      setConversationTasks(filteredTasks);
      setConversationAlerts(filteredAlerts);
    } catch (err) {
      console.error('Failed to load context:', err);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await fetchConversations();
      setLoading(false);
    };
    init();
    
    const interval = setInterval(fetchConversations, 30000);
    return () => clearInterval(interval);
  }, [fetchConversations]);

  useEffect(() => {
    if (selectedConversation) {
      fetchMessages(selectedConversation.id);
      fetchConversationContext(selectedConversation.id);
      
      const interval = setInterval(() => {
        fetchMessages(selectedConversation.id);
      }, 10000);
      return () => clearInterval(interval);
    }
  }, [selectedConversation, fetchMessages, fetchConversationContext]);

  // Realtime integration
  useEffect(() => {
    if (!user || !token) return;

    realtimeClient.connect(user.id, token);

    const handleMessagePersisted = (event: any) => {
      const message = event.payload?.message;
      if (!message) return;

      if (selectedConversation && message.conversationId === selectedConversation.id) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === message.id)) return prev;
          return [...prev, message as Message];
        });
      }

      setConversations((prev) => {
        return prev.map((conv) => {
          if (conv.id === message.conversationId) {
            return { ...conv, lastMessage: message as Message };
          }
          return conv;
        });
      });
    };

    const handleConversationStatusChanged = (event: any) => {
      const payload = event.payload;
      if (!payload) return;

      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id === payload.conversationId) {
            return { ...conv, status: payload.status, currentHandler: payload.currentHandler };
          }
          return conv;
        })
      );

      if (selectedConversation && payload.conversationId === selectedConversation.id) {
        setSelectedConversation((prev) =>
          prev ? { ...prev, status: payload.status, currentHandler: payload.currentHandler } : prev
        );
      }
    };

    realtimeClient.subscribe('message.persisted', handleMessagePersisted);
    realtimeClient.subscribe('conversation.status.changed', handleConversationStatusChanged);

    if (selectedConversation) {
      realtimeClient.subscribeToChannel(`conversation:${selectedConversation.id}`);
    }

    return () => {
      realtimeClient.unsubscribe('message.persisted', handleMessagePersisted);
      realtimeClient.unsubscribe('conversation.status.changed', handleConversationStatusChanged);
      if (selectedConversation) {
        realtimeClient.unsubscribeFromChannel(`conversation:${selectedConversation.id}`);
      }
    };
  }, [user, token, selectedConversation]);

  const handleSendMessage = async () => {
    if (!selectedConversation || !newMessage.trim()) return;
    
    setSending(true);
    try {
      await conversationApi.sendMessage({
        conversationId: selectedConversation.id,
        content: newMessage,
        recipient: selectedConversation.lastMessage?.sender || '',
      });
      setNewMessage('');
      await fetchMessages(selectedConversation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const filteredConversations = conversations.filter(c => {
    if (!filter) return true;
    return c.status.toLowerCase().includes(filter.toLowerCase());
  });

  const getStatusBadge = (status: string) => {
    const badges: Record<string, string> = {
      open: 'badge-success',
      pending: 'badge-warning',
      closed: 'badge-info',
      archived: 'badge-secondary',
    };
    return badges[status] || 'badge-info';
  };

  const getPriorityClass = (priority: string) => {
    const classes: Record<string, string> = {
      urgent: 'priority-urgent',
      high: 'priority-high',
      medium: 'priority-medium',
      low: 'priority-low',
    };
    return classes[priority] || '';
  };

  const getSeverityClass = (severity: string) => {
    const classes: Record<string, string> = {
      critical: 'severity-critical',
      error: 'severity-error',
      warning: 'severity-warning',
      info: 'severity-info',
    };
    return classes[severity] || '';
  };

  if (loading) return <div className="loading">Carregando conversas...</div>;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className="page-container">
      <div className="inbox-container">
        <div className="inbox-sidebar">
          <div className="inbox-header">
            <h2>Conversas</h2>
            <input
              type="text"
              placeholder="Buscar..."
              className="input inbox-search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div className="conversation-list">
            {filteredConversations.length === 0 ? (
              <div className="empty-state">Nenhuma conversa encontrada</div>
            ) : (
              filteredConversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`conversation-item ${selectedConversation?.id === conv.id ? 'active' : ''}`}
                  onClick={() => setSelectedConversation(conv)}
                >
                  <div className="conversation-header">
                    <span className="conversation-id">#{conv.id.slice(0, 8)}</span>
                    <span className={`badge ${getStatusBadge(conv.status)}`}>{conv.status}</span>
                  </div>
                  <div className="conversation-preview">
                    {conv.lastMessage?.content || 'Sem mensagens'}
                  </div>
                  <div className="conversation-time">
                    {conv.lastMessage?.sentAt ? new Date(conv.lastMessage.sentAt).toLocaleString('pt-BR') : ''}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="inbox-main">
          {!selectedConversation ? (
            <div className="empty-state">Selecione uma conversa</div>
          ) : (
            <>
              <div className="conversation-header">
                <h3>Conversa #{selectedConversation.id.slice(0, 8)}</h3>
                <span className={`badge ${getStatusBadge(selectedConversation.status)}`}>{selectedConversation.status}</span>
              </div>
              
              <div className="messages-container">
                {messagesLoading ? (
                  <div className="loading">Carregando mensagens...</div>
                ) : messages.length === 0 ? (
                  <div className="empty-state">Nenhuma mensagem nesta conversa</div>
                ) : (
                  messages.map((msg) => (
                    <div key={msg.id} className={`message ${msg.direction}`}>
                      <div className="message-content">{msg.content}</div>
                      <div className="message-meta">
                        <span className="message-sender">{msg.sender || msg.senderType}</span>
                        <span className="message-time">
                          {msg.sentAt ? new Date(msg.sentAt).toLocaleString('pt-BR') : ''}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="message-composer">
                <textarea
                  className="input"
                  placeholder="Digite sua mensagem..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                />
                <button
                  className="btn btn-primary"
                  onClick={handleSendMessage}
                  disabled={sending || !newMessage.trim()}
                >
                  {sending ? 'Enviando...' : 'Enviar'}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="inbox-context-panel">
          <div className="context-section">
            <h4>Tarefas</h4>
            {conversationTasks.length === 0 ? (
              <div className="empty-state-small">Nenhuma tarefa</div>
            ) : (
              conversationTasks.map((task) => (
                <div key={task.id} className={`context-item ${getPriorityClass(task.priority)}`}>
                  <div className="context-item-title">{task.title}</div>
                  <div className="context-item-meta">
                    <span className={`badge ${getStatusBadge(task.status)}`}>{task.status}</span>
                    <span className={`badge ${getPriorityClass(task.priority)}`}>{task.priority}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="context-section">
            <h4>Alertas</h4>
            {conversationAlerts.length === 0 ? (
              <div className="empty-state-small">Nenhum alerta</div>
            ) : (
              conversationAlerts.map((alert) => (
                <div key={alert.id} className={`context-item ${getSeverityClass(alert.severity)}`}>
                  <div className="context-item-title">{alert.title}</div>
                  <div className="context-item-meta">
                    <span className={`badge ${getSeverityClass(alert.severity)}`}>{alert.severity}</span>
                    <span className={`badge ${getStatusBadge(alert.status)}`}>{alert.status}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="context-section">
            <h4>Informações</h4>
            {selectedConversation && (
              <div className="context-info">
                <div className="info-row">
                  <span className="info-label">ID:</span>
                  <span className="info-value">{selectedConversation.id}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Status:</span>
                  <span className="info-value">{selectedConversation.status}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Criada em:</span>
                  <span className="info-value">
                    {new Date(selectedConversation.createdAt).toLocaleString('pt-BR')}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}