import { FastifyInstance } from 'fastify';
import { handleGatewayInbound, handleGatewayReceipt, handleInstanceStatus, checkGatewayHealth } from '../../application/use-cases';
import type { WAInboundEvent, WAReceiptEvent, InstanceStatusEvent } from '../../types/gateway-contracts';

export async function registerGatewayRoutes(app: FastifyInstance) {

  // ============================================
  // WEBHOOK: Inbound do Gateway (WA_INBOUND)
  // ============================================
  app.post('/gateway/inbound', {
    schema: {
      description: 'Recebe mensagens inbound do gateway (Evolution API → Desk)',
      tags: ['Gateway'],
      body: {
        type: 'object',
        required: ['event_type', 'event_id', 'payload'],
        properties: {
          contract_version: { type: 'string' },
          event_type: { type: 'string', const: 'WA_INBOUND' },
          event_id: { type: 'string' },
          correlation_id: { type: 'string' },
          occurred_at: { type: 'string' },
          provider: { type: 'string' },
          channel: { type: 'string' },
          payload: {
            type: 'object',
            required: ['instance', 'remoteJid', 'messageId', 'fromMe', 'type', 'timestamp'],
            properties: {
              instance: { type: 'string' },
              remoteJid: { type: 'string' },
              messageId: { type: 'string' },
              fromMe: { type: 'boolean' },
              pushName: { type: 'string' },
              type: { type: 'string' },
              text: { type: 'string' },
              timestamp: { type: 'number' },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const event = request.body as WAInboundEvent;
    request.log.info({ event_id: event.event_id, type: event.event_type }, '[Gateway] Inbound recebido');

    const result = await handleGatewayInbound(event);

    if (result.isErr()) {
      request.log.error({ err: result.error }, '[Gateway] Erro ao processar inbound');
      return reply.status(500).send({ error: 'PROCESSING_ERROR', message: result.error.message });
    }

    return reply.status(200).send(result.value);
  });

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
