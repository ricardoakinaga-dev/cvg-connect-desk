import type { WAInboundEvent, WAReceiptEvent, InstanceStatusEvent } from '../../types/gateway-contracts';
import { normalizeGatewayInbound } from '../../infrastructure/gateway-normalizer';
import { gatewayService } from '../../infrastructure/gateway-service';
import { parseInboundMessageV1 } from '@cvg/messaging-contracts';
import { ok, err } from '@cvg/shared';

/**
 * Processa evento WA_INBOUND do gateway.
 * Converte para formato interno e chama o use case de receiveInboundMessage.
 */
export async function handleGatewayInbound(event: WAInboundEvent) {
  try {
    // Validar contrato básico
    if (event.event_type !== 'WA_INBOUND') {
      return err(new Error(`Invalid event_type: ${event.event_type}`));
    }

    if (!event.payload?.messageId || !event.payload?.remoteJid) {
      return err(new Error('Missing required payload fields'));
    }

    // Normalizar para formato interno
    const normalized = normalizeGatewayInbound(event);

    // Contrato de fronteira: domínio nunca recebe payload fora de InboundMessageV1.
    const contract = parseInboundMessageV1({
      specVersion: '1.0.0',
      externalMessageId: normalized.externalMessageId,
      externalConversationId: normalized.externalConversationId,
      content: normalized.content,
      sender: normalized.sender,
      senderType: normalized.senderType,
      contactPhone: normalized.contactPhone,
      contactName: normalized.contactName,
      sentAt: normalized.sentAt,
      mediaUrl: normalized.mediaUrl,
      mediaMimetype: normalized.mediaMimetype,
      mediaFilename: normalized.mediaFilename,
    });
    if (!contract.ok) {
      return err(new Error(`Inbound contract violation: ${contract.issues}`));
    }

    // Ignorar mensagens enviadas por nós (fromMe=true)
    if (event.payload.fromMe) {
      return ok({ skipped: true, reason: 'fromMe' });
    }

    // Chamar o use case de inbound do módulo chat
    const { receiveInboundMessage } = await import('@cvg/chat');
    const result = await receiveInboundMessage({
      externalMessageId: normalized.externalMessageId,
      externalConversationId: normalized.externalConversationId,
      content: normalized.content,
      sender: normalized.sender,
      senderType: normalized.senderType,
      contactPhone: normalized.contactPhone,
      contactName: normalized.contactName,
      sentAt: normalized.sentAt,
      // Media fields
      mediaUrl: normalized.mediaUrl,
      mediaType: normalized.messageType,
      mediaMimetype: normalized.mediaMimetype,
      mediaFilename: normalized.mediaFilename,
      metadata: {
        gateway: true,
        instance: normalized.instance,
        channel: normalized.channel,
        correlationId: normalized.correlationId,
        eventId: normalized.eventId,
        messageType: normalized.messageType,
      },
    });

    if (result.isErr()) {
      return err(result.error);
    }

    return ok({
      processed: true,
      messageId: result.value.messageId,
      conversationId: result.value.conversationId,
      isNewConversation: result.value.isNewConversation,
    });
  } catch (error) {
    console.error('[handleGatewayInbound] Erro:', error);
    return err(error as Error);
  }
}

/**
 * Processa evento WA_RECEIPT do gateway.
 * Atualiza status de entrega da mensagem.
 */
export async function handleGatewayReceipt(event: WAReceiptEvent) {
  try {
    if (event.event_type !== 'WA_RECEIPT') {
      return err(new Error(`Invalid event_type: ${event.event_type}`));
    }

    const { messageRepository } = await import('@cvg/chat');
    const message = await messageRepository.findByExternalId(event.payload.messageId);

    if (!message) {
      return ok({ skipped: true, reason: 'message_not_found' });
    }

    // Mapear status do gateway para status interno
    const statusMap: Record<string, string> = {
      sent: 'sent',
      delivered: 'delivered',
      read: 'delivered',
      failed: 'failed',
      played: 'delivered',
    };

    const internalStatus = statusMap[event.payload.status] || 'sent';

    // Atualizar status da mensagem
    await messageRepository.update(message.id, {
      status: internalStatus as any,
      deliveredAt: event.payload.status === 'delivered' ? new Date(event.payload.status_at) : undefined,
    });

    return ok({ updated: true, messageId: message.id, status: internalStatus });
  } catch (error) {
    console.error('[handleGatewayReceipt] Erro:', error);
    return err(error as Error);
  }
}

/**
 * Processa evento INSTANCE_STATUS do gateway.
 * Cria alerta se instância ficar offline.
 */
export async function handleInstanceStatus(event: InstanceStatusEvent) {
  try {
    if (event.event_type !== 'INSTANCE_STATUS') {
      return err(new Error(`Invalid event_type: ${event.event_type}`));
    }

    const { state, instance } = event.payload;

    // Criar alerta se instância ficar offline ou logged_out
    if (state === 'offline' || state === 'logged_out') {
      const { createAlert } = await import('@cvg/alerts');
      await createAlert({
        type: 'system',
        title: `Instância WhatsApp ${state === 'offline' ? 'desconectou' : 'deslogou'}`,
        message: `A instância "${instance}" está ${state}. ${event.payload.reason || ''}`,
        severity: state === 'logged_out' ? 'critical' : 'warning',
        metadata: { instance, state, event: event.event_id },
      });
    }

    return ok({ processed: true, instance, state });
  } catch (error) {
    console.error('[handleInstanceStatus] Erro:', error);
    return err(error as Error);
  }
}

/**
 * Health check do gateway.
 */
export async function checkGatewayHealth() {
  const healthy = await gatewayService.healthCheck();
  return ok({ gateway: healthy ? 'connected' : 'disconnected' });
}
