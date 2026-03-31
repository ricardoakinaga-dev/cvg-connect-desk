import { FastifyInstance } from 'fastify';
import { handleGatewayInbound, handleGatewayReceipt, handleInstanceStatus, checkGatewayHealth } from '../../application/use-cases';
import { normalizeEvolutionMessage, normalizeConnectionUpdate, normalizeMessageUpdate } from '../../infrastructure/gateway-normalizer';
import type { WAInboundEvent, WAReceiptEvent, InstanceStatusEvent } from '../../types/gateway-contracts';

export async function registerGatewayRoutes(app: FastifyInstance) {

  // ============================================
  // WEBHOOK: Inbound do Gateway (WA_INBOUND)
  // Aceita tanto /gateway/inbound quanto /gateway/inbound/*
  // ============================================
  app.post('/gateway/inbound', handleInbound);
  app.post('/gateway/inbound/*', handleInbound);

  async function handleInbound(request: any, reply: any) {
    const event = request.body as any;

    // Detectar tipo de evento do Evolution API
    const path = request.url;
    let eventType = event?.event || event?.event_type || '';

    // Se o evento veio pela URL (ex: /gateway/inbound/messages-upsert)
    if (path.includes('/gateway/inbound/') && !eventType) {
      const urlEvent = path.split('/gateway/inbound/')[1];
      eventType = urlEvent?.toUpperCase().replace(/-/g, '_') || '';
    }

    request.log.info({ event_type: eventType, path }, '[Gateway] Evento recebido');

    // Roteamento por tipo de evento
    switch (eventType) {
      case 'WA_INBOUND':
      case 'MESSAGES_UPSERT': {
        // Mensagem recebida
        const waEvent = normalizeEvolutionMessage(event, eventType);
        if (waEvent) {
          const result = await handleGatewayInbound(waEvent);
          if (result.isErr()) {
            return reply.status(500).send({ error: 'PROCESSING_ERROR', message: result.error.message });
          }
          return reply.status(200).send(result.value);
        }
        return reply.status(200).send({ skipped: true });
      }

      case 'CONNECTION_UPDATE': {
        // Status da conexão mudou
        const instanceStatus = normalizeConnectionUpdate(event);
        if (instanceStatus) {
          await handleInstanceStatus(instanceStatus);
        }
        return reply.status(200).send({ processed: true });
      }

      case 'QRCODE_UPDATED': {
        // QR Code atualizado
        request.log.info({ instance: event?.instance }, '[Gateway] QR Code atualizado');
        return reply.status(200).send({ processed: true });
      }

      case 'MESSAGES_UPDATE': {
        // Status de mensagem atualizado (entrega, leitura)
        const receipt = normalizeMessageUpdate(event);
        if (receipt) {
          await handleGatewayReceipt(receipt);
        }
        return reply.status(200).send({ processed: true });
      }

      case 'SEND_MESSAGE': {
        // Mensagem enviada (confirmado pelo Evolution)
        return reply.status(200).send({ processed: true });
      }

      default:
        request.log.warn({ event_type: eventType }, '[Gateway] Evento desconhecido');
        return reply.status(200).send({ skipped: true, event_type: eventType });
    }
  }

  // ============================================
  // WEBHOOK: Receipt do Gateway (WA_RECEIPT)
  // ============================================
  app.post('/gateway/receipt', {
    schema: {
      description: 'Recebe confirmações de entrega do gateway',
      tags: ['Gateway'],
    },
  }, async (request, reply) => {
    const event = request.body as WAReceiptEvent;
    request.log.info({ event_id: event.event_id, status: event.payload?.status }, '[Gateway] Receipt recebido');

    const result = await handleGatewayReceipt(event);

    if (result.isErr()) {
      return reply.status(500).send({ error: 'PROCESSING_ERROR', message: result.error.message });
    }

    return reply.status(200).send(result.value);
  });

  // ============================================
  // WEBHOOK: Instance Status (INSTANCE_STATUS)
  // ============================================
  app.post('/gateway/instance-status', {
    schema: {
      description: 'Recebe status de instâncias WhatsApp',
      tags: ['Gateway'],
    },
  }, async (request, reply) => {
    const event = request.body as InstanceStatusEvent;
    request.log.info({ instance: event.payload?.instance, state: event.payload?.state }, '[Gateway] Instance status');

    const result = await handleInstanceStatus(event);

    if (result.isErr()) {
      return reply.status(500).send({ error: 'PROCESSING_ERROR', message: result.error.message });
    }

    return reply.status(200).send(result.value);
  });

  // ============================================
  // Health do Gateway
  // ============================================
  app.get('/gateway/health', {
    schema: {
      description: 'Verifica conectividade com o gateway',
      tags: ['Gateway'],
    },
  }, async (request, reply) => {
    const result = await checkGatewayHealth();
    return result.value;
  });

  // ============================================
  // OUTBOUND: Gateway busca mensagens pendentes
  // ============================================
  app.get('/gateway/outbound/pending', {
    schema: {
      description: 'Gateway busca mensagens outbound pendentes para enviar via Evolution',
      tags: ['Gateway'],
      querystring: {
        type: 'object',
        properties: {
          instance: { type: 'string' },
          limit: { type: 'integer', default: 10 },
        },
      },
    },
  }, async (request, reply) => {
    const { instance, limit = 10 } = request.query as { instance?: string; limit?: number };

    const { messageRepository } = await import('@cvg/chat');
    const { conversations } = await import('@cvg/database');

    // Buscar mensagens outbound pendentes
    const pendingMessages = await messageRepository.findPendingOutbound(limit);

    // Mapear para formato do gateway
    const outboundEvents = pendingMessages.map(msg => ({
      contract_version: '1.0.0',
      event_type: 'CW_OUTBOUND',
      event_id: msg.id,
      occurred_at: new Date().toISOString(),
      tenant: 'cvg',
      provider: 'chatwoot',
      channel: 'whatsapp',
      payload: {
        accountId: 1,
        inboxId: 1,
        conversationId: 0,
        chatwoot_message_id: 0,
        content: msg.content,
        sender: {
          type: 'agent',
          id: msg.sender || 'desk',
          name: msg.sender || 'CVG Desk',
        },
      },
    }));

    return { messages: outboundEvents, count: outboundEvents.length };
  });

  // ============================================
  // OUTBOUND: Marcar mensagem como enviada
  // ============================================
  app.post('/gateway/outbound/:id/sent', {
    schema: {
      description: 'Gateway confirma que mensagem foi enviada',
      tags: ['Gateway'],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { messageId } = request.body as { messageId?: string };

    const { messageRepository } = await import('@cvg/chat');
    await messageRepository.update(id, {
      status: 'sent',
      externalMessageId: messageId,
    });

    return { success: true };
  });
}
