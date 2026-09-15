import { Fragment, useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  alertApi,
  api,
  conversationApi,
  labelApi,
  noteApi,
  taskApi,
  patientApi,
  sectorApi,
  transferApi,
  tutorApi,
  type Conversation,
  type Label,
  type Message,
  type Patient,
  type Sector,
  type SendOutcome,
  type Tutor,
} from '../lib/api';
import { useAuthStore } from '../store/auth';
import { realtimeClient, type RealtimeEvent } from '../lib/realtime';
import { EmptyState, ErrorState, Icon, LoadingState } from '../components/ui';
import './Inbox.css';

type ConversationWithContact = Omit<Conversation, 'lastMessage'> & {
  contactName?: string | null;
  contactPhone?: string | null;
  sectorId?: string;
  statusV2?: string;
  lastMessage?: { content: string; direction: string; createdAt: string } | null;
  lastInboundMessage?: { content: string; direction: string; createdAt: string } | null;
};

type SendPhase = 'uploading' | 'sending' | 'pending' | 'sent' | 'failed' | 'unknown';
type SendErrorKind = 'none' | 'offline' | 'network' | 'validation' | 'send';

interface UploadedAsset {
  assetId: string;
  mediaType: string;
  mimetype: string;
  filename?: string | null;
}

interface ComposerIntention {
  key: string;
  conversationId: string;
  content: string;
  recipient: string;
  file: File | null;
  uploaded?: UploadedAsset;
  phase: SendPhase;
  outcome?: SendOutcome;
  error: string | null;
  errorKind: SendErrorKind;
  recoverable: boolean;
  messageId?: string;
  attempt: number;
}

interface ConversationDraft {
  text: string;
  file: File | null;
}

interface ContactOption {
  id: string;
  name?: string | null;
  phone?: string | null;
}

interface ContactDetails extends ContactOption {
  email?: string | null;
  tutorId?: string | null;
  patientId?: string | null;
  labels?: Label[];
}

interface SendErrorInfo {
  message: string;
  kind: SendErrorKind;
  recoverable: boolean;
  ambiguous: boolean;
}

interface LoadError {
  kind: 'error' | 'forbidden';
  message: string;
}

/** Visão de conversa usada no cabeçalho/contexto; detalhes podem faltar em deep-link fora da primeira página. */
interface ConversationView {
  id: string;
  contactId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  status?: string;
  statusV2?: string;
  sectorId?: string;
  createdAt?: string;
  updatedAt?: string;
  externalChannelId?: string | null;
  currentHandler?: 'bot' | 'human';
  assignedUserId?: string | null;
  pendingDetails?: boolean;
}

const EMPTY_CONVERSATION_VIEW = (id: string): ConversationView => ({ id, pendingDetails: true });

const CONVERSATION_STATUS_OPTIONS = [
  { value: 'open', label: 'Abertas' },
  { value: 'pending', label: 'Pendentes' },
  { value: 'closed', label: 'Finalizadas' },
  { value: 'archived', label: 'Arquivadas' },
] as const;

const CONVERSATION_STATUS_V2 = ['novo', 'em_atendimento', 'pendente', 'em_espera', 'finalizado', 'arquivado'] as const;
type ConversationStatusV2 = (typeof CONVERSATION_STATUS_V2)[number];

function statusV2For(value: string | null | undefined): ConversationStatusV2 {
  if (CONVERSATION_STATUS_V2.includes(value as ConversationStatusV2)) return value as ConversationStatusV2;
  switch (value) {
    case 'pending': return 'pendente';
    case 'closed': return 'finalizado';
    case 'archived': return 'arquivado';
    case 'open':
    default: return 'novo';
  }
}

function legacyStatusFor(value: ConversationStatusV2): Conversation['status'] {
  if (value === 'pendente' || value === 'em_espera') return 'pending';
  if (value === 'finalizado') return 'closed';
  if (value === 'arquivado') return 'archived';
  return 'open';
}

function operationErrorMessage(error: unknown, fallback: string): string {
  const value = error as { status?: number; message?: string } | null;
  if (value?.status === 401) return 'Sua sessão expirou. Entre novamente para continuar.';
  if (value?.status === 403) return 'Você não tem permissão para operar esta conversa.';
  if (value?.status === 404) return 'A conversa ou o recurso relacionado não está mais disponível.';
  if (value?.status === 409) return 'A conversa mudou em outra sessão. Atualizei os dados; confirme a operação novamente.';
  return value?.message || fallback;
}

function loadErrorFrom(error: unknown, action: string): LoadError {
  const err = (error ?? {}) as { status?: unknown; message?: unknown };
  const status = typeof err.status === 'number' ? err.status : undefined;
  const serverMessage = typeof err.message === 'string' && err.message !== 'Failed to fetch' ? err.message : '';
  if (status === 403) {
    return { kind: 'forbidden', message: 'Sua sessão não tem permissão para acessar estas conversas.' };
  }
  if (status === 401) {
    return { kind: 'error', message: 'Sua sessão expirou. Entre novamente para continuar.' };
  }
  return {
    kind: 'error',
    message: serverMessage || `Não foi possível ${action}. Verifique a conexão e tente novamente.`,
  };
}

type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';

function useLiveRealtimeStatus(): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('idle');

  useEffect(() => {
    const client = realtimeClient;
    const getState = (client as { getConnectionState?: () => { status?: RealtimeStatus } }).getConnectionState;
    const subscribe = (client as { subscribeConnectionState?: (listener: (state: { status?: RealtimeStatus }) => void) => () => void }).subscribeConnectionState;
    if (typeof getState !== 'function' || typeof subscribe !== 'function') return undefined;
    setStatus(getState.call(client).status ?? 'idle');
    return subscribe.call(client, (next) => setStatus(next.status ?? 'idle'));
  }, []);

  return status;
}

const PAGE_SIZE = 50;
const MAX_CONVERSATION_SEARCH_PAGES = 100;
const MAX_RENDERED_MESSAGES = 500;
/** Teto aceito por `GET /conversations/:id/messages` (C06): acima disso o backend responde 400. */
const MAX_HISTORY_LIMIT = 100;
/** Limite de conteúdo de anexo (C05), aplicado na seleção antes de qualquer upload. */
const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
const EMPTY_DRAFT: ConversationDraft = { text: '', file: null };

const INBOX_DRAFTS_STORAGE_KEY = 'cvg:inbox:drafts:v1';
const INBOX_INTENTIONS_STORAGE_KEY = 'cvg:inbox:intentions:v1';

type StoredDraft = { text: string; fileName?: string; fileType?: string; fileSize?: number };
type StoredIntention = Omit<ComposerIntention, 'file'>;

/** Arquivos continuam disponíveis durante a navegação SPA; o metadata textual
 * também sobrevive a desmontagem/recarregamento sem transformar bytes em JSON. */
const inMemoryDraftFiles = new Map<string, File>();

