// Em produção Docker, o nginx faz proxy de /api para a API.
// Usamos URLs relativas para funcionar tanto no Docker (nginx) quanto no desenvolvimento (Vite proxy).
const API_BASE_URL = (typeof import.meta.env.VITE_API_URL === 'string' && import.meta.env.VITE_API_URL.trim() !== '') ? import.meta.env.VITE_API_URL : '';

interface ApiError {
  error: string;
  message: string;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getToken(): string | null {
    try {
      const stored = localStorage.getItem('auth-storage');
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.state?.token || null;
      }
    } catch {
      return null;
    }
    return null;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = this.getToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error: ApiError = await response.json().catch(() => ({
        error: 'UNKNOWN_ERROR',
        message: 'An unexpected error occurred',
      }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async put<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async patch<T>(endpoint: string, data: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }
}

export const api = new ApiClient(API_BASE_URL);

export interface Conversation {
  id: string;
  contactId: string | null;
  status: 'open' | 'pending' | 'closed' | 'archived';
  statusV2: string | null;
  sectorId: string | null;
  assignedUserId: string | null;
  currentHandler: string | null;
  interactionType: string | null;
  queueId: string | null;
  teamId: string | null;
  isActive: boolean;
  externalChannelId: string | null;
  externalConversationId: string | null;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  lastMessage: Message | null;
}

export interface Message {
  id: string;
  conversationId: string;
  direction: 'inbound' | 'outbound';
  content: string;
  sender: string | null;
  senderType: string | null;
  recipient: string | null;
  status: 'pending' | 'sent' | 'delivered' | 'failed';
  externalMessageId: string | null;
  metadata: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface Task {
  id: string;
  conversationId: string | null;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignedTo: string | null;
  createdBy: string | null;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Alert {
  id: string;
  conversationId: string | null;
  taskId: string | null;
  type: string;
  title: string;
  message: string | null;
  severity: 'info' | 'warning' | 'error' | 'critical';
  status: 'active' | 'acknowledged' | 'resolved';
  triggeredBy: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardSummary {
  conversations: {
    open: number;
    pending: number;
    closed: number;
    archived: number;
    total: number;
  };
  tasks: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    cancelled: number;
    overdue: number;
  };
  alerts: {
    total: number;
    active: number;
    acknowledged: number;
    resolved: number;
    bySeverity: {
      info: number;
      warning: number;
      error: number;
      critical: number;
    };
  };
  generatedAt: string;
}

export interface ConversationListItem {
  id: string;
  contactId: string | null;
  status: 'open' | 'pending' | 'closed' | 'archived';
  statusV2: string | null;
  sectorId: string | null;
  assignedUserId: string | null;
  currentHandler: string | null;
  interactionType: string | null;
  queueId: string | null;
  teamId: string | null;
  isActive: boolean;
  externalChannelId: string | null;
  externalConversationId: string | null;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  // Enriched fields from backend
  contactName?: string | null;
  contactPhone?: string | null;
  sectorName?: string | null;
  sectorIcon?: string | null;
  sectorColor?: string | null;
  lastMessage?: { content: string; direction: string; createdAt: string } | null;
  unreadCount?: number;
}

export const conversationApi = {
  list: (filters?: { status?: string; queueId?: string; teamId?: string; sectorId?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.queueId) params.append('queueId', filters.queueId);
    if (filters?.teamId) params.append('teamId', filters.teamId);
    if (filters?.sectorId) params.append('sectorId', filters.sectorId);
    const query = params.toString() ? `?${params.toString()}` : '';
    return api.get<{ conversations: ConversationListItem[] }>(`/conversations${query}`);
  },

  getMessages: (conversationId: string, limit = 50, before?: string) => {
    const params = new URLSearchParams();
    if (limit) params.append('limit', String(limit));
    if (before) params.append('before', before);
    const query = params.toString() ? `?${params.toString()}` : '';
    return api.get<{ messages: Message[] }>(`/conversations/${conversationId}/messages${query}`);
  },

  sendMessage: (data: { conversationId: string; content: string; recipient: string; sender?: string }) => {
    return api.post<{ messageId: string; conversationId: string; status: string }>('/messages', data);
  },

  updateStatus: (conversationId: string, statusV2: string) => {
    return api.patch(`/conversations/${conversationId}/status`, { statusV2 });
  },

  transfer: (conversationId: string, toSectorId: string, reason?: string) => {
    return api.post(`/conversations/${conversationId}/transfer`, { toSectorId, reason });
  },

  assign: (conversationId: string, userId: string) => {
    return api.patch(`/conversations/${conversationId}/assign`, { userId });
  },

  close: (conversationId: string) => {
    return api.post(`/conversations/${conversationId}/close`);
  },
};

export const taskApi = {
  list: (filters?: { status?: string; assignedTo?: string; priority?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.assignedTo) params.append('assignedTo', filters.assignedTo);
    if (filters?.priority) params.append('priority', filters.priority);
    const query = params.toString() ? `?${params.toString()}` : '';
    return api.get<Task[]>(`/tasks${query}`);
  },

  get: (id: string) => {
    return api.get<Task>(`/tasks/${id}`);
  },

  create: (data: { title: string; description?: string; conversationId?: string; priority?: string; assignedTo?: string; dueAt?: string }) => {
    return api.post<Task>('/tasks', data);
  },

  updateStatus: (id: string, data: { status: string; changedBy?: string; reason?: string }) => {
    return api.patch<Task>(`/tasks/${id}/status`, data);
  },
};

export const alertApi = {
  list: (filters?: { status?: string; severity?: string; type?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.severity) params.append('severity', filters.severity);
    if (filters?.type) params.append('type', filters.type);
    const query = params.toString() ? `?${params.toString()}` : '';
    return api.get<Alert[]>(`/alerts${query}`);
  },

  get: (id: string) => {
    return api.get<Alert>(`/alerts/${id}`);
  },

  acknowledge: (id: string, acknowledgedBy: string) => {
    return api.post<Alert>(`/alerts/${id}/acknowledge`, { acknowledgedBy });
  },

  resolve: (id: string, resolvedBy: string) => {
    return api.post<Alert>(`/alerts/${id}/resolve`, { resolvedBy });
  },
};

export const dashboardApi = {
  getSummary: () => {
    return api.get<DashboardSummary>('/metrics/summary');
  },

  getConversations: () => {
    return api.get<{ open: number; pending: number; closed: number; total: number }>('/metrics/conversations');
  },

  getOpenConversationsCount: () => {
    return api.get<{ count: number }>('/metrics/conversations/open');
  },

  getTasks: () => {
    return api.get<{ total: number; pending: number; inProgress: number; completed: number; overdue: number }>('/metrics/tasks');
  },

  getOverdueTasksCount: () => {
    return api.get<{ count: number }>('/metrics/tasks/overdue');
  },

  getAlerts: () => {
    return api.get<{ total: number; active: number; bySeverity: Record<string, number> }>('/metrics/alerts');
  },

  getActiveAlertsCount: () => {
    return api.get<{ count: number }>('/metrics/alerts/active');
  },
};

// ============================================
// FASE 9 — Enterprise Premium APIs
// ============================================

export interface Label {
  id: string;
  name: string;
  color: string;
  description: string | null;
  category: string | null;
  isSystem: boolean;
}

export interface Sector {
  id: string;
  name: string;
  code: string;
  description: string | null;
  color: string;
  icon: string;
  isActive: boolean;
  autoAssign: boolean;
  maxConcurrent: number;
}

export const labelApi = {
  list: () => api.get<Label[]>('/labels'),
  create: (data: { name: string; color?: string; description?: string; category?: string }) => api.post<Label>('/labels', data),
  update: (id: string, data: Partial<Label>) => api.put<Label>(`/labels/${id}`, data),
  delete: (id: string) => api.delete(`/labels/${id}`),
  getConversationLabels: (conversationId: string) => api.get<Label[]>(`/conversations/${conversationId}/labels`),
  addToConversation: (conversationId: string, labelId: string) => api.post(`/conversations/${conversationId}/labels`, { labelId }),
  removeFromConversation: (conversationId: string, labelId: string) => api.delete(`/conversations/${conversationId}/labels/${labelId}`),
  getContactLabels: (contactId: string) => api.get<Label[]>(`/contacts/${contactId}/labels`),
  addToContact: (contactId: string, labelId: string) => api.post(`/contacts/${contactId}/labels`, { labelId }),
};

export const sectorApi = {
  list: (all?: boolean) => api.get<Sector[]>(`/sectors${all ? '?all=true' : ''}`),
  create: (data: { name: string; code: string; description?: string; color?: string; icon?: string }) => api.post<Sector>('/sectors', data),
  update: (id: string, data: Partial<Sector>) => api.put<Sector>(`/sectors/${id}`, data),
  delete: (id: string) => api.delete(`/sectors/${id}`),
  getConversations: (id: string, status?: string) => api.get(`/sectors/${id}/conversations${status ? `?status=${status}` : ''}`),
  getStats: (id: string) => api.get(`/sectors/${id}/stats`),
  getAllStats: () => api.get('/sectors/stats/overview'),
};

export interface ContactTransfer {
  id: string;
  contactId: string;
  conversationId: string | null;
  fromSectorId: string | null;
  toSectorId: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export const transferApi = {
  create: (data: { contactId: string; conversationId?: string; toSectorId: string; fromSectorId?: string; reason?: string; autoAccept?: boolean }) =>
    api.post<ContactTransfer>('/transfers', data),
  list: () => api.get<ContactTransfer[]>('/transfers'),
  getContactTransfers: (contactId: string) => api.get<ContactTransfer[]>(`/contacts/${contactId}/transfers`),
  accept: (id: string) => api.post(`/transfers/${id}/accept`),
  reject: (id: string) => api.post(`/transfers/${id}/reject`),
};
