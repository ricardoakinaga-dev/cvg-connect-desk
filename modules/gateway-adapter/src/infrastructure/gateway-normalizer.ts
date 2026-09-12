import type { WAInboundEvent, InstanceStatusEvent, WAReceiptEvent } from '../types/gateway-contracts';

/**
 * Aceita tanto o contrato canônico do CVG Gateway quanto o payload bruto da
 * Evolution. Um WA_INBOUND já normalizado não pode passar novamente pelo
 * normalizador da Evolution, pois isso descartaria payload.messageId e
 * payload.remoteJid.
 */
export function toWAInboundEvent(event: unknown, eventType: string): WAInboundEvent | null {
  if (eventType === 'WA_INBOUND') {
    const candidate = event as Partial<WAInboundEvent>;
    return candidate.event_type === 'WA_INBOUND' && candidate.payload
      ? candidate as WAInboundEvent
      : null;
  }
  return normalizeEvolutionMessage(event, eventType);
}

/**
 * Normaliza payload WA_INBOUND do gateway para o formato interno do Connect Desk.
 */
export function normalizeGatewayInbound(event: WAInboundEvent) {
  const { payload } = event;

  // Extrair telefone do remoteJid: "5511999999999@s.whatsapp.net" → "5511999999999"
  const phone = payload.remoteJid.replace(/@.*$/, '');

  // Determinar tipo de mensagem
  let messageType = payload.type;
  if (payload.type === 'sticker' || payload.type === 'location' || payload.type === 'contacts') {
    messageType = 'unknown';
  }

  return {
    // Identificadores
    externalMessageId: payload.messageId,
    externalConversationId: `${payload.instance}_${phone}`,
    correlationId: event.correlation_id,
    eventId: event.event_id,

    // Conteúdo
    content: payload.text || '',
    messageType,

    // Remetente
    sender: phone,
    senderName: payload.pushName || phone,
    senderType: payload.fromMe ? 'system' as const : 'contact' as const,
    contactPhone: phone,
    contactName: payload.pushName || undefined,

    // Timestamps
    sentAt: new Date(payload.timestamp * 1000),
    occurredAt: new Date(event.occurred_at),

    // Metadados do gateway
    instance: payload.instance,
    channel: event.channel,
    provider: event.provider,
    tenant: event.tenant,

    // Mídia
    mediaUrl: payload.media?.url,
    mediaMimetype: payload.media?.mimetype,
    mediaFilename: payload.media?.filename,
  };
}

/**
 * Extrai o telefone de um remoteJid do WhatsApp.
 */
export function extractPhoneFromJid(remoteJid: string): string {
  return remoteJid.replace(/@.*$/, '');
}

/**
 * Formata telefone para exibição: "5511999999999" → "+55 11 99999-9999"
 */
export function formatPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 13) {
    return `+${cleaned.slice(0, 2)} ${cleaned.slice(2, 4)} ${cleaned.slice(4, 9)}-${cleaned.slice(9)}`;
  }
  if (cleaned.length === 11) {
    return `+55 ${cleaned.slice(0, 2)} ${cleaned.slice(2, 7)}-${cleaned.slice(7)}`;
  }
  return `+${cleaned}`;
}

/**
 * Normaliza mensagem do formato Evolution API para WA_INBOUND do gateway.
 * O Evolution envia em formato diferente do contrato do gateway.
 */
