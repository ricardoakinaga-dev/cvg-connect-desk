import { messageRepository } from '../../infrastructure/repositories/message.repository';
import { persistInboundAtomically } from '../../infrastructure/repositories/inbound-atomic.repository';
import { ok, err, type Result } from '@cvg/shared';
import { BadRequestError, safeFilename } from '@cvg/shared';
import { createAuditLog } from '@cvg/audit';
import {
  enqueueInboundMediaProcessing,
  evaluateInboundMediaInput,
  isInboundMediaPipelineEnabled,
  type InboundMediaIntake,
} from './inbound-media-pipeline';

export interface ReceiveInboundMessageInput {
  externalMessageId: string;
  externalConversationId?: string;
  content: string;
  sender: string;
  senderType?: 'contact' | 'system' | 'unknown';
  contactPhone?: string;
  contactName?: string;
  sentAt?: Date;
  // Media fields
  mediaUrl?: string;
  mediaType?: string;
  mediaMimetype?: string;
  mediaFilename?: string;
  metadata?: Record<string, unknown>;
  userId?: string; // Para auditoria (null para webhook externo)
}

export interface ReceiveInboundMessageOutput {
  messageId: string;
  conversationId: string;
  isNewConversation: boolean;
  /** Estado do intake de mídia (PROD-14): nunca a URL bruta. */
  mediaState?: string;
}

export async function receiveInboundMessage(
  input: ReceiveInboundMessageInput
): Promise<Result<ReceiveInboundMessageOutput, BadRequestError>> {
  try {
    if ((!input.content && !input.mediaUrl) || !input.sender) {
      return err(new BadRequestError('Content or media is required, and sender is required'));
    }

    // PROD-14/AC1: a URL recebida do provider NUNCA é persistida em
    // `media_url`; a mensagem é preservada mesmo com mídia rejeitada/indisponível
    // e o estado do intake fica registrado em metadata (server-side).
    const hasMedia = Boolean(input.mediaUrl || input.mediaType || input.mediaMimetype);
    const pipelineEnabled = isInboundMediaPipelineEnabled();
    let mediaIntake: InboundMediaIntake | undefined;
    if (input.mediaFilename) {
      input.mediaFilename = safeFilename(input.mediaFilename);
    }
    if (hasMedia) {
      const evaluation = evaluateInboundMediaInput({
        url: input.mediaUrl,
        mediaType: input.mediaType,
        mimetype: input.mediaMimetype,
      });
      mediaIntake = {
        state: evaluation.ok ? (pipelineEnabled ? 'PENDING_SCAN' : 'PIPELINE_DISABLED') : 'REJECTED',
        mediaType: input.mediaType,
        mimetype: input.mediaMimetype,
        filename: input.mediaFilename,
        sourceUrl: evaluation.ok ? input.mediaUrl : undefined,
        reasonCode: evaluation.ok ? (pipelineEnabled ? undefined : 'pipeline_disabled') : evaluation.reasonCode,
        reason: evaluation.ok
          ? (pipelineEnabled ? undefined : 'MEDIA_PIPELINE_ENABLED=false: mídia não será referenciada como pública')
          : evaluation.reason,
        updatedAt: new Date().toISOString(),
      };
    }
    const metadata = {
      ...(input.metadata ?? {}),
      ...(mediaIntake ? { mediaIntake } : {}),
    };

    const existingMessage = await messageRepository.findByExternalId(input.externalMessageId);
    if (existingMessage) {
      return ok({
        messageId: existingMessage.id,
        conversationId: existingMessage.conversationId,
        isNewConversation: false,
        mediaState: mediaIntake?.state,
      });
    }

    // D-C03-1: mensagem + estado da conversa + intenções de evento no MESMO
    // executor transacional. O contato também entra na transação (upsert
    // idempotente); falha entre escritas ⇒ rollback total, sem órfãos.
    const persisted = await persistInboundAtomically({
      externalMessageId: input.externalMessageId,
      externalConversationId: input.externalConversationId,
      content: input.content,
      sender: input.sender,
      senderType: input.senderType,
      sentAt: input.sentAt,
      // Nunca a URL bruta: asset só entra por `asset://<id>` após CLEAN.
      mediaUrl: undefined,
      mediaType: input.mediaType,
      mediaMimetype: input.mediaMimetype,
      mediaFilename: input.mediaFilename,
      metadata,
      contactPhone: input.contactPhone,
      contactName: input.contactName,
    });

    if (persisted.isDuplicate) {
      return ok({
        messageId: persisted.message.id,
        conversationId: persisted.message.conversationId,
        isNewConversation: false,
        mediaState: mediaIntake?.state,
      });
    }

    const { message, conversation, isNewConversation } = persisted;

    // Agenda o pipeline (não bloqueia o webhook em fetch/scan longos). O
    // processamento é idempotente por mensagem e recuperável pós-crash.
    if (pipelineEnabled && mediaIntake?.state === 'PENDING_SCAN' && input.mediaUrl) {
      void enqueueInboundMediaProcessing({
        messageId: message.id,
        conversationId: conversation.id,
        sourceUrl: input.mediaUrl,
        mediaType: input.mediaType,
        mimetype: input.mediaMimetype,
        filename: input.mediaFilename,
      });
    }

    // Audit (fora do escopo transacional do outbox): registro de criação de
    // conversa e de recebimento da mensagem.
    if (isNewConversation && input.userId) {
      await createAuditLog({
        userId: input.userId,
        action: 'conversation.created',
        entityType: 'conversation',
        entityId: conversation.id,
        newValue: conversation,
        metadata: {
          externalConversationId: input.externalConversationId,
          source: 'inbound',
        },
      });
    }

    if (input.userId) {
      await createAuditLog({
        userId: input.userId,
        action: 'message.inbound.received',
        entityType: 'message',
        entityId: message.id,
        metadata: {
          externalMessageId: input.externalMessageId,
          conversationId: conversation.id,
          // C07/AAA-17: remetente é PII; a cópia vive na mensagem, não na trilha.
          senderType: input.senderType ?? null,
          contentLength: input.content.length,
        },
      });
    }

    // PROD-10/BE13: a invocação da Secretary é DURÁVEL e assíncrona. A
    // intenção (`message.persisted`, inbound) já foi commitada na MESMA
    // transação da mensagem; o worker a reclama com lease e executa a IA,
    // retry/backoff e o envio idempotente (C05). O webhook NUNCA aguarda a IA
    // nem depende dela para confirmar o recibo.

    return ok({
      messageId: message.id,
      conversationId: conversation.id,
      isNewConversation,
      mediaState: mediaIntake?.state,
    });
  } catch (error) {
    return err(error as BadRequestError);
  }
}
