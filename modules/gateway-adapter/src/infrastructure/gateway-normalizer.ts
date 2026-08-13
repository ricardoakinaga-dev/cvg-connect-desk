import type { WAInboundEvent, InstanceStatusEvent, WAReceiptEvent } from '../types/gateway-contracts';

type EvolutionRecord = Record<string, unknown>;
type InboundType = WAInboundEvent['payload']['type'];
type InstanceState = InstanceStatusEvent['payload']['state'];
type ReceiptStatus = WAReceiptEvent['payload']['status'];

function asRecord(value: unknown): EvolutionRecord {
  return value && typeof value === 'object' ? value as EvolutionRecord : {};
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
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
export function normalizeEvolutionMessage(rawEventInput: unknown, _eventType: string): WAInboundEvent | null {
  try {
    const rawEvent = asRecord(rawEventInput);
    // Evolution API v2 envia: { event, instance, data: { key, message, ... } }
    const data = asRecord(rawEvent.data || rawEvent);
    const instance = stringValue(rawEvent.instance || data.instance, 'unknown');

    // Extrair dados da mensagem
    const key = asRecord(data.key);
    const message = asRecord(data.message);
    const remoteJid = stringValue(key.remoteJid || data.remoteJid);
    const messageId = stringValue(key.id || data.messageId);
    const fromMe = booleanValue(key.fromMe || data.fromMe);
    const pushName = stringValue(data.pushName || key.pushName);

    // Determinar tipo e conteúdo
    let type = 'text';
    let text = '';
    let mediaUrl: string | undefined;
    let mediaMimetype: string | undefined;
    let mediaFilename: string | undefined;
    let mediaBase64: string | undefined;

    if (typeof message.conversation === 'string') {
      type = 'text';
      text = message.conversation;
    } else if (typeof asRecord(message.extendedTextMessage).text === 'string') {
      type = 'text';
      text = stringValue(asRecord(message.extendedTextMessage).text);
    } else if (message.imageMessage) {
      const imageMessage = asRecord(message.imageMessage);
      type = 'image';
      text = stringValue(imageMessage.caption);
      mediaUrl = optionalString(imageMessage.url);
      mediaMimetype = optionalString(imageMessage.mimetype);
      mediaBase64 = optionalString(imageMessage.base64);
    } else if (message.audioMessage) {
      const audioMessage = asRecord(message.audioMessage);
      type = 'audio';
      text = '';
      mediaUrl = optionalString(audioMessage.url);
      mediaMimetype = optionalString(audioMessage.mimetype);
      mediaBase64 = optionalString(audioMessage.base64);
    } else if (message.videoMessage) {
      const videoMessage = asRecord(message.videoMessage);
      type = 'video';
      text = stringValue(videoMessage.caption);
      mediaUrl = optionalString(videoMessage.url);
      mediaMimetype = optionalString(videoMessage.mimetype);
      mediaBase64 = optionalString(videoMessage.base64);
    } else if (message.documentMessage) {
      const documentMessage = asRecord(message.documentMessage);
      type = 'document';
      text = stringValue(documentMessage.fileName);
      mediaUrl = optionalString(documentMessage.url);
      mediaMimetype = optionalString(documentMessage.mimetype);
      mediaFilename = optionalString(documentMessage.fileName);
      mediaBase64 = optionalString(documentMessage.base64);
    } else if (message.stickerMessage) {
      const stickerMessage = asRecord(message.stickerMessage);
      type = 'sticker';
      text = '';
      mediaUrl = optionalString(stickerMessage.url);
      mediaMimetype = optionalString(stickerMessage.mimetype);
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
      correlation_id: stringValue(rawEvent.correlation_id),
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
        type: type as InboundType,
        text,
        media: mediaUrl ? { url: mediaUrl, mimetype: mediaMimetype, filename: mediaFilename } : undefined,
        timestamp: typeof timestamp === 'number' ? timestamp : parseInt(String(timestamp)),
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
export function normalizeConnectionUpdate(rawEventInput: unknown): InstanceStatusEvent | null {
  try {
    const rawEvent = asRecord(rawEventInput);
    const data = asRecord(rawEvent.data || rawEvent);
    const instance = stringValue(rawEvent.instance, 'unknown');
    const state = stringValue(data.state || data.status, 'unknown');

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
        state: state as InstanceState,
        state_at: new Date().toISOString(),
        reason: optionalString(data.reason),
      },
    };
  } catch {
    return null;
  }
}

/**
 * Normaliza MESSAGES_UPDATE do Evolution para WA_RECEIPT do gateway.
 */
export function normalizeMessageUpdate(rawEventInput: unknown): WAReceiptEvent | null {
  try {
    const rawEvent = asRecord(rawEventInput);
    const data = asRecord(rawEvent.data || rawEvent);
    const instance = stringValue(rawEvent.instance, 'unknown');
    const key = asRecord(data.key);
    const update = asRecord(data.update);

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
        remoteJid: stringValue(key.remoteJid),
        messageId: stringValue(key.id),
        status: status as ReceiptStatus,
        status_at: new Date().toISOString(),
      },
    };
  } catch {
    return null;
  }
}
