import { Badge, type BadgeTone } from '../ui';
import type { RealtimeConnectionState } from '../../lib/realtime';

export interface ConnectionPresentation {
  tone: BadgeTone;
  label: string;
  detail: string;
}

function offlineDetail(reason?: string): string {
  switch (reason) {
    case 'missing-token':
      return 'Sessão sem credencial para tempo real';
    case 'missing-url':
      return 'Endereço de tempo real não configurado';
    case 'unauthorized':
      return 'Credencial rejeitada pelo serviço de tempo real';
    case 'connection-lost':
      return 'Conexão encerrada sem reconexão';
    default:
      return 'Tempo real indisponível';
  }
}

/** Texto e tom derivados do estado real do cliente; nunca afirma conexão sem `connected`. */
export function connectionPresentation(state: RealtimeConnectionState): ConnectionPresentation {
  switch (state.status) {
    case 'connected':
      return { tone: 'success', label: 'Conectado', detail: 'Tempo real ativo' };
    case 'connecting':
      return { tone: 'info', label: 'Conectando', detail: 'Estabelecendo conexão em tempo real' };
    case 'reconnecting':
      return { tone: 'warning', label: 'Reconectando', detail: 'Conexão instável; reconexão automática em andamento' };
    case 'offline':
      return { tone: 'error', label: 'Offline', detail: offlineDetail(state.reason) };
    default:
      return { tone: 'neutral', label: 'Sem conexão', detail: 'Tempo real inativo nesta sessão' };
  }
}

export interface PresencePresentation {
  modifier: 'is-connected' | 'is-connecting' | 'is-degraded' | 'is-offline' | 'is-idle';
  title: string;
  detail: string;
}

/** Painel do sidebar: mesmo estado do badge, sem segunda fonte de verdade. */
export function presencePresentation(state: RealtimeConnectionState): PresencePresentation {
  switch (state.status) {
    case 'connected':
      return { modifier: 'is-connected', title: 'Central conectada', detail: 'Operação em tempo real' };
    case 'connecting':
      return { modifier: 'is-connecting', title: 'Conectando à central', detail: 'Estabelecendo tempo real' };
    case 'reconnecting':
      return { modifier: 'is-degraded', title: 'Central instável', detail: 'Reconectando automaticamente' };
    case 'offline':
      return { modifier: 'is-offline', title: 'Central offline', detail: offlineDetail(state.reason) };
    default:
      return { modifier: 'is-idle', title: 'Tempo real inativo', detail: 'Nenhuma sessão de tempo real ativa' };
  }
}

export interface ConnectionStatusProps {
  state: RealtimeConnectionState;
  className?: string;
}

export function ConnectionStatus({ state, className }: ConnectionStatusProps) {
  const { tone, label, detail } = connectionPresentation(state);
  const classes = ['connection-status', className].filter(Boolean).join(' ');
  return (
    <Badge
      tone={tone}
      status
      role="status"
      aria-live="polite"
      aria-label={`Tempo real: ${label}. ${detail}`}
      title={detail}
      className={classes}
    >
      {label}
    </Badge>
  );
}