function readSessionJson<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function persistDrafts(value: Record<string, ConversationDraft>): void {
  try {
    const serializable: Record<string, StoredDraft> = {};
    for (const [conversationId, draft] of Object.entries(value)) {
      serializable[conversationId] = {
        text: draft.text,
        ...(draft.file ? {
          fileName: draft.file.name,
          fileType: draft.file.type,
          fileSize: draft.file.size,
        } : {}),
      };
    }
    sessionStorage.setItem(INBOX_DRAFTS_STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    // O rascunho em memória continua funcional quando storage está bloqueado.
  }
}

function restoreDrafts(): Record<string, ConversationDraft> {
  const stored = readSessionJson<Record<string, StoredDraft>>(INBOX_DRAFTS_STORAGE_KEY, {});
  const restored: Record<string, ConversationDraft> = {};
  for (const [conversationId, draft] of Object.entries(stored)) {
    if (!draft || typeof draft.text !== 'string') continue;
    const file = inMemoryDraftFiles.get(conversationId) ?? null;
    restored[conversationId] = { text: draft.text, file };
  }
  return restored;
}

function persistIntentions(value: Record<string, ComposerIntention>): void {
  try {
    const serializable: Record<string, StoredIntention> = {};
    for (const [conversationId, intention] of Object.entries(value)) {
      // Erros definitivos (413/4xx/conflict) e intenções concluídas não são
      // retomáveis após desmontar a tela; não reidratá-los evita um alerta
      // antigo mascarar a nova interação. Pendentes, desconhecidos e falhas
      // recuperáveis continuam persistidos para reconciliação.
      if (intention.phase === 'sent' || (intention.phase === 'failed' && intention.recoverable === false)) continue;
      const withoutFile = Object.fromEntries(
        Object.entries(intention).filter(([key]) => key !== 'file'),
      ) as StoredIntention;
      serializable[conversationId] = withoutFile;
    }
    sessionStorage.setItem(INBOX_INTENTIONS_STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    // A falha de storage não deve interromper envio nem retry idempotente.
  }
}

function restoreIntentions(drafts: Record<string, ConversationDraft>): Record<string, ComposerIntention> {
  const stored = readSessionJson<Record<string, StoredIntention>>(INBOX_INTENTIONS_STORAGE_KEY, {});
  const restored: Record<string, ComposerIntention> = {};
  for (const [conversationId, storedIntention] of Object.entries(stored)) {
    if (!storedIntention || typeof storedIntention.key !== 'string') continue;
    const draft = drafts[conversationId] ?? EMPTY_DRAFT;
    const phase = storedIntention.phase === 'sending' || storedIntention.phase === 'uploading'
      ? 'unknown'
      : storedIntention.phase;
    restored[conversationId] = {
      ...storedIntention,
      conversationId,
      file: draft.file,
      phase,
      ...(phase === 'unknown' ? {
        error: 'A tela foi reaberta enquanto o envio estava em andamento. Reenvie a mesma intenção para confirmar sem duplicar.',
        errorKind: 'network' as const,
        recoverable: true,
      } : {}),
    };
  }
  return restored;
}

function createIdempotencyKey(): string {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return `intent-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * C04: erro de rede/timeout/5xx é AMBÍGUO (a intenção pode ter sido aceita);
 * 4xx é definitivo. Só o ambíguo mantém a mesma chave para retry sem reenvio
 * silencioso. O rascunho/anexo nunca é descartado por falha.
 */
function describeSendError(error: unknown, stage: 'upload' | 'send'): SendErrorInfo {
  const err = (error ?? {}) as { status?: number; code?: string; message?: string };
  const status = typeof err.status === 'number' ? err.status : undefined;
  const serverMessage = typeof err.message === 'string' && err.message !== 'Failed to fetch' ? err.message : '';

  if (status === 413) {
    return {
      message: 'O anexo excede o limite de 16 MiB. Escolha um arquivo menor; o rascunho e o anexo foram preservados.',
      kind: 'validation',
      recoverable: false,
      ambiguous: false,
    };
  }
  if (status === 415 || status === 422) {
    return {
      message: serverMessage || 'O anexo foi recusado pela validação de segurança; nada foi enviado.',
      kind: 'validation',
      recoverable: false,
      ambiguous: false,
    };
  }
  if (err.code === 'MEDIA_ASSET_REQUIRED') {
    return {
      message: 'O servidor recusou o envio por falta da referência do upload dedicado. O rascunho e o anexo foram preservados; tente novamente para reenviar o arquivo.',
      kind: 'validation',
      recoverable: true,
      ambiguous: false,
    };
  }
  if (status === 409) {
    return {
      message: 'A chave desta intenção conflita com um envio anterior. Edite a mensagem para iniciar uma nova intenção.',
      kind: 'send',
      recoverable: false,
      ambiguous: false,
    };
  }
  if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return {
      message: serverMessage || 'O envio foi recusado pelo servidor. O rascunho e o anexo foram preservados.',
      kind: 'send',
      recoverable: false,
      ambiguous: false,
    };
  }
  if (stage === 'upload') {
    return {
      message: 'Não foi possível enviar o anexo. O rascunho e o anexo foram preservados; tente novamente.',
      kind: 'network',
      recoverable: true,
      ambiguous: false,
    };
  }
  return {
    message: 'Sem conexão ou servidor indisponível. A mensagem pode ter sido entregue; reenvie a mesma intenção para confirmar.',
    kind: 'network',
    recoverable: true,
    ambiguous: true,
  };
}

function phaseLabel(intention: ComposerIntention): string {
  switch (intention.phase) {
    case 'uploading':
      return 'Enviando anexo…';
    case 'sending':
      return 'Enviando mensagem… (pendente de confirmação)';
    case 'pending':
      return 'Pendente: aguardando confirmação do provedor';
    case 'unknown':
      return 'Resultado incerto: a mensagem pode ter sido entregue';
    case 'failed':
      return 'Falha no envio';
    case 'sent':
      return intention.outcome === 'sent'
        ? 'Entregue ao destinatário'
        : 'Aceita pelo provedor; entrega ainda não confirmada';
    default:
      return '';
  }
}

function mergeById<T extends { id: string }>(previous: T[], incoming: T[], timestamp: (item: T) => string): T[] {
  const byId = new Map<string, T>();
  for (const item of previous) byId.set(item.id, item);
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => {
    const diff = new Date(timestamp(b)).getTime() - new Date(timestamp(a)).getTime();
    if (diff !== 0) return diff;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

function messageTimestamp(message: Message): number {
  const parsed = new Date(message.createdAt).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function messageDayKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `invalid:${value}`;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function messageDayLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data não informada';
  const today = new Date();
  const todayKey = messageDayKey(today.toISOString());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayKey = messageDayKey(yesterday.toISOString());
  const key = messageDayKey(value);
  if (key === todayKey) return 'Hoje';
  if (key === yesterdayKey) return 'Ontem';
  return date.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function mediaStateLabel(message: Message): string | null {
  const state = (message.mediaState || message.mediaReasonCode || '').toLowerCase();
  if (!state) return null;
  if (state.includes('pending') || state.includes('scan')) return 'Anexo em análise de segurança; leitura bloqueada até a conclusão.';
  if (state.includes('infect')) return 'Anexo bloqueado por segurança e mantido em quarentena.';
  if (state.includes('revok')) return 'Anexo revogado e indisponível para leitura.';
  if (state.includes('expir')) return 'A autorização deste anexo expirou; solicite um novo envio.';
  if (state.includes('fail') || state.includes('unavailable')) return 'Anexo temporariamente indisponível; tente atualizar a conversa.';
  return null;
}

function mediaAssetIdFor(message: Message): string | null {
  if (message.mediaAssetId) return message.mediaAssetId;
  if (message.mediaUrl?.startsWith('asset://')) return message.mediaUrl.slice('asset://'.length) || null;
  return null;
}

function mediaReadError(error: unknown): string {
  const value = error as { code?: string; status?: number; message?: string } | null;
  const code = value?.code || '';
  if (code.includes('PENDING') || value?.status === 409) return 'Anexo em análise de segurança; leitura bloqueada até a conclusão.';
  if (code.includes('INFECTED') || value?.status === 422) return 'Anexo bloqueado por segurança e mantido em quarentena.';
  if (code.includes('NOT_FOUND') || code.includes('REVOKED') || code.includes('EXPIRED') || value?.status === 404) {
    return 'Anexo expirado, revogado ou indisponível para esta conversa.';
  }
  return 'Não foi possível ler o anexo autorizado. Tente novamente.';
}

function AuthorizedMedia({ message }: { message: Message }) {
  const assetId = mediaAssetIdFor(message);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(assetId));
  const [error, setError] = useState<string | null>(mediaStateLabel(message));

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!assetId) {
      setLoading(false);
      setError(mediaStateLabel(message) || (message.mediaUrl ? 'Mídia externa bloqueada: somente assets autorizados podem ser exibidos.' : null));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const blob = await api.getBlob(`/conversations/${message.conversationId}/media/${encodeURIComponent(assetId)}`, { signal });
      if (signal?.aborted) return;
      const nextUrl = URL.createObjectURL(blob);
      setObjectUrl(previous => {
        if (previous) URL.revokeObjectURL(previous);
        return nextUrl;
      });
    } catch (failure) {
      if (signal?.aborted) return;
      setError(mediaReadError(failure));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [assetId, message]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      controller.abort();
      setObjectUrl(previous => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
    };
  }, [load]);

  if (loading) return <div className="msg-media-state" role="status">Carregando anexo autorizado…</div>;
  if (error) {
    return (
      <div className="msg-media-state msg-media-error" role="status">
        <span>{error}</span>
        {assetId && <button type="button" onClick={() => { void load(); }}>Tentar ler novamente</button>}
      </div>
    );
  }
  if (!objectUrl) return null;

  const filename = message.mediaFilename || 'anexo';
  if (message.mediaType === 'image') {
    return <div className="msg-media-v2"><img src={objectUrl} alt={filename} /></div>;
  }
  if (message.mediaType === 'audio') {
    return <div className="msg-media-v2"><audio controls aria-label={filename}><source src={objectUrl} type={message.mediaMimetype || undefined} /></audio></div>;
  }
  if (message.mediaType === 'video') {
    return <div className="msg-media-v2"><video controls preload="metadata" src={objectUrl} aria-label={filename} /></div>;
  }
  return (
    <div className="msg-media-document">
      <Icon name="attachment" size={14} />
      <span>{filename}</span>
      <a href={objectUrl} download={filename}>Baixar</a>
    </div>
  );
}

export function Inbox() {
  const { token, user } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sectors, setSectors] = useState<Sector[]>([]);
  const [conversations, setConversations] = useState<ConversationWithContact[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);

  const [selectedSector, setSelectedSector] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedConv, setSelectedConv] = useState<string | null>(null);
  const [selectedConvData, setSelectedConvData] = useState<ConversationView | null>(null);

  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [drafts, setDrafts] = useState<Record<string, ConversationDraft>>(restoreDrafts);
  const [intentions, setIntentions] = useState<Record<string, ComposerIntention>>(() => restoreIntentions(restoreDrafts()));
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [showNewConv, setShowNewConv] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [showMessageSearch, setShowMessageSearch] = useState(false);
  const [messageSearch, setMessageSearch] = useState('');
  const [newConvTab, setNewConvTab] = useState<'contacts' | 'collaborators'>('contacts');
  const [contactSearch, setContactSearch] = useState('');
  const [online, setOnline] = useState<boolean>(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const [messagesCursor, setMessagesCursor] = useState<string | null>(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [historyExhausted, setHistoryExhausted] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [conversationsCursor, setConversationsCursor] = useState<string | null>(null);
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);

  const [conversationsError, setConversationsError] = useState<LoadError | null>(null);
  const [conversationsNotice, setConversationsNotice] = useState<string | null>(null);
  const [messagesError, setMessagesError] = useState<LoadError | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sectorsError, setSectorsError] = useState<string | null>(null);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [newConvError, setNewConvError] = useState<string | null>(null);
  const [startingConversation, setStartingConversation] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferSectorId, setTransferSectorId] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [contextContact, setContextContact] = useState<ContactDetails | null>(null);
  const [contextTutor, setContextTutor] = useState<Tutor | null>(null);
  const [contextPatient, setContextPatient] = useState<Patient | null>(null);
  const [contextLabels, setContextLabels] = useState<Label[]>([]);
  const [labelCatalog, setLabelCatalog] = useState<Label[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextActionBusy, setContextActionBusy] = useState<string | null>(null);
  const [contextActionError, setContextActionError] = useState<string | null>(null);
  const [contextNotice, setContextNotice] = useState<string | null>(null);
  const [pendingSummary, setPendingSummary] = useState<{ tasks: number; alerts: number; notes: number; capped: boolean } | null>(null);
  const realtimeStatus = useLiveRealtimeStatus();

  // A06/SA-008: resumo das pendências da conversa selecionada no painel de
  // contexto, alimentado pelas MESMAS consultas contextuais autorizadas.
  useEffect(() => {
    const conversationId = selectedConvData?.id;
    if (!conversationId) {
      setPendingSummary(null);
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      const results = await Promise.allSettled([
        taskApi.list({ conversationId, limit: 200 }),
        alertApi.list({ conversationId, limit: 200 }),
        noteApi.list({ conversationId, limit: 200 }),
      ]);
      if (cancelled) return;
      const count = (result: PromiseSettledResult<unknown[]>): number | null =>
        result.status === 'fulfilled' ? result.value.length : null;
      const tasks = count(results[0] as PromiseSettledResult<unknown[]>);
      const alerts = count(results[1] as PromiseSettledResult<unknown[]>);
      const notes = count(results[2] as PromiseSettledResult<unknown[]>);
      if (tasks === null && alerts === null && notes === null) {
        setPendingSummary(null);
        return;
      }
      const values = [tasks ?? 0, alerts ?? 0, notes ?? 0];
      setPendingSummary({
        tasks: values[0],
        alerts: values[1],
        notes: values[2],
        capped: values.some((value) => value >= 200),
      });
    })();
    return () => { cancelled = true; };
  }, [selectedConvData?.id]);

  const selectedConvRef = useRef<string | null>(selectedConv);
  const draftsRef = useRef<Record<string, ConversationDraft>>(drafts);
  const intentionsRef = useRef<Record<string, ComposerIntention>>(intentions);
  const previousOnlineRef = useRef(online);
  const conversationsFilterRef = useRef(`${selectedSector}:${statusFilter}:${searchTerm.trim()}`);
  const conversationsRequestRef = useRef(0);
  const deepLinkLookupRef = useRef<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const contextButtonRef = useRef<HTMLButtonElement>(null);
  const transferButtonRef = useRef<HTMLButtonElement>(null);
  const sendControllersRef = useRef<Record<string, AbortController>>({});
  const contextRequestRef = useRef(0);
  const stickNextRef = useRef(true);
  selectedConvRef.current = selectedConv;

  const updateDraft = useCallback((convId: string, patch: Partial<ConversationDraft>) => {
    const nextDrafts = {
      ...draftsRef.current,
      [convId]: { ...(draftsRef.current[convId] ?? EMPTY_DRAFT), ...patch },
    };
    if (patch.file) inMemoryDraftFiles.set(convId, patch.file);
    if (patch.file === null) inMemoryDraftFiles.delete(convId);
    draftsRef.current = nextDrafts;
    persistDrafts(nextDrafts);
    setDrafts(nextDrafts);
  }, []);

  const clearDraft = useCallback((convId: string) => {
    const next = { ...draftsRef.current };
    delete next[convId];
    inMemoryDraftFiles.delete(convId);
    draftsRef.current = next;
    persistDrafts(next);
    setDrafts(next);
  }, []);

  const setIntention = useCallback((convId: string, patch: Partial<ComposerIntention>) => {
    const base: ComposerIntention = intentionsRef.current[convId] ?? {
      key: '',
      conversationId: convId,
      content: '',
      recipient: '',
      file: null,
      phase: 'failed',
      error: null,
      errorKind: 'none',
      recoverable: true,
      attempt: 0,
    };
    const next = { ...base, ...patch };
    intentionsRef.current = { ...intentionsRef.current, [convId]: next };
    persistIntentions(intentionsRef.current);
    setIntentions(intentionsRef.current);
  }, []);

  const loadSectors = useCallback(() => {
    setSectorsError(null);
    sectorApi.list()
      .then((data) => { setSectors(data); setSectorsError(null); })
      .catch((err) => setSectorsError(loadErrorFrom(err, 'carregar os setores').message));
  }, []);

  const loadContacts = useCallback(() => {
    setContactsError(null);
    api.get<ContactOption[]>('/contacts')
      .then((data) => { setContacts(data); setContactsError(null); })
      .catch((err) => setContactsError(loadErrorFrom(err, 'carregar os contatos').message));
  }, []);

  useEffect(() => {
    loadSectors();
    loadContacts();
  }, [loadSectors, loadContacts]);

  const fetchConversations = useCallback(async (options?: { cursor?: string | null; append?: boolean }) => {
    const requestId = conversationsRequestRef.current + 1;
    conversationsRequestRef.current = requestId;
    const queryKey = `${selectedSector}:${statusFilter}:${searchTerm.trim().toLocaleLowerCase()}`;
    if (!options?.append) setLoading(true);
    try {
      const search = searchTerm.trim();
      let matchingContactIds: Set<string> | null = null;
      if (search) {
        // Não há parâmetro de texto no contrato de GET /conversations. A busca
        // humana usa o endpoint existente de contatos e depois percorre todas
        // as páginas autorizadas de conversas, sem limitar o resultado ao
        // primeiro lote em memória.
        const matchingContacts = await api.get<ContactOption[]>(`/contacts?search=${encodeURIComponent(search)}`);
        if (requestId !== conversationsRequestRef.current) return;
        matchingContactIds = new Set(matchingContacts.map(contact => contact.id));
      }

      let cursor = options?.cursor ?? null;
      let pageCount = 0;
      let pageItems: ConversationWithContact[] = [];
      let hasUnloadedSearchPages = false;
      do {
        const data = await conversationApi.list({
          status: statusFilter !== 'all' ? statusFilter : undefined,
          sectorId: selectedSector !== 'all' ? selectedSector : undefined,
          limit: PAGE_SIZE,
          cursor,
        });
        if (requestId !== conversationsRequestRef.current) return;
        pageItems = pageItems.concat((data.conversations || data.items || []) as ConversationWithContact[]);
        cursor = data.nextCursor ?? null;
        pageCount += 1;
        // Para uma busca, a única forma contratual de não perder resultados é
        // consumir o cursor até o fim. A paginação manual permanece para a
        // listagem normal, evitando trabalho e memória desnecessários.
        if (!search || options?.append || !cursor || pageCount >= MAX_CONVERSATION_SEARCH_PAGES) break;
      } while (cursor);

      if (search && cursor) hasUnloadedSearchPages = true;
      const incoming = matchingContactIds
        ? pageItems.filter((conversation) => {
          if (conversation.contactId && matchingContactIds?.has(conversation.contactId)) return true;
          const term = search.toLocaleLowerCase();
          return Boolean(
            conversation.contactName?.toLocaleLowerCase().includes(term)
            || conversation.contactPhone?.includes(search),
          );
        })
        : pageItems;
      const filterChanged = conversationsFilterRef.current !== queryKey;
      conversationsFilterRef.current = queryKey;
      setConversations(previous => (
        filterChanged && !options?.append
          ? mergeById([], incoming, conv => conv.updatedAt)
          : mergeById(previous, incoming, conv => conv.updatedAt)
      ));
      setConversationsCursor(search ? null : cursor);
      setConversationsError(null);
      setConversationsNotice(hasUnloadedSearchPages
        ? 'A busca percorreu o limite de páginas disponível; refine o termo para continuar.'
        : null);
    } catch (err) {
      if (requestId !== conversationsRequestRef.current) return;
      const info = loadErrorFrom(err, 'carregar as conversas');
      if (options?.append) {
        setConversationsNotice(`${info.message} As conversas já carregadas continuam disponíveis.`);
      } else {
        setConversationsError(info);
      }
    } finally {
      if (requestId === conversationsRequestRef.current) setLoading(false);
    }
  }, [searchTerm, selectedSector, statusFilter]);

  const loadMoreConversations = useCallback(async () => {
    if (!conversationsCursor || loadingMoreConversations) return;
    setLoadingMoreConversations(true);
    try {
      await fetchConversations({ cursor: conversationsCursor, append: true });
    } finally {
      setLoadingMoreConversations(false);
    }
  }, [conversationsCursor, loadingMoreConversations, fetchConversations]);

  const applyMessageStatus = useCallback((convId: string, loaded: Message[]) => {
    const intention = intentionsRef.current[convId];
    if (!intention || (intention.phase !== 'pending' && intention.phase !== 'unknown') || !intention.messageId) return;
    const match = loaded.find(message => message.id === intention.messageId);
    if (!match) return;
    if (match.status === 'delivered' || match.status === 'sent') {
      setIntention(convId, {
        phase: 'sent',
        outcome: match.status === 'delivered' ? 'sent' : 'accepted',
        error: null,
        errorKind: 'none',
      });
    } else if (match.status === 'failed') {
      setIntention(convId, {
        phase: 'failed',
        error: 'O provedor confirmou falha definitiva e a mesma chave não reenvia. O rascunho e o anexo foram preservados; edite a mensagem para criar uma nova intenção.',
        errorKind: 'send',
        recoverable: false,
      });
    }
  }, [setIntention]);

  const isNearBottom = useCallback((): boolean => {
    const el = chatScrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= 96;
  }, []);

  const scrollToBottom = useCallback(() => {
    const reduceMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    messagesEndRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  }, []);

  const fetchMessages = useCallback(async (id: string, options?: { cursor?: string | null; limit?: number; older?: boolean }) => {
    try {
      const limit = options?.limit ?? PAGE_SIZE;
      const data = await conversationApi.getMessages(id, { limit, cursor: options?.cursor ?? undefined });
      if (selectedConvRef.current !== id) return;
      const incoming = data.messages || [];
      // Sempre mescla com o que já está em tela: o polling não pode descartar
      // a janela de histórico que o operador carregou para ler.
      setMessages(previous => mergeById(previous, incoming, message => message.createdAt).slice(0, MAX_RENDERED_MESSAGES));
      if (data.nextCursor) {
        setMessagesCursor(data.nextCursor);
        setHasMoreMessages(true);
        setHistoryExhausted(false);
      } else {
        setMessagesCursor(null);
        // Sem cursor: a janela cresce até o teto do backend. Ao bater no teto
        // (page size máximo e página cheia) não há como avançar: o controle
        // some e dá lugar a uma explicação explícita, sem botão morto.
        const cappedWithoutCursor = !options?.cursor && limit >= MAX_HISTORY_LIMIT && incoming.length >= MAX_HISTORY_LIMIT;
        setHasMoreMessages(!cappedWithoutCursor && incoming.length >= limit);
        setHistoryExhausted(cappedWithoutCursor);
      }
      setMessagesError(null);
      applyMessageStatus(id, incoming);
      if (!options?.older) {
        // Só acompanha o fim da conversa se o operador já estava no fim ou
        // acabou de trocar de conversa; ler histórico não é interrompido.
        const shouldStick = stickNextRef.current || isNearBottom();
        stickNextRef.current = false;
        if (shouldStick) setTimeout(scrollToBottom, 50);
      }
    } catch (err) {
      if (selectedConvRef.current === id) {
        setMessagesError(loadErrorFrom(err, 'carregar o histórico da conversa'));
      }
    }
  }, [applyMessageStatus, isNearBottom, scrollToBottom]);

  const loadOlderMessages = useCallback(async () => {
    const id = selectedConvRef.current;
    if (!id || loadingOlder || historyExhausted) return;
    setLoadingOlder(true);
    try {
      if (messagesCursor) {
        await fetchMessages(id, { cursor: messagesCursor, older: true });
      } else {
        const nextLimit = Math.min(Math.max(messages.length + PAGE_SIZE, PAGE_SIZE * 2), MAX_HISTORY_LIMIT);
        if (nextLimit <= messages.length) {
          setHasMoreMessages(false);
          setHistoryExhausted(true);
          return;
        }
        await fetchMessages(id, { limit: nextLimit, older: true });
      }
    } finally {
      setLoadingOlder(false);
    }
  }, [messagesCursor, messages.length, loadingOlder, historyExhausted, fetchMessages]);

  const markConversationRead = useCallback(async (id: string) => {
    await conversationApi.markRead(id);
    setConversations(current => current.map(conv => conv.id === id ? { ...conv, unreadCount: 0 } : conv));
  }, []);

  // Realtime connection - substitui polling agressivo
  useEffect(() => {
    if (!token) return;

    realtimeClient.connect(token);

    return () => {
      realtimeClient.disconnect();
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;

    const handleMessagePersisted = async (event: RealtimeEvent) => {
      const payload = event.payload as { conversationId?: string };
      if (payload.conversationId && payload.conversationId === selectedConv) {
        await fetchMessages(payload.conversationId);
        await markConversationRead(payload.conversationId);
      }
      await fetchConversations();
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
  }, [token, selectedConv, fetchConversations, fetchMessages, markConversationRead]);

  // Polling de fallback: mantém lista e conversa selecionada consistentes se o WS cair.
  useEffect(() => {
    fetchConversations();
    const i = setInterval(fetchConversations, 30000);
    return () => clearInterval(i);
  }, [fetchConversations]);

  useEffect(() => {
    if (!selectedConv) return;
    const i = setInterval(() => {
      void fetchMessages(selectedConv).then(() => markConversationRead(selectedConv)).catch(() => {
        // O controle de leitura é otimista; a falha não bloqueia a conversa.
      });
    }, 5000);
    return () => clearInterval(i);
  }, [selectedConv, fetchMessages, markConversationRead]);

  useEffect(() => {
    if (!token) return;
    fetchConversations();
  }, [token, fetchConversations]);

  useEffect(() => {
    if (!selectedConv) {
      setMessages([]);
      setMessagesCursor(null);
      setHasMoreMessages(false);
      setHistoryExhausted(false);
      setMessagesError(null);
      setMessagesLoading(false);
      return;
    }
    setMessages([]);
    setMessagesCursor(null);
    setHasMoreMessages(false);
    setHistoryExhausted(false);
    setMessagesError(null);
    setMessagesLoading(true);
    stickNextRef.current = true;
    void fetchMessages(selectedConv).finally(() => {
      if (selectedConvRef.current === selectedConv) setMessagesLoading(false);
    });
    void markConversationRead(selectedConv).catch(() => {
      // O controle de leitura é otimista; a falha não bloqueia a conversa.
    });
  }, [selectedConv, fetchMessages, markConversationRead]);
  useEffect(() => {
    const c = searchParams.get('conversation');
    if (c && c !== selectedConvRef.current) {
      stickNextRef.current = true;
      selectedConvRef.current = c;
      setSelectedConv(c);
    }
  }, [searchParams]);
  useEffect(() => {
    if (!selectedConv) return;
    if (loading) return;
    const matched = conversations.find(conv => conv.id === selectedConv);
    setSelectedConvData(previous => {
      if (matched) {
        if (previous && previous.id === matched.id && !previous.pendingDetails) return previous;
        return matched;
      }
      // Deep-link para conversa fora da primeira página: mantém a seleção e
      // marca os detalhes como pendentes em vez de descartar o contexto.
      if (previous && previous.id === selectedConv) return previous;
      return EMPTY_CONVERSATION_VIEW(selectedConv);
    });
  }, [conversations, loading, selectedConv]);

  // Deep-links are allowed to point outside the first page. There is no
  // single-conversation GET in the current contract, so resolve it through
  // the same authorized cursor used by the list endpoint.
  useEffect(() => {
    if (!selectedConv || loading || conversations.some(conversation => conversation.id === selectedConv)) return;
    if (deepLinkLookupRef.current === selectedConv) return;
    deepLinkLookupRef.current = selectedConv;
    let cursor: string | null = null;
    let pageCount = 0;
    let cancelled = false;

    const lookup = async () => {
      while (!cancelled && pageCount < MAX_CONVERSATION_SEARCH_PAGES) {
        const data = await conversationApi.list({ limit: PAGE_SIZE, cursor });
        if (cancelled || selectedConvRef.current !== selectedConv) return;
        const page = (data.conversations || data.items || []) as ConversationWithContact[];
        const match = page.find(conversation => conversation.id === selectedConv);
        if (match) {
          setConversations(previous => mergeById(previous, [match], conversation => conversation.updatedAt));
          setSelectedConvData(match);
          return;
        }
        cursor = data.nextCursor ?? null;
        pageCount += 1;
        if (!cursor) return;
      }
    };

    void lookup().catch(() => {
      // O histórico selecionado continua acessível; o painel comunica que
      // os detalhes ainda não foram resolvidos, sem descartar o deep-link.
    });
    return () => { cancelled = true; };
  }, [conversations, loading, selectedConv]);

  // Enquanto os detalhes da conversa não chegam (deep-link fora da página),
  // o histórico confirma o telefone real do contato — sem inventar dados.
  useEffect(() => {
    if (!selectedConv) return;
    const inbound = messages.find(message => message.direction === 'inbound' && message.sender?.trim());
    if (!inbound?.sender) return;
    setSelectedConvData(previous => {
      if (!previous || previous.id !== selectedConv || previous.contactPhone) return previous;
      return { ...previous, contactPhone: inbound.sender };
    });
  }, [messages, selectedConv]);

  // O painel carrega apenas recursos relacionados ao contato autorizado. A
  // carga é parcial: uma falha do tutor, paciente ou labels não esconde os
  // dados que chegaram nem deixa o operador sem feedback.
  useEffect(() => {
    if (!showContext) return;
    const contactId = selectedConvData?.contactId;
    const requestId = contextRequestRef.current + 1;
    contextRequestRef.current = requestId;
    setContextContact(null);
    setContextTutor(null);
    setContextPatient(null);
    setContextLabels([]);
    setLabelCatalog([]);
    setContextError(null);
    setContextNotice(null);
    if (!contactId) {
      setContextLoading(false);
      setContextError('O contato desta conversa ainda não foi resolvido.');
      return;
    }

    setContextLoading(true);
    const loadContext = async () => {
      try {
        const contact = await api.get<ContactDetails>(`/contacts/${contactId}`);
        if (requestId !== contextRequestRef.current) return;
        setContextContact(contact);
        const partialErrors: string[] = [];

        if (contact.tutorId && tutorApi?.get) {
          try {
            setContextTutor(await tutorApi.get(contact.tutorId));
          } catch {
            partialErrors.push('Não foi possível carregar o tutor relacionado.');
          }
        }
        if (contact.patientId && patientApi?.get) {
          try {
            setContextPatient(await patientApi.get(contact.patientId));
          } catch {
            partialErrors.push('Não foi possível carregar o paciente relacionado.');
          }
        }
        if (labelApi?.getConversationLabels) {
          try {
            setContextLabels(await labelApi.getConversationLabels(selectedConvData?.id || selectedConv || ''));
          } catch {
            partialErrors.push('Não foi possível carregar as etiquetas da conversa.');
          }
        }
        if (labelApi?.list) {
          try {
            setLabelCatalog(await labelApi.list());
          } catch {
            // O catálogo é opcional para leitura do contexto.
          }
        }
        if (requestId === contextRequestRef.current) setContextError(partialErrors[0] || null);
      } catch (error) {
        if (requestId === contextRequestRef.current) {
          setContextError(operationErrorMessage(error, 'Não foi possível carregar o contexto do contato.'));
        }
      } finally {
        if (requestId === contextRequestRef.current) setContextLoading(false);
      }
    };
    void loadContext();
  }, [showContext, selectedConv, selectedConvData?.contactId, selectedConvData?.id]);

  const patchSelectedConversation = useCallback((conversationId: string, patch: Partial<ConversationView>) => {
    const listPatch = {
      ...patch,
      ...(patch.status ? { status: patch.status as Conversation['status'] } : {}),
    } as Partial<ConversationWithContact>;
    setSelectedConvData(current => current && current.id === conversationId
      ? { ...current, ...patch, pendingDetails: false }
      : current);
    setConversations(current => current.map(conversation => conversation.id === conversationId
      ? { ...conversation, ...listPatch }
      : conversation));
  }, []);

  const runContextAction = useCallback(async (
    actionKey: string,
    successMessage: string,
    action: () => Promise<void>,
  ) => {
    if (contextActionBusy) return;
    setContextActionBusy(actionKey);
    setContextActionError(null);
    setContextNotice(null);
    try {
      await action();
      setContextNotice(successMessage);
    } catch (error) {
      setContextActionError(operationErrorMessage(error, 'Não foi possível concluir a operação.'));
      if ((error as { status?: number } | null)?.status === 409 && selectedConv) {
        void fetchConversations();
        void fetchMessages(selectedConv);
      }
    } finally {
      setContextActionBusy(null);
    }
  }, [contextActionBusy, fetchConversations, fetchMessages, selectedConv]);

  const handleStateChange = useCallback((next: ConversationStatusV2) => {
    if (!selectedConv || !selectedConvData || selectedConvData.pendingDetails) return;
    const expectedStatus = statusV2For(selectedConvData.statusV2 ?? selectedConvData.status);
    void runContextAction('state', 'Status atualizado.', async () => {
      const result = await conversationApi.changeState(selectedConv, {
        statusV2: next,
        expectedStatusV2: expectedStatus,
        expectedUpdatedAt: selectedConvData.updatedAt,
      });
      patchSelectedConversation(selectedConv, {
        statusV2: result.statusV2,
        status: legacyStatusFor(result.statusV2 as ConversationStatusV2),
        updatedAt: result.updatedAt,
      });
    });
  }, [patchSelectedConversation, runContextAction, selectedConv, selectedConvData]);

  const handleHandoff = useCallback(() => {
    if (!selectedConv || !selectedConvData || selectedConvData.pendingDetails) return;
    const nextHandler = selectedConvData.currentHandler === 'human' ? 'bot' : 'human';
    void runContextAction('handoff', nextHandler === 'human' ? 'Atendimento transferido para humano.' : 'Atendimento devolvido ao bot.', async () => {
      const result = await conversationApi.handoff(selectedConv, {
        newHandler: nextHandler,
        expectedHandler: selectedConvData.currentHandler,
        expectedUpdatedAt: selectedConvData.updatedAt,
      });
      patchSelectedConversation(selectedConv, {
        currentHandler: result.currentHandler,
        updatedAt: result.updatedAt,
      });
    });
  }, [patchSelectedConversation, runContextAction, selectedConv, selectedConvData]);

  const handleAssignToMe = useCallback(() => {
    if (!selectedConv || !selectedConvData || selectedConvData.pendingDetails || !user?.id) {
      setContextActionError('O usuário da sessão ainda não foi resolvido para atribuição.');
      return;
    }
    void runContextAction('assign', 'Conversa atribuída a você.', async () => {
      const result = await conversationApi.assign(selectedConv, {
        assigneeId: user.id,
        expectedAssignedUserId: selectedConvData.assignedUserId,
        expectedUpdatedAt: selectedConvData.updatedAt,
      });
      patchSelectedConversation(selectedConv, {
        assignedUserId: result.assignedUserId,
        updatedAt: result.updatedAt,
      });
    });
  }, [patchSelectedConversation, runContextAction, selectedConv, selectedConvData, user?.id]);

  const handleLabelChange = useCallback((label: Label, add: boolean) => {
    if (!selectedConv || !labelApi) return;
    void runContextAction(`label-${label.id}`, add ? 'Etiqueta adicionada.' : 'Etiqueta removida.', async () => {
      if (add) {
        await labelApi.addToConversation(selectedConv, label.id);
        setContextLabels(current => current.some(item => item.id === label.id) ? current : [...current, label]);
      } else {
        await labelApi.removeFromConversation(selectedConv, label.id);
        setContextLabels(current => current.filter(item => item.id !== label.id));
      }
    });
  }, [runContextAction, selectedConv]);

  const openTransfer = useCallback(() => {
    if (!selectedConvData?.contactId) {
      setTransferError('O contato desta conversa ainda não foi resolvido para transferência.');
      return;
    }
    setTransferError(null);
    setTransferReason('');
    setTransferSectorId(sectors.find(sector => sector.isActive && sector.id !== selectedConvData.sectorId)?.id || '');
    setTransferOpen(true);
  }, [sectors, selectedConvData]);

  const closeTransfer = useCallback(() => {
    if (transferBusy) return;
    setTransferOpen(false);
    setTransferError(null);
    transferButtonRef.current?.focus();
  }, [transferBusy]);

  const handleTransfer = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedConv || !selectedConvData?.contactId || !transferSectorId || transferBusy) return;
    setTransferBusy(true);
    setTransferError(null);
    try {
      await transferApi.create({
        contactId: selectedConvData.contactId,
        conversationId: selectedConv,
        fromSectorId: selectedConvData.sectorId,
        toSectorId: transferSectorId,
        reason: transferReason.trim() || undefined,
        autoAccept: true,
      });
      patchSelectedConversation(selectedConv, { sectorId: transferSectorId });
      setTransferOpen(false);
      setContextNotice('Conversa transferida para o novo setor.');
      await fetchConversations();
    } catch (error) {
      setTransferError(operationErrorMessage(error, 'Não foi possível transferir a conversa.'));
    } finally {
      setTransferBusy(false);
    }
  }, [fetchConversations, patchSelectedConversation, selectedConv, selectedConvData, transferBusy, transferReason, transferSectorId]);

  // Escape fecha o painel de contexto e devolve o foco ao acionador.
  useEffect(() => {
    if (!showContext) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowContext(false);
        contextButtonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showContext]);

  useEffect(() => {
    if (!transferOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeTransfer();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeTransfer, transferOpen]);

  useEffect(() => {
    setAttachmentError(null);
  }, [selectedConv]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setOnline(navigator.onLine !== false);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const runSend = useCallback(async (intention: ComposerIntention) => {
    const convId = intention.conversationId;
    const controller = new AbortController();
    sendControllersRef.current[convId]?.abort();
    sendControllersRef.current[convId] = controller;
    const isCurrentIntention = () => intentionsRef.current[convId]?.key === intention.key;
    let uploaded = intention.uploaded;
    let stage: 'upload' | 'send' = intention.file && !uploaded ? 'upload' : 'send';
    try {
      if (intention.file && !uploaded) {
        setIntention(convId, { phase: 'uploading', error: null, errorKind: 'none' });
        const asset = await conversationApi.uploadMedia(convId, intention.file, { signal: controller.signal });
        if (controller.signal.aborted || !isCurrentIntention()) return;
        uploaded = {
          assetId: asset.assetId,
          mediaType: asset.mediaType,
          mimetype: asset.mimetype,
          filename: asset.filename ?? intention.file.name,
        };
        setIntention(convId, { uploaded, phase: 'sending' });
      }

      stage = 'send';
      const payload: Parameters<typeof conversationApi.sendMessage>[0] = {
        conversationId: convId,
        content: intention.content,
        recipient: intention.recipient,
      };
      if (uploaded) {
        payload.mediaAssetId = uploaded.assetId;
        payload.mediaMimetype = uploaded.mimetype;
        payload.mediaFilename = uploaded.filename ?? undefined;
      }
      // A chave viaja no header (C04); não enumerável para o corpo JSON seguir
      // exatamente o DTO do contrato.
      Object.defineProperty(payload, 'idempotencyKey', {
        value: intention.key,
        enumerable: false,
        configurable: true,
      });

      const result = await conversationApi.sendMessage(payload);
      if (controller.signal.aborted || !isCurrentIntention()) return;
      const outcome: SendOutcome = result.outcome
        ?? (result.status === 'delivered' ? 'sent' : result.status === 'failed' ? 'failed' : result.status === 'pending' ? 'pending' : 'accepted');

      if (outcome === 'accepted' || outcome === 'sent') {
        setIntention(convId, {
          phase: 'sent',
          outcome,
          messageId: result.messageId,
          error: null,
          errorKind: 'none',
          uploaded,
        });
        clearDraft(convId);
        stickNextRef.current = true;
        void fetchMessages(convId);
        void fetchConversations();
      } else if (outcome === 'failed') {
        setIntention(convId, {
          phase: 'failed',
          outcome,
          messageId: result.messageId,
          error: result.expired
            ? 'A janela de reenvio desta intenção expirou; o provedor não fará novo envio silencioso. Edite a mensagem para criar uma nova intenção.'
            : 'O envio falhou de forma definitiva e a mesma chave não reenvia. O rascunho e o anexo foram preservados; edite a mensagem para criar uma nova intenção.',
          errorKind: 'send',
          recoverable: false,
        });
      } else if (outcome === 'unknown_reconciling') {
        setIntention(convId, {
          phase: 'unknown',
          outcome,
          messageId: result.messageId,
          error: 'Resultado incerto: a mensagem pode ter sido entregue. Reenvie a mesma intenção (mesma chave) para confirmar sem duplicar.',
          errorKind: 'network',
          recoverable: true,
        });
      } else {
        setIntention(convId, {
          phase: 'pending',
          outcome: 'pending',
          messageId: result.messageId,
          error: null,
          errorKind: 'none',
        });
      }
    } catch (error) {
      if (controller.signal.aborted || !isCurrentIntention()) return;
      if ((error as { name?: string } | null)?.name === 'AbortError') {
        setIntention(convId, {
          phase: 'failed',
          error: 'Envio cancelado. O rascunho e o anexo foram preservados; tente novamente quando quiser.',
          errorKind: 'network',
          recoverable: true,
        });
        return;
      }
      const info = describeSendError(error, stage);
      setIntention(convId, {
        phase: stage === 'send' && info.ambiguous ? 'unknown' : 'failed',
        error: info.message,
        errorKind: info.kind,
        recoverable: info.recoverable,
      });
    } finally {
      if (sendControllersRef.current[convId] === controller) {
        delete sendControllersRef.current[convId];
      }
    }
  }, [setIntention, clearDraft, fetchMessages, fetchConversations]);

  const cancelSend = useCallback((convId: string) => {
    sendControllersRef.current[convId]?.abort();
  }, []);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const convId = selectedConvRef.current;
    if (!convId) return;

    const draft = draftsRef.current[convId] ?? EMPTY_DRAFT;
    const content = draft.text.trim();
    const file = draft.file;
    if (!content && !file) return;

    const existing = intentionsRef.current[convId];
    if (existing && (existing.phase === 'uploading' || existing.phase === 'sending')) return;

    const sameIntention = Boolean(
      existing
      && existing.phase !== 'sent'
      && existing.content === content
      && existing.file === file
    );

    const convData = selectedConvData?.id === convId ? selectedConvData : conversations.find(conv => conv.id === convId);
    const latestInbound = selectedConvRef.current === convId
      ? messages.find(message => message.direction === 'inbound' && message.sender?.trim())
      : undefined;
    const recipient = convData?.contactPhone || latestInbound?.sender || existing?.recipient || '';

    const intention: ComposerIntention = {
      key: sameIntention && existing ? existing.key : createIdempotencyKey(),
      conversationId: convId,
      content,
      recipient,
      file,
      uploaded: sameIntention && existing ? existing.uploaded : undefined,
      phase: file && !(sameIntention && existing?.uploaded) ? 'uploading' : 'sending',
      error: null,
      errorKind: 'none',
      recoverable: true,
      attempt: (existing?.attempt ?? 0) + 1,
    };

    setIntention(convId, intention);

    if (!online) {
      setIntention(convId, {
        phase: 'failed',
        error: 'Sem conexão. O rascunho e o anexo foram preservados; o envio será retomado quando a conexão voltar.',
        errorKind: 'offline',
        recoverable: true,
      });
      return;
    }

    await runSend(intention);
  };

  useEffect(() => {
    const wasOffline = previousOnlineRef.current === false;
    previousOnlineRef.current = online;
    if (!online || !wasOffline) return;

    const resumable = Object.values(intentionsRef.current).filter(intention => (
      intention.phase === 'unknown'
      || (intention.phase === 'failed' && (intention.errorKind === 'offline' || intention.errorKind === 'network'))
    ) && intention.recoverable !== false);

    for (const intention of resumable) {
      const draft = draftsRef.current[intention.conversationId];
      if (!draft || draft.text.trim() !== intention.content || draft.file !== intention.file) continue;
      void runSend(intention);
    }
  }, [online, runSend]);

  const selectConv = (conv: ConversationWithContact) => {
    selectedConvRef.current = conv.id;
    setSelectedConv(conv.id);
    setSelectedConvData(conv);
    navigate(`/inbox?conversation=${encodeURIComponent(conv.id)}`);
    setAttachmentError(null);
    setShowNewConv(false);
    setShowContext(false);
    setConversations(current => current.map(item => item.id === conv.id ? { ...item, unreadCount: 0 } : item));
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setAttachmentError(null);
    if (file && selectedConv) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setAttachmentError(`O arquivo "${file.name}" excede o limite de 16 MiB e não foi anexado.`);
      } else {
        updateDraft(selectedConv, { file });
      }
    }
    event.target.value = '';
  };

  const changeMessage = (value: string) => {
    if (selectedConv) updateDraft(selectedConv, { text: value });
  };

  const chooseFile = (file: File | null) => {
    if (selectedConv) updateDraft(selectedConv, { file });
  };

  const handleStartConversation = async (contactId: string) => {
    setNewConvError(null);
    setStartingConversation(contactId);
    try {
      const result = await api.post<{ conversationId: string; isNew: boolean }>(`/contacts/${contactId}/start-conversation`, { sectorId: selectedSector !== 'all' ? selectedSector : undefined });
      setShowNewConv(false);
      fetchConversations();
      stickNextRef.current = true;
      selectedConvRef.current = result.conversationId;
      setSelectedConv(result.conversationId);
      navigate(`/inbox?conversation=${encodeURIComponent(result.conversationId)}`);
    } catch (err) {
      setNewConvError(loadErrorFrom(err, 'iniciar a conversa').message);
    } finally {
      setStartingConversation(null);
    }
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
    const map: Record<string, string> = {
      novo: 'var(--color-success)',
      open: 'var(--color-success)',
      em_atendimento: 'var(--color-primary)',
      pendente: 'var(--color-warning)',
      pending: 'var(--color-warning)',
      em_espera: 'var(--color-error)',
      finalizado: 'var(--color-text-tertiary)',
      closed: 'var(--color-text-tertiary)',
    };
    return map[s] || 'var(--color-text-tertiary)';
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

  // Search/filtering has already been authorized and applied by the server;
  // never hide a later page by filtering only the first batch in memory.
  const filtered = conversations;

  const filteredContacts = contacts.filter(c => {
    if (!contactSearch) return true;
    return (c.name || '').toLowerCase().includes(contactSearch.toLowerCase()) || (c.phone || '').includes(contactSearch);
  });

  const sectorCount = (id: string) => conversations.filter(c => c.sectorId === id).length;
  const activeSector = sectors.find(s => s.id === selectedSector);
  const conversationSector = sectors.find(s => s.id === selectedConvData?.sectorId);
  const visibleMessages = messageSearch.trim()
    ? messages.filter(message => (message.content || '').toLowerCase().includes(messageSearch.trim().toLowerCase()))
    : messages;
  const timelineMessages = [...visibleMessages].sort((a, b) => {
    const diff = messageTimestamp(a) - messageTimestamp(b);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  const currentDraft = (selectedConv && drafts[selectedConv]) || EMPTY_DRAFT;
  const newMessage = currentDraft.text;
  const selectedFile = currentDraft.file;
  const currentIntention = selectedConv ? intentions[selectedConv] : undefined;
  const sendBusy = currentIntention?.phase === 'uploading' || currentIntention?.phase === 'sending';
  const canRetry = Boolean(currentIntention) && (
    currentIntention!.phase === 'unknown'
    || (currentIntention!.phase === 'failed' && currentIntention!.recoverable !== false)
  );

  const getDisplayName = (conv: ConversationView) => {
    if (conv.contactName) return conv.contactName;
    if (conv.contactPhone) return formatPhone(conv.contactPhone);
    return 'Contato sem nome';
  };

  const getInitial = (conv: ConversationView) => {
    if (conv.contactName) return conv.contactName[0].toUpperCase();
    if (conv.contactPhone) return 'CV';
    return '?';
  };

  const selectedStatus = selectedConvData ? (selectedConvData.statusV2 ?? selectedConvData.status) : undefined;
  const selectedPhone = selectedConvData ? formatPhone(selectedConvData.contactPhone ?? null) : '';
  const assignedLabel = selectedConvData?.assignedUserId === user?.id ? 'Você' : selectedConvData?.assignedUserId ? 'Outro responsável' : 'Sem responsável';
  const contextLabelIds = new Set(contextLabels.map(label => label.id));

  /** Confirmação visual derivada do status real da mensagem; nunca ✓✓ por padrão. */
  const deliveryMark = (status: Message['status']) => {
    switch (status) {
      case 'delivered':
        return <span className="msg-ticks is-delivered" aria-label="Entregue"> ✓✓</span>;
      case 'sent':
        return <span className="msg-ticks is-sent" aria-label="Enviado; entrega ainda não confirmada"> ✓</span>;
      case 'failed':
        return <span className="msg-ticks is-failed" aria-label="Falha no envio"> !</span>;
      default:
        return <span className="msg-ticks is-pending" aria-label="Pendente de confirmação"> …</span>;
    }
  };

  return (
    <div className={`inbox-v2 ${selectedConv ? 'has-selection' : ''} ${showContext ? 'show-context' : ''}`}>
      {/* SIDEBAR */}
      <div className="inbox-sidebar">
        <div className="sidebar-top">
          <div className="sidebar-title-row">
            <div><span className="inbox-kicker">Atendimento</span><h1>Conversas</h1></div>
            <button type="button" className="btn-new-conv" aria-label={showNewConv ? 'Fechar nova conversa' : 'Iniciar nova conversa'} onClick={() => setShowNewConv(!showNewConv)}>
              <Icon name={showNewConv ? 'close' : 'plus'} />
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
                  <i className="sector-tab-dot" style={{ background: s.color }} /> {s.name} {count > 0 && <span className="tab-badge">{count}</span>}
                </button>
              );
            })}
          </div>

          {sectorsError && (
            <div className="sidebar-inline-error" role="alert">
              <span>{sectorsError}</span>
              <button type="button" onClick={loadSectors}>Tentar novamente</button>
            </div>
          )}

          <label className="sidebar-search">
            <Icon name="search" size={18} /><span className="sr-only">Pesquisar conversas</span>
            <input placeholder="Pesquisar conversas..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </label>
          <div className="sidebar-filter-row">
            <label htmlFor="conversation-status-filter">Status</label>
            <select id="conversation-status-filter" className="status-filter" aria-label="Filtrar status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
              <option value="all">Todos os status</option>
              {CONVERSATION_STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
        </div>

        {/* Nova conversa */}
        {showNewConv && (
          <div className="new-conv-panel">
            <div className="new-conv-tabs">
              <button className={`new-conv-tab ${newConvTab === 'contacts' ? 'active' : ''}`} onClick={() => setNewConvTab('contacts')}><Icon name="contacts" size={16} /> Clientes</button>
              <button className={`new-conv-tab ${newConvTab === 'collaborators' ? 'active' : ''}`} onClick={() => setNewConvTab('collaborators')}><Icon name="tutors" size={16} /> Colaboradores</button>
            </div>
            <input aria-label="Buscar contato para nova conversa" className="new-conv-search" placeholder="Buscar contato..." value={contactSearch} onChange={e => setContactSearch(e.target.value)} />
            <div className="new-conv-list">
              {contactsError ? (
                <div className="new-conv-error" role="alert">
                  <span>{contactsError}</span>
                  <button type="button" onClick={loadContacts}>Tentar novamente</button>
                </div>
              ) : filteredContacts.length > 0 ? filteredContacts.map(c => (
                <button
                  type="button"
                  key={c.id}
                  className="new-conv-item"
                  onClick={() => handleStartConversation(c.id)}
                  disabled={startingConversation === c.id}
                  aria-busy={startingConversation === c.id}
                >
                  <div className="new-conv-avatar">{(c.name || '?')[0].toUpperCase()}</div>
                  <div className="new-conv-info">
                    <div className="new-conv-name">{c.name}</div>
                    <div className="new-conv-phone">{formatPhone(c.phone ?? null)}</div>
                  </div>
                  <span className="new-conv-btn">
                    {startingConversation === c.id ? <span className="spinner" aria-hidden="true" /> : <Icon name="message" size={17} />}
                  </span>
                </button>
              )) : (
                <div className="new-conv-empty">Nenhum contato encontrado</div>
              )}
            </div>
            {newConvError && <p className="new-conv-error-message" role="alert">{newConvError}</p>}
            <button className="btn-add-contact" onClick={() => navigate('/contacts')}><Icon name="plus" size={16} /> Cadastrar novo contato</button>
          </div>
        )}

        {/* Lista */}
        <div className="conv-list-v2">
          {loading && !conversationsError ? (
            <LoadingState className="conv-list-state" label="Carregando conversas…" />
          ) : conversationsError && conversations.length === 0 ? (
            <ErrorState
              className="conv-list-state"
              title={conversationsError.kind === 'forbidden' ? 'Acesso negado' : 'Erro ao carregar conversas'}
              message={conversationsError.message}
              onRetry={conversationsError.kind === 'forbidden' ? undefined : () => { setLoading(true); void fetchConversations(); }}
            />
          ) : (
            <>
              {conversationsError && (
                <div className="conv-list-warning" role="alert">
                  <span>{conversationsError.message}</span>
                  <button type="button" onClick={() => void fetchConversations()}>Tentar novamente</button>
                </div>
              )}
              {filtered.length === 0 ? (
                <EmptyState
                  className="empty-list"
                  icon="inbox"
                  title="Nenhuma conversa"
                  description={activeSector ? `Nenhuma conversa em ${activeSector.name}.` : 'Novas conversas aparecerão aqui quando chegarem.'}
                />
              ) : filtered.map(conv => {
              const isActive = selectedConv === conv.id;
              const sector = sectors.find(s => s.id === conv.sectorId);
              const name = getDisplayName(conv);
              const initial = getInitial(conv);
              const lastMsg = (conv.unreadCount > 0 ? conv.lastInboundMessage?.content : conv.lastMessage?.content)
                || conv.lastMessage?.content
                || 'Nova conversa';
              const st = statusColor(conv.statusV2 || conv.status);

              return (
                <button type="button" key={conv.id} className={`conv-row ${isActive ? 'active' : ''}`} aria-pressed={isActive} onClick={() => selectConv(conv)}>
                  <div className="conv-avatar-v2" style={{ background: sector?.color || '#4361ee' }}>{initial}</div>
                  <div className="conv-content">
                    <div className="conv-header-row">
                      <span className="conv-name-v2">{name}</span>
                      <span className="conv-time-v2">{timeAgo(conv.lastMessage?.createdAt || conv.updatedAt)}</span>
                    </div>
                    <div className="conv-preview-row">
                      <span className="conv-last-msg">{lastMsg.length > 45 ? lastMsg.substring(0, 45) + '...' : lastMsg}</span>
                      {conv.unreadCount > 0
                        ? <span className="conv-unread-badge" aria-label={`${conv.unreadCount} mensagens não lidas`}>{conv.unreadCount > 99 ? '99+' : conv.unreadCount}</span>
                        : <span className="conv-status-dot" style={{ background: st }} aria-label={`Status: ${statusLabel(conv.statusV2 || conv.status)}`} />}
                    </div>
                  </div>
                </button>
              );
            })}
              {conversationsNotice && !conversationsError && (
                <div className="conv-list-notice" role="status">
                  <span>{conversationsNotice}</span>
                  <button type="button" onClick={() => { setConversationsNotice(null); void loadMoreConversations(); }}>Tentar novamente</button>
                </div>
              )}
            </>
          )}
          {!loading && conversationsCursor && !conversationsError && (
            <div className="load-more-convs">
              <button type="button" onClick={() => { void loadMoreConversations(); }} disabled={loadingMoreConversations}>
                {loadingMoreConversations ? 'Carregando conversas…' : 'Carregar mais conversas'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* CHAT */}
      <div className="inbox-main">
        {selectedConv && selectedConvData ? (
          <>
            {/* Header */}
            <div className="main-header">
              <div className="header-left">
                <button type="button" className="mobile-back" aria-label="Voltar para conversas" onClick={() => { selectedConvRef.current = null; setSelectedConv(null); setSelectedConvData(null); navigate('/inbox', { replace: true }); }}><Icon name="back" /></button>
                <div className="header-avatar" style={{ background: conversationSector?.color || '#0284c7' }}>
                  {getInitial(selectedConvData)}
                </div>
                <div className="header-info">
                  <div className="header-name">{getDisplayName(selectedConvData)}</div>
                  <div className="header-meta">
                    {selectedPhone && <span className="header-phone">{selectedPhone}</span>}
                    <span className="header-sector" style={{ background: (conversationSector?.color || '#0284c7') + '18', color: (conversationSector?.color || '#0369a1') }}>
                      {conversationSector?.name || (selectedConvData.pendingDetails ? 'Setor não carregado' : 'Sem setor')}
                    </span>
                    {selectedStatus ? (
                      <span className="header-status" style={{ color: statusColor(selectedStatus) }}>
                        ● {statusLabel(selectedStatus)}
                      </span>
                    ) : (
                      <span className="header-status pending-details">Detalhes pendentes</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="header-actions">
                <button type="button" className="header-btn" aria-label="Buscar nesta conversa" aria-expanded={showMessageSearch} onClick={() => setShowMessageSearch(value => !value)}><Icon name="search" /></button>
                <button ref={transferButtonRef} type="button" className="header-btn" aria-label="Transferir conversa" title="Transferir conversa" onClick={openTransfer} disabled={transferBusy}><Icon name="transfer" /></button>
                <button ref={contextButtonRef} type="button" className="header-btn" aria-label="Abrir informações da conversa" aria-expanded={showContext} onClick={() => setShowContext((value) => !value)}><Icon name="info" /></button>
              </div>
            </div>

            {showMessageSearch && <label className="message-search"><Icon name="search" size={16} /><span className="sr-only">Buscar nas mensagens</span><input autoFocus value={messageSearch} onChange={event => setMessageSearch(event.target.value)} placeholder="Buscar nas mensagens…" /><button type="button" aria-label="Fechar busca" onClick={() => { setShowMessageSearch(false); setMessageSearch(''); }}><Icon name="close" size={15} /></button></label>}

            {/* Messages */}
            <div className="chat-bg">
              <div className="chat-messages-v2" ref={chatScrollRef}>
                {messagesLoading && messages.length === 0 ? (
                  <LoadingState className="chat-state" label="Carregando histórico…" />
                ) : messagesError && messages.length === 0 ? (
                  <ErrorState
                    className="chat-state"
                    title={messagesError.kind === 'forbidden' ? 'Acesso negado' : 'Erro ao carregar histórico'}
                    message={messagesError.message}
                    onRetry={messagesError.kind === 'forbidden' ? undefined : () => { void fetchMessages(selectedConv); }}
                  />
                ) : visibleMessages.length === 0 ? (
                  <EmptyState
                    className="empty-chat-v2"
                    icon="message"
                    title={messageSearch.trim() && messages.length > 0 ? 'Nenhuma mensagem encontrada' : `Início da conversa com ${getDisplayName(selectedConvData)}`}
                    description={messageSearch.trim() ? 'Ajuste o termo da busca.' : 'Envie uma mensagem para começar o atendimento.'}
                  />
                ) : (
                  <>
                    {messagesError && (
                      <div className="chat-warning" role="alert">
                        <span>Falha ao atualizar o histórico. Exibindo as mensagens já carregadas.</span>
                        <button type="button" onClick={() => { void fetchMessages(selectedConv); }}>Tentar novamente</button>
                      </div>
                    )}
                    {timelineMessages.map((msg, index) => {
                      const currentDay = messageDayKey(msg.createdAt);
                      const previousDay = index > 0 ? messageDayKey(timelineMessages[index - 1].createdAt) : null;
                      return (
                        <Fragment key={msg.id}>
                          {currentDay !== previousDay && <div className="date-separator"><span>{messageDayLabel(msg.createdAt)}</span></div>}
                          <div className={`message ${msg.direction}`}>
                            {(msg.mediaUrl || msg.mediaAssetId || msg.mediaState || msg.mediaReasonCode || msg.mediaType) && <AuthorizedMedia message={msg} />}
                            {msg.content && <span className="msg-text">{msg.content}</span>}
                            <span className="msg-timestamp">
                              {new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                              {msg.direction === 'outbound' && deliveryMark(msg.status)}
                            </span>
                          </div>
                        </Fragment>
                      );
                    })}
                    {hasMoreMessages && !historyExhausted && (
                      <button type="button" className="load-older" onClick={() => { void loadOlderMessages(); }} disabled={loadingOlder}>
                        {loadingOlder ? 'Carregando mensagens…' : 'Carregar mensagens anteriores'}
                      </button>
                    )}
                    {historyExhausted && (
                      <p className="history-cap" role="status">Janela de busca esgotada no limite de 100 mensagens por requisição; o servidor ainda não oferece cursor para mensagens mais antigas.</p>
                    )}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>
            </div>

            {/* Composer */}
            <div className="composer-v2">
              {selectedFile && (
                <div className="file-bar">
                  <span><Icon name="attachment" size={15} /> {selectedFile.name} ({(selectedFile.size / 1024).toFixed(0)}KB)</span>
                  <button type="button" aria-label="Remover anexo" onClick={() => chooseFile(null)} disabled={sendBusy}><Icon name="close" size={16} /></button>
                </div>
              )}
              {attachmentError && <p className="composer-error" role="alert">{attachmentError}</p>}
              {currentIntention && currentIntention.phase && (
                <div className="composer-status">
                  <span className="send-phase" role="status" aria-live="polite" aria-label="Estado do envio">{phaseLabel(currentIntention)}</span>
                  {currentIntention.error && <p className="composer-error" role="alert">{currentIntention.error}</p>}
                  {sendBusy && selectedConv && (
                    <button type="button" className="send-cancel" onClick={() => cancelSend(selectedConv)}>Cancelar envio</button>
                  )}
                  {canRetry && (
                    <button type="button" className="send-retry" onClick={() => { void handleSend(); }}>Tentar novamente</button>
                  )}
                </div>
              )}
              {!online && <p className="offline-note" role="status">Sem conexão à internet — o envio será retomado quando a conexão voltar.</p>}
              {online && realtimeStatus === 'reconnecting' && <p className="offline-note realtime-note" role="status">Reconectando ao tempo real…</p>}
              {online && realtimeStatus === 'offline' && <p className="offline-note realtime-note" role="status">Tempo real indisponível; novas mensagens podem demorar. O envio continua pela conexão HTTP.</p>}
              <form className="composer-row" onSubmit={handleSend}>
                <button type="button" className="composer-btn" aria-label="Adicionar emoji sorridente" disabled={sendBusy} onClick={() => changeMessage(newMessage ? `${newMessage} 😊` : '😊')}><Icon name="smile" /></button>
                <input ref={fileInputRef} aria-label="Selecionar anexo" type="file" accept="image/*,audio/*,video/*,.pdf,.doc,.docx" onChange={handleFileChange} style={{ display: 'none' }} disabled={sendBusy} />
                <button type="button" className="composer-btn" aria-label="Anexar arquivo" disabled={sendBusy} onClick={() => fileInputRef.current?.click()}><Icon name="attachment" /></button>
                <label className="sr-only" htmlFor="message-composer">Mensagem</label><input id="message-composer" className="composer-input-v2" placeholder={selectedFile ? 'Legenda (opcional)...' : 'Mensagem'} value={newMessage} onChange={e => changeMessage(e.target.value)} disabled={sendBusy} autoFocus />
                <button type="submit" className="composer-send" aria-label="Enviar mensagem" aria-busy={sendBusy} disabled={sendBusy || (!newMessage.trim() && !selectedFile)}><Icon name="send" /></button>
              </form>
            </div>
          </>
        ) : (
          <div className="inbox-empty">
            <div className="empty-center">
              <img className="empty-logo" src="/assets/brand/cvg-logo.webp" alt="" />
              <h2>CVG Connect Desk</h2>
              <p>Selecione uma conversa na barra lateral<br />ou inicie uma nova conversa</p>
              <button className="btn-start-new" onClick={() => setShowNewConv(true)}><Icon name="plus" size={18} /> Nova conversa</button>
            </div>
          </div>
        )}
      </div>

      {selectedConvData && <aside className="context-panel" aria-label="Contexto da conversa">
        <div className="context-header"><div><span className="inbox-kicker">Contexto</span><h2>Atendimento</h2></div><button type="button" aria-label="Fechar informações" onClick={() => setShowContext(false)}><Icon name="close" /></button></div>
        <div className="context-profile"><div className="context-avatar">{getInitial(selectedConvData)}</div><strong>{getDisplayName(selectedConvData)}</strong><span>{formatPhone(selectedConvData.contactPhone ?? null) || 'Telefone não informado'}</span></div>
        {contextLoading && <div className="context-feedback" role="status">Carregando vínculos autorizados…</div>}
        {contextError && <div className="context-feedback context-feedback-error" role="alert">{contextError}</div>}
        <dl className="context-list">
          <div><dt>Status</dt><dd>{selectedStatus ? (<><span className="context-status" style={{ background: statusColor(selectedStatus) }} />{statusLabel(selectedStatus)}</>) : 'Não carregado'}</dd></div>
          <div><dt>Setor</dt><dd>{conversationSector?.name || (selectedConvData.pendingDetails ? 'Não carregado' : 'Não atribuído')}</dd></div>
          <div><dt>Responsável</dt><dd>{assignedLabel}</dd></div>
          <div><dt>Início</dt><dd>{selectedConvData.createdAt ? new Date(selectedConvData.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Não informado'}</dd></div>
          <div><dt>Canal</dt><dd>{selectedConvData.pendingDetails ? 'Não informado' : selectedConvData.externalChannelId ? 'Canal externo' : 'CVG Desk'}</dd></div>
        </dl>

        <section className="context-section" aria-labelledby="context-related-title">
          <h3 id="context-related-title">Pessoas relacionadas</h3>
          <div className="context-links">
            {selectedConvData.contactId && <a href={`/contacts?contactId=${encodeURIComponent(selectedConvData.contactId)}`}><Icon name="contacts" size={15} /><span>Contato: {contextContact?.name || getDisplayName(selectedConvData)}</span></a>}
            {contextContact?.tutorId && <a href={`/tutors?tutorId=${encodeURIComponent(contextContact.tutorId)}`}><Icon name="tutors" size={15} /><span>Tutor: {contextTutor?.name || 'abrir cadastro'}</span></a>}
            {contextContact?.patientId && <a href={`/patients?patientId=${encodeURIComponent(contextContact.patientId)}`}><Icon name="patients" size={15} /><span>Paciente: {contextPatient?.name || 'abrir cadastro'}</span></a>}
            {!selectedConvData.contactId && !contextContact?.tutorId && !contextContact?.patientId && <span className="context-muted">Nenhum vínculo identificado.</span>}
          </div>
        </section>

        <section className="context-section" aria-labelledby="context-actions-title">
          <h3 id="context-actions-title">Operações autorizadas</h3>
          <label className="context-field">Status
            <select aria-label="Alterar status da conversa" value={statusV2For(selectedStatus)} onChange={event => handleStateChange(event.target.value as ConversationStatusV2)} disabled={selectedConvData.pendingDetails || contextActionBusy !== null}>
              {CONVERSATION_STATUS_V2.map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}
            </select>
          </label>
          <div className="context-action-grid">
            <button type="button" className="context-action" onClick={handleAssignToMe} disabled={selectedConvData.pendingDetails || contextActionBusy !== null}><Icon name="contacts" size={16} /> Atribuir a mim</button>
            <button type="button" className="context-action" onClick={handleHandoff} disabled={selectedConvData.pendingDetails || contextActionBusy !== null}><Icon name="transfer" size={16} /> {selectedConvData.currentHandler === 'human' ? 'Devolver ao bot' : 'Transferir a humano'}</button>
            <button type="button" className="context-action" onClick={openTransfer} disabled={selectedConvData.pendingDetails || transferBusy}><Icon name="transfer" size={16} /> Transferir setor</button>
          </div>
          {contextActionBusy && <span className="context-action-progress" role="status">Salvando operação…</span>}
          {contextActionError && <span className="context-feedback context-feedback-error" role="alert">{contextActionError}</span>}
          {contextNotice && <span className="context-feedback" role="status">{contextNotice}</span>}
        </section>

        <section className="context-section" aria-labelledby="context-labels-title">
          <h3 id="context-labels-title">Etiquetas</h3>
          <div className="context-chips">
            {contextLabels.length > 0 ? contextLabels.map(label => (
              <button key={label.id} type="button" className="context-chip" style={{ borderColor: label.color }} onClick={() => handleLabelChange(label, false)} disabled={contextActionBusy !== null} title="Remover etiqueta">{label.name} ×</button>
            )) : <span className="context-muted">Nenhuma etiqueta nesta conversa.</span>}
          </div>
          {labelCatalog.filter(label => !contextLabelIds.has(label.id)).length > 0 && (
            <label className="context-field">Adicionar etiqueta
              <select aria-label="Adicionar etiqueta" value="" onChange={event => { const label = labelCatalog.find(item => item.id === event.target.value); if (label) handleLabelChange(label, true); }} disabled={contextActionBusy !== null}>
                <option value="">Escolha uma etiqueta…</option>
                {labelCatalog.filter(label => !contextLabelIds.has(label.id)).map(label => <option key={label.id} value={label.id}>{label.name}</option>)}
              </select>
            </label>
          )}
        </section>

        <section className="context-section" aria-labelledby="context-shortcuts-title">
          <h3 id="context-shortcuts-title">Atalhos do atendimento</h3>
          <div className="context-shortcuts">
            <a href={`/tasks?conversationId=${encodeURIComponent(selectedConvData.id)}`}>Tarefas{pendingSummary ? ` · ${pendingSummary.tasks}${pendingSummary.capped ? '+' : ''}` : ''}</a>
            <a href={`/notes?conversationId=${encodeURIComponent(selectedConvData.id)}`}>Notas{pendingSummary ? ` · ${pendingSummary.notes}${pendingSummary.capped ? '+' : ''}` : ''}</a>
            <a href={`/alerts?conversationId=${encodeURIComponent(selectedConvData.id)}`}>Alertas{pendingSummary ? ` · ${pendingSummary.alerts}${pendingSummary.capped ? '+' : ''}` : ''}</a>
          </div>
          {pendingSummary && (
            <p className="context-pending" role="status">
              {pendingSummary.tasks} tarefa(s), {pendingSummary.alerts} alerta(s) e {pendingSummary.notes} nota(s) vinculados a esta conversa.
            </p>
          )}
        </section>
      </aside>}
      {showContext && <button type="button" className="context-backdrop" aria-label="Fechar informações" onClick={() => setShowContext(false)} />}

      {transferOpen && selectedConvData && <div className="transfer-overlay" role="presentation">
        <section className="transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-dialog-title">
          <div className="transfer-dialog-header"><div><span className="inbox-kicker">Operação autorizada</span><h2 id="transfer-dialog-title">Transferir conversa</h2></div><button type="button" aria-label="Fechar transferência" onClick={closeTransfer} disabled={transferBusy}><Icon name="close" /></button></div>
          <p className="transfer-dialog-copy">Escolha o setor de destino para {getDisplayName(selectedConvData)}.</p>
          <form onSubmit={handleTransfer}>
            <label className="context-field">Setor de destino
              <select aria-label="Setor de destino" value={transferSectorId} onChange={event => setTransferSectorId(event.target.value)} disabled={transferBusy} required>
                <option value="">Escolha um setor…</option>
                {sectors.filter(sector => sector.isActive && sector.id !== selectedConvData.sectorId).map(sector => <option key={sector.id} value={sector.id}>{sector.name}</option>)}
              </select>
            </label>
            <label className="context-field">Motivo (opcional)
              <textarea aria-label="Motivo da transferência" value={transferReason} onChange={event => setTransferReason(event.target.value)} maxLength={500} disabled={transferBusy} placeholder="Contexto para a equipe de destino" />
            </label>
            {transferError && <p className="context-feedback context-feedback-error" role="alert">{transferError}</p>}
            <div className="transfer-dialog-actions"><button type="button" className="transfer-cancel" onClick={closeTransfer} disabled={transferBusy}>Cancelar</button><button type="submit" className="transfer-submit" disabled={transferBusy || !transferSectorId}>{transferBusy ? 'Transferindo…' : 'Confirmar transferência'}</button></div>
          </form>
        </section>
      </div>}
    </div>
  );
}
