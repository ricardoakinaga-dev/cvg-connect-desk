import type { Message } from '../../infrastructure/repositories/message.repository';

/**
 * PROD-14/AC3 — DTO de mensagem que NUNCA entrega URL de mídia não-confiável.
 *
 * `media_url` só é exposto quando é uma referência de asset interno
 * (`asset://<id>`) publicada após CLEAN+STORED; dados de intake server-side
 * (`metadata.mediaIntake`, incluindo a URL de origem do provider) são
 * removidos do payload e substituídos por estado/código de leitura.
 */

export interface SanitizedMessageDto {
  id: string;
  conversationId: string;
  direction: string;
  content: string;
  sender: string | null;
  senderType: string | null;
  recipient: string | null;
  status: string;
  externalMessageId: string | null;
  metadata: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  mediaUrl: string | null;
  mediaType: string | null;
  mediaMimetype: string | null;
  mediaFilename: string | null;
  mediaAssetId: string | null;
  mediaState: string | null;
  mediaReasonCode: string | null;
}

interface RawIntake {
  state?: unknown;
  reasonCode?: unknown;
}

export function toSanitizedMessage(message: Message): SanitizedMessageDto {
  let parsed: Record<string, unknown> | null = null;
  if (message.metadata) {
    try {
      const value = JSON.parse(message.metadata) as unknown;
      if (value && typeof value === 'object') parsed = { ...(value as Record<string, unknown>) };
    } catch {
      parsed = null;
    }
  }

  const intake = parsed && typeof parsed.mediaIntake === 'object' && parsed.mediaIntake !== null
    ? (parsed.mediaIntake as RawIntake)
    : null;
  if (parsed) delete parsed.mediaIntake;

  const assetRef = message.mediaUrl?.startsWith('asset://') ? message.mediaUrl : null;
  const remainingMetadata = parsed && Object.keys(parsed).length > 0 ? JSON.stringify(parsed) : null;

  return {
    id: message.id,
    conversationId: message.conversationId,
    direction: message.direction,
    content: message.content,
    sender: message.sender ?? null,
    senderType: message.senderType ?? null,
    recipient: message.recipient ?? null,
    status: message.status,
    externalMessageId: message.externalMessageId ?? null,
    metadata: remainingMetadata,
    sentAt: message.sentAt ?? null,
    deliveredAt: message.deliveredAt ?? null,
    createdAt: message.createdAt,
    mediaUrl: assetRef,
    mediaType: message.mediaType ?? null,
    mediaMimetype: message.mediaMimetype ?? null,
    mediaFilename: message.mediaFilename ?? null,
    mediaAssetId: assetRef ? assetRef.slice('asset://'.length) : null,
    mediaState: typeof intake?.state === 'string' ? intake.state : null,
    mediaReasonCode: typeof intake?.reasonCode === 'string' ? intake.reasonCode : null,
  };
}
