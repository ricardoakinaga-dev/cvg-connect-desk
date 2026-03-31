import type { WAInboundEvent } from '../types/gateway-contracts';

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
