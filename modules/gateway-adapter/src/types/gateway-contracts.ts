// Contratos do gateway_evochatwoot

export interface WAInboundEvent {
  contract_version: string;
  event_type: 'WA_INBOUND';
  event_id: string;
  correlation_id?: string;
  occurred_at: string;
  tenant?: string;
  provider: 'evolutionapi';
  channel: 'whatsapp';
  payload: {
    instance: string;
    remoteJid: string;           // "5511999999999@s.whatsapp.net"
    messageId: string;
    fromMe: boolean;
    pushName?: string;
    type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location' | 'contacts' | 'unknown';
    text?: string;
    media?: {
      url?: string;
      mimetype?: string;
      filename?: string;
    };
    timestamp: number;
    raw?: Record<string, unknown>;
  };
}

export interface CWOutboundEvent {
  contract_version: string;
  event_type: 'CW_OUTBOUND';
  event_id: string;
  correlation_id?: string;
  occurred_at: string;
  tenant?: string;
  provider: 'chatwoot';
  channel: 'whatsapp';
  payload: {
    accountId: number;
    inboxId: number;
    conversationId: number;
    contactId?: number;
    chatwoot_message_id: number;
    content: string;
    attachments?: { url: string; file_type: string }[];
    sender: {
      type: 'agent' | 'bot' | 'system';
      id: number | string;
      name?: string;
    };
    metadata?: Record<string, unknown>;
  };
}

export interface WAReceiptEvent {
  contract_version: string;
  event_type: 'WA_RECEIPT';
  event_id: string;
  correlation_id?: string;
  occurred_at: string;
  tenant?: string;
  provider: 'evolutionapi';
  channel: 'whatsapp';
  payload: {
    instance: string;
    remoteJid: string;
    messageId: string;
    status: 'sent' | 'delivered' | 'read' | 'failed' | 'played';
    status_at: string;
    error?: {
      code: string;
      message: string;
      raw?: Record<string, unknown>;
    };
  };
}

export interface InstanceStatusEvent {
  contract_version: string;
  event_type: 'INSTANCE_STATUS';
  event_id: string;
  correlation_id?: string;
  occurred_at: string;
  tenant?: string;
  provider: 'evolutionapi';
  channel: 'whatsapp';
  payload: {
    instance: string;
    state: 'online' | 'offline' | 'connecting' | 'qr' | 'logged_out' | 'unknown';
    state_at: string;
    qr?: string;
    reason?: string;
    raw?: Record<string, unknown>;
  };
}