export function normalizeEvolutionMessage(rawEvent: any, eventType: string): WAInboundEvent | null {
  try {
    // Evolution API v2 envia: { event, instance, data: { key, message, ... } }
    const data = rawEvent.data || rawEvent;
    const instance = rawEvent.instance || data.instance || 'unknown';

    // Extrair dados da mensagem
    const key = data.key || {};
    const message = data.message || {};
    const remoteJid = key.remoteJid || data.remoteJid || '';
    const messageId = key.id || data.messageId || '';
    const fromMe = key.fromMe || data.fromMe || false;
    const pushName = data.pushName || key.pushName || '';

    // Determinar tipo e conteúdo
    let type = 'text';
    let text = '';
    let mediaUrl: string | undefined;
    let mediaMimetype: string | undefined;
    let mediaFilename: string | undefined;
    let mediaBase64: string | undefined;

    if (message.conversation) {
      type = 'text';
      text = message.conversation;
    } else if (message.extendedTextMessage?.text) {
      type = 'text';
      text = message.extendedTextMessage.text;
    } else if (message.imageMessage) {
      type = 'image';
      text = message.imageMessage.caption || '';
      mediaUrl = message.imageMessage.url;
      mediaMimetype = message.imageMessage.mimetype;
      mediaBase64 = message.imageMessage.base64;
    } else if (message.audioMessage) {
      type = 'audio';
      text = '';
      mediaUrl = message.audioMessage.url;
      mediaMimetype = message.audioMessage.mimetype;
      mediaBase64 = message.audioMessage.base64;
    } else if (message.videoMessage) {
      type = 'video';
      text = message.videoMessage.caption || '';
      mediaUrl = message.videoMessage.url;
      mediaMimetype = message.videoMessage.mimetype;
      mediaBase64 = message.videoMessage.base64;
    } else if (message.documentMessage) {
      type = 'document';
      text = message.documentMessage.fileName || '';
      mediaUrl = message.documentMessage.url;
      mediaMimetype = message.documentMessage.mimetype;
      mediaFilename = message.documentMessage.fileName;
      mediaBase64 = message.documentMessage.base64;
    } else if (message.stickerMessage) {
      type = 'sticker';
      text = '';
      mediaUrl = message.stickerMessage.url;
      mediaMimetype = message.stickerMessage.mimetype;
    } else {
      type = 'unknown';
      text = '';
    }

    // Se o Evolution enviou base64 da mídia, salvar como URL local
    if (mediaBase64 && !mediaUrl) {
      mediaUrl = `data:${mediaMimetype || 'application/octet-stream'};base64,${mediaBase64}`;
    }

    // Timestamp
    const timestamp = data.messageTimestamp || Math.floor(Date.now() / 1000);

    return {
      contract_version: '1.0.0',
      event_type: 'WA_INBOUND',
      event_id: messageId || `evo_${Date.now()}`,
      correlation_id: rawEvent.correlation_id,
      occurred_at: new Date().toISOString(),
      tenant: 'cvg',
      provider: 'evolutionapi',
      channel: 'whatsapp',
      payload: {
        instance,
        remoteJid,
        messageId,
        fromMe,
        pushName,
        type: type as any,
        text,
        media: mediaUrl ? { url: mediaUrl, mimetype: mediaMimetype, filename: mediaFilename } : undefined,
        timestamp: typeof timestamp === 'number' ? timestamp : parseInt(timestamp),
        raw: rawEvent,
      },
    };
  } catch (err) {
    console.error('[normalizeEvolutionMessage] Erro:', err);
    return null;
  }
}

/**
 * Normaliza CONNECTION_UPDATE do Evolution para INSTANCE_STATUS do gateway.
 */
export function normalizeConnectionUpdate(rawEvent: any): InstanceStatusEvent | null {
  try {
    const data = rawEvent.data || rawEvent;
    const instance = rawEvent.instance || 'unknown';
    const state = data.state || data.status || 'unknown';

    return {
      contract_version: '1.0.0',
      event_type: 'INSTANCE_STATUS',
      event_id: `conn_${Date.now()}`,
      occurred_at: new Date().toISOString(),
      tenant: 'cvg',
      provider: 'evolutionapi',
      channel: 'whatsapp',
      payload: {
        instance,
        state: state as any,
        state_at: new Date().toISOString(),
        reason: data.reason,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Normaliza MESSAGES_UPDATE do Evolution para WA_RECEIPT do gateway.
 */
export function normalizeMessageUpdate(rawEvent: any): WAReceiptEvent | null {
  try {
    const data = rawEvent.data || rawEvent;
    const instance = rawEvent.instance || 'unknown';
    const key = data.key || {};
    const update = data.update || {};

    let status = 'sent';
    if (update.status === 3 || update.status === 'READ') status = 'read';
    else if (update.status === 2 || update.status === 'DELIVERED') status = 'delivered';
    else if (update.status === 1 || update.status === 'SENT') status = 'sent';

    return {
      contract_version: '1.0.0',
      event_type: 'WA_RECEIPT',
      event_id: `receipt_${Date.now()}`,
      occurred_at: new Date().toISOString(),
      tenant: 'cvg',
      provider: 'evolutionapi',
      channel: 'whatsapp',
      payload: {
        instance,
        remoteJid: key.remoteJid || '',
        messageId: key.id || '',
        status: status as any,
        status_at: new Date().toISOString(),
      },
    };
  } catch {
    return null;
  }
}
