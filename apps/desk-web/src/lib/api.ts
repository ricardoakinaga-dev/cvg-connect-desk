// Em produção Docker, o nginx faz proxy de /api para a API.
// Usamos URLs relativas para funcionar tanto no Docker (nginx) quanto no desenvolvimento (Vite proxy).
const API_BASE_URL = (typeof import.meta.env.VITE_API_URL === 'string' && import.meta.env.VITE_API_URL.trim() !== '') ? import.meta.env.VITE_API_URL : '';

/**
 * Evento global disparado quando uma requisição autenticada recebe 401:
 * a sessão expirou e o estado sensível deve ser limpo antes de voltar ao login.
 */
export const SESSION_EXPIRED_EVENT = 'cvg:session-expired';
const SESSION_EXPIRED_NOTICE = 'Sua sessão expirou. Entre novamente para continuar.';

function isSessionCheckEndpoint(endpoint: string): boolean {
  return endpoint === '/auth/login' || endpoint === '/auth/logout';
}

function notifySessionExpired(): void {
  try {
    localStorage.removeItem('auth-storage');
  } catch {
    // Armazenamento indisponível: o evento abaixo ainda limpa o estado em memória.
  }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { notice: SESSION_EXPIRED_NOTICE } }));
  }
}

interface ApiError {
  error: string;
  message: string;
  recoverable?: boolean;
  retryable?: boolean;
}

/** Limite de conteúdo de anexo compartilhado com o backend (C05). */
export const MEDIA_MAX_BYTES = 16 * 1024 * 1024;

/** Teto de página do histórico aceito pelo backend (C06): limit máximo 100. */
export const MESSAGES_MAX_LIMIT = 100;

export type MediaKind = 'image' | 'audio' | 'video' | 'document';

export function mediaKindForFile(mimetype: string): MediaKind {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('audio/')) return 'audio';
  if (mimetype.startsWith('video/')) return 'video';
  return 'document';
}

/**
 * Erro HTTP tipado. `ambiguous` separa falha definitiva (4xx) de resultado
 * incerto (rede/timeout/5xx): só o segundo pode ser retomado com a MESMA
 * Idempotency-Key sem risco de reenvio silencioso (C04).
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly recoverable: boolean;
  readonly retryable: boolean;

  constructor(
    message: string,
    init: { status?: number; code?: string; recoverable?: boolean; retryable?: boolean } = {}
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = init.status ?? 0;
    this.code = init.code ?? 'UNKNOWN_ERROR';
    this.recoverable = init.recoverable ?? (this.status === 413 || this.status === 503);
    this.retryable = init.retryable
      ?? (this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500);
  }

  get ambiguous(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
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

  private async parseResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const error: ApiError = await response.json().catch(() => ({
        error: 'UNKNOWN_ERROR',
        message: `HTTP ${response.status}`,
      }));
      throw new ApiRequestError(error.message || `HTTP ${response.status}`, {
        status: response.status,
        code: error.error,
        recoverable: error.recoverable,
        retryable: error.retryable,
      });
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
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

    if (response.status === 401 && token && !isSessionCheckEndpoint(endpoint)) {
      notifySessionExpired();
    }

    return this.parseResponse<T>(response);
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(
    endpoint: string,
    data?: unknown,
    options?: { headers?: HeadersInit }
  ): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
      headers: options?.headers,
    });
  }

  /**
   * Upload binário dedicado (C05): corpo cru `octet-stream`, sem base64/JSON.
   * O excesso de 16 MiB é barrado no cliente antes de qualquer requisição.
   */
  async upload<T>(
    endpoint: string,
    file: Blob,
    headers: Record<string, string>,
    options?: { signal?: AbortSignal },
  ): Promise<T> {
    if (file.size > MEDIA_MAX_BYTES) {
      throw new ApiRequestError(
        `Conteúdo excede o limite de ${MEDIA_MAX_BYTES} bytes`,
        { status: 413, code: 'PAYLOAD_TOO_LARGE', recoverable: true, retryable: false }
      );
    }

    const token = this.getToken();
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: file,
      signal: options?.signal,
    });

    if (response.status === 401 && token && !isSessionCheckEndpoint(endpoint)) {
      notifySessionExpired();
    }

    return this.parseResponse<T>(response);
  }

  /**
   * Leitura de bytes protegidos. O endpoint de mídia não retorna JSON nem URL
   * pública; o token segue no request e o chamador decide como exibir o Blob.
   */
  async getBlob(endpoint: string, options?: { signal?: AbortSignal }): Promise<Blob> {
    const token = this.getToken();
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: options?.signal,
    });

    if (response.status === 401 && token && !isSessionCheckEndpoint(endpoint)) {
      notifySessionExpired();
    }

    if (!response.ok) {
      const error: ApiError = await response.json().catch(() => ({
        error: 'UNKNOWN_ERROR',
        message: `HTTP ${response.status}`,
      }));
      throw new ApiRequestError(error.message || `HTTP ${response.status}`, {
        status: response.status,
        code: error.error,
        recoverable: error.recoverable,
        retryable: error.retryable,
      });
    }

    return response.blob();
  }

  async patch<T>(endpoint: string, data: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async put<T>(endpoint: string, data: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
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
  interactionType: string | null;
  queueId: string | null;
  teamId: string | null;
  isActive: boolean;
  externalChannelId: string | null;
  externalConversationId: string | null;
  metadata: string | null;
  unreadCount: number;
  currentHandler?: 'bot' | 'human';
  statusV2?: string | null;
  assignedUserId?: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  lastMessage: Message | null;
  lastInboundMessage?: Message | null;
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
  mediaUrl?: string | null;
  mediaType?: MediaKind | null;
  mediaMimetype?: string | null;
  mediaFilename?: string | null;
  mediaAssetId?: string | null;
  mediaState?: string | null;
  mediaReasonCode?: string | null;
}

export interface SendMessageInput {
  conversationId: string;
  content: string;
  recipient?: string;
  sender?: string;
  mediaAssetId?: string;
  mediaType?: MediaKind;
  mediaMimetype?: string;
  mediaFilename?: string;
  clientMessageId?: string;
  /** Anexada de forma não enumerável pela intenção; viaja no header, nunca no JSON. */
  idempotencyKey?: string;
}

export type SendOutcome = 'accepted' | 'pending' | 'sent' | 'failed' | 'unknown_reconciling';

export interface SendMessageResult {
  messageId: string;
  conversationId: string;
  status: string;
  outcome?: SendOutcome;
  deduplicated?: boolean;
  expired?: boolean;
}

export interface MediaUploadResult {
  assetId: string;
  mediaType: MediaKind;
  mimetype: string;
  filename?: string | null;
  sizeBytes: number;
  sha256?: string;
  scanStatus: string;
  storageStatus: string;
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

export interface DeadLetterEntry {
  id: string;
  eventType: string;
  eventId: string;
  payload: unknown;
  error: string;
  failedAt: string;
  retryCount: number;
  handlerName: string;
  sourceEvent?: {
    event_id: string;
    event_type: string;
    aggregate_type: string;
    aggregate_id: string;
    occurred_at: string;
    payload: unknown;
    metadata?: Record<string, unknown>;
    correlation_id?: string;
    causation_id?: string;
    version: number;
  };
  failureContext?: {
    stage: 'worker-terminal';
    decision: 'dead-letter';
    handlerName: string;
    eventType: string;
    eventId: string;
    retryCount: number;
    retryable: boolean;
    reason: string;
    eventVersion?: number;
    correlationId?: string;
    causationId?: string;
  };
  resolved: boolean;
  resolvedAt?: string;
}

export interface DeadLetterStats {
  total: number;
  unresolved: number;
  resolved: number;
}

export interface DeadLetterOperationalSummary {
  total: number;
  unresolved: number;
  resolved: number;
  replayable: number;
  manualOnly: number;
  byHandler: Array<{
    handlerName: string;
    total: number;
    unresolved: number;
    resolved: number;
    replayable: number;
    manualOnly: number;
  }>;
  byReason: Array<{
    reason: string;
    total: number;
    unresolved: number;
    resolved: number;
    replayable: number;
    manualOnly: number;
  }>;
  lastFailedAt: string | null;
}

export interface WebhookSecurityStats {
  total: number;
  allowed: number;
  denied: number;
  byReason: {
    missing_secret: number;
    missing_signature: number;
    invalid_signature_format: number;
    invalid_signature: number;
    signature_valid: number;
  };
  lastDecisionAt: string | null;
  lastDecision: {
    reason: 'missing_secret' | 'missing_signature' | 'invalid_signature_format' | 'invalid_signature' | 'signature_valid';
    allowed: boolean;
    webhookMode: 'strict-production' | 'development-bypass' | 'hmac';
    hasSecret: boolean;
    signaturePresent?: boolean;
    statusCode?: number;
    timestamp: string;
  } | null;
}

export interface DeadLetterListResponse {
  data: DeadLetterEntry[];
  stats: DeadLetterStats;
}

export interface DeadLetterActionResponse {
  success: boolean;
  replayed: boolean;
  entry: DeadLetterEntry | null;
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

export interface Tutor {
  id: string;
  externalId: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
  patients?: Array<{
    id: string;
    name: string;
    species: string | null;
    breed: string | null;
  }>;
  conversationCount?: number;
  taskCount?: number;
}

export interface Patient {
  id: string;
  externalId: string | null;
  name: string;
  species: string | null;
  breed: string | null;
  tutorId: string | null;
  createdAt: string;
  updatedAt: string;
  tutor?: {
    id: string;
    name: string;
    phone: string | null;
  } | null;
  conversationCount?: number;
  taskCount?: number;
}

export interface PremiumDashboardSummary {
  conversations: DashboardSummary['conversations'];
  tasks: DashboardSummary['tasks'];
  alerts: DashboardSummary['alerts'];
  responseTime: {
    avgFirstResponseTime: number | null;
    avgResponseTime: number | null;
    totalConversationsWithResponse: number;
  };
  handoff: {
    totalHandoffs: number;
    totalConversations: number;
    handoffRate: number | null;
  };
  sectorBacklog: Array<{
    sectorId: string;
    sectorName: string;
    openConversations: number;
    pendingConversations: number;
    totalBacklog: number;
  }>;
  agingConversations: Array<{
    conversationId: string;
    status: 'open' | 'pending';
    sectorName: string | null;
    lastMessageAt: string | null;
    hoursSinceLastMessage: number | null;
    agingBucket: 'fresh' | 'normal' | 'old' | 'critical';
  }>;
  alertsByCriticality: { critical: number; error: number; warning: number; info: number };
  generatedAt: string;
}

export const conversationApi = {
  list: (filters?: {
    status?: string;
    queueId?: string;
    teamId?: string;
    sectorId?: string;
    limit?: number;
    cursor?: string | null;
  }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.queueId) params.append('queueId', filters.queueId);
    if (filters?.teamId) params.append('teamId', filters.teamId);
    if (filters?.sectorId) params.append('sectorId', filters.sectorId);
    if (filters?.limit) params.append('limit', String(filters.limit));
    if (filters?.cursor) params.append('cursor', filters.cursor);
    const query = params.toString() ? `?${params.toString()}` : '';
    return api.get<{
      conversations: Conversation[];
      items?: Conversation[];
      nextCursor?: string | null;
    }>(`/conversations${query}`);
  },

  getMessages: (
    conversationId: string,
    options?: number | { limit?: number; cursor?: string | null }
  ) => {
    const opts = typeof options === 'number' ? { limit: options } : (options ?? {});
    const requested = typeof opts.limit === 'number' && Number.isFinite(opts.limit)
      ? Math.trunc(opts.limit)
      : 50;
    const limit = Math.min(Math.max(requested, 1), MESSAGES_MAX_LIMIT);
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (opts.cursor) params.set('cursor', opts.cursor);
    return api.get<{ messages: Message[]; nextCursor?: string | null }>(
      `/conversations/${conversationId}/messages?${params.toString()}`
    );
  },

  markRead: (conversationId: string) => {
    return api.post<{ conversationId: string; unreadCount: number }>(`/conversations/${conversationId}/read`);
  },

  /**
   * Envio com Idempotency-Key estável por intenção (C04). A chave é lida do
   * payload de forma não enumerável e enviada apenas no header — o corpo JSON
   * permanece exatamente o DTO do contrato, sem base64/data-URL.
   */
  sendMessage: (data: SendMessageInput) => {
    const idempotencyKey = data.idempotencyKey?.trim();
    return api.post<SendMessageResult>(
      '/messages',
      data,
      idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined
    );
  },

  /** Upload dedicado de anexo (C05): bytes crus + metadados em headers. */
  uploadMedia: (
    conversationId: string,
    file: File,
    options?: { filename?: string; mediaType?: MediaKind; signal?: AbortSignal }
  ) => {
    const mediaType = options?.mediaType ?? mediaKindForFile(file.type);
    const filename = options?.filename ?? file.name;
    const headers: Record<string, string> = {
      'X-Media-Type': mediaType,
      'X-Media-Mimetype': file.type || 'application/octet-stream',
    };
    if (filename) {
      headers['X-Media-Filename'] = filename;
    }
    return api.upload<MediaUploadResult>(
      `/conversations/${conversationId}/media`,
      file,
      headers,
      { signal: options?.signal },
    );
  },

  changeState: (
    conversationId: string,
    data: {
      statusV2: string;
      expectedStatusV2?: string;
      expectedUpdatedAt?: string;
      reason?: string;
    },
  ) => api.patch<{
    conversationId: string;
    statusV2: string;
    previousStatusV2: string;
    updatedAt: string;
    deduplicated: boolean;
  }>(`/conversations/${conversationId}/state`, data),

  assign: (
    conversationId: string,
    data: {
      assigneeId: string;
      expectedAssignedUserId?: string | null;
      expectedUpdatedAt?: string;
    },
  ) => api.post<{
    conversationId: string;
    assignedUserId: string | null;
    previousAssignedUserId: string | null;
    updatedAt: string;
    deduplicated: boolean;
  }>(`/conversations/${conversationId}/assign`, data),

  handoff: (
    conversationId: string,
    data: {
      newHandler: 'bot' | 'human';
      expectedHandler?: 'bot' | 'human';
      expectedUpdatedAt?: string;
      reason?: string;
    },
  ) => api.post<{
    conversationId: string;
    currentHandler: 'bot' | 'human';
    previousHandler: 'bot' | 'human';
    updatedAt: string;
    deduplicated: boolean;
  }>(`/conversations/${conversationId}/handoff`, data),
};

export const taskApi = {
  list: (filters?: { status?: string; assignedTo?: string; priority?: string; conversationId?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.assignedTo) params.append('assignedTo', filters.assignedTo);
    if (filters?.priority) params.append('priority', filters.priority);
    if (filters?.conversationId) params.append('conversationId', filters.conversationId);
    if (filters?.limit !== undefined) params.append('limit', String(filters.limit));
    if (filters?.offset !== undefined) params.append('offset', String(filters.offset));
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

export interface InternalNote {
  id: string;
  conversationId: string | null;
  taskId: string | null;
  authorId: string;
  content: string;
  referenceType: 'conversation' | 'task' | 'tutor' | 'patient' | null;
  referenceId: string | null;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
}

export const noteApi = {
  list: (filters: { conversationId?: string; taskId?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (filters.conversationId) params.set('conversationId', filters.conversationId);
    if (filters.taskId) params.set('taskId', filters.taskId);
    if (filters.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters.offset !== undefined) params.set('offset', String(filters.offset));
    return api.get<InternalNote[]>(`/notes?${params.toString()}`);
  },

  get: (id: string) => api.get<InternalNote>(`/notes/${id}`),

  create: (data: {
    conversationId?: string;
    taskId?: string;
    referenceType?: 'conversation' | 'task' | 'tutor' | 'patient';
    referenceId?: string;
    content: string;
    metadata?: Record<string, unknown>;
  }) => api.post<InternalNote>('/notes', data),
};

export const alertApi = {
  list: (filters?: { status?: string; severity?: string; type?: string; conversationId?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.severity) params.append('severity', filters.severity);
    if (filters?.type) params.append('type', filters.type);
    if (filters?.conversationId) params.append('conversationId', filters.conversationId);
    if (filters?.limit !== undefined) params.append('limit', String(filters.limit));
    if (filters?.offset !== undefined) params.append('offset', String(filters.offset));
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

  getPremium: () => api.get<PremiumDashboardSummary>('/metrics/premium'),
};

export const tutorApi = {
  list: (search?: string) => api.get<Tutor[]>(`/tutors${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  get: (id: string) => api.get<Tutor>(`/tutors/${id}`),
  create: (data: { name: string; phone?: string; email?: string }) => api.post<Tutor>('/tutors', data),
  update: (id: string, data: { name: string; phone?: string | null; email?: string | null }) => api.put<Tutor>(`/tutors/${id}`, data),
  delete: (id: string) => api.delete<{ deleted: boolean }>(`/tutors/${id}`),
  stats: () => api.get<{ total: number }>('/tutors/stats/overview'),
};

export const patientApi = {
  list: (filters?: { search?: string; tutorId?: string; species?: string }) => {
    const params = new URLSearchParams();
    if (filters?.search) params.set('search', filters.search);
    if (filters?.tutorId) params.set('tutorId', filters.tutorId);
    if (filters?.species) params.set('species', filters.species);
    const query = params.toString() ? `?${params.toString()}` : '';
    return api.get<Patient[]>(`/patients${query}`);
  },
  get: (id: string) => api.get<Patient>(`/patients/${id}`),
  create: (data: { name: string; species?: string; breed?: string; tutorId?: string }) => api.post<Patient>('/patients', data),
  update: (id: string, data: { name: string; species?: string | null; breed?: string | null; tutorId?: string | null }) => api.put<Patient>(`/patients/${id}`, data),
  delete: (id: string) => api.delete<{ deleted: boolean }>(`/patients/${id}`),
  stats: () => api.get<{ total: number; bySpecies: Array<{ species: string; count: number }> }>('/patients/stats/overview'),
};

export const deadLetterApi = {
  list: (filters?: { resolved?: boolean; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.resolved !== undefined) params.append('resolved', String(filters.resolved));
    if (filters?.limit) params.append('limit', String(filters.limit));
    const query = params.toString() ? `?${params.toString()}` : '';
    return api.get<DeadLetterListResponse>(`/admin/dead-letters${query}`);
  },

  stats: () => {
    return api.get<DeadLetterOperationalSummary>('/admin/dead-letters/stats');
  },

  retry: (id: string) => {
    return api.post<DeadLetterActionResponse>(`/admin/dead-letters/${id}/retry`, {});
  },

  resolve: (id: string) => {
    return api.post<DeadLetterActionResponse>(`/admin/dead-letters/${id}/resolve`, {});
  },
};

export const webhookSecurityApi = {
  stats: () => {
    return api.get<WebhookSecurityStats>('/admin/webhook-security/stats');
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
  create: (data: { contactId: string; conversationId?: string; toSectorId: string; fromSectorId?: string; toUserId?: string; reason?: string; autoAccept?: boolean }) =>
    api.post<ContactTransfer>('/transfers', data),
  list: () => api.get<ContactTransfer[]>('/transfers'),
  getContactTransfers: (contactId: string) => api.get<ContactTransfer[]>(`/contacts/${contactId}/transfers`),
  accept: (id: string) => api.post(`/transfers/${id}/accept`),
  reject: (id: string) => api.post(`/transfers/${id}/reject`),
};
