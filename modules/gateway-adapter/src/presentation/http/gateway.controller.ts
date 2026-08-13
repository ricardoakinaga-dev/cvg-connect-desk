import { FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { handleGatewayInbound, handleGatewayReceipt, handleInstanceStatus, checkGatewayHealth } from '../../application/use-cases';
import { getGatewayDeskHandlers } from '../../application/desk-handlers';
import { normalizeEvolutionMessage, normalizeConnectionUpdate, normalizeMessageUpdate } from '../../infrastructure/gateway-normalizer';
import type { WAReceiptEvent, InstanceStatusEvent } from '../../types/gateway-contracts';
import { createGatewayAuthGuard } from './gateway-auth';

function isValidOutboundSentBody(body: unknown): body is { messageId?: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return false;
  }

  const entries = Object.entries(body);
  if (entries.some(([key]) => key !== 'messageId')) {
    return false;
  }

  const messageId = (body as { messageId?: unknown }).messageId;
  return messageId === undefined || (
    typeof messageId === 'string'
    && messageId.length > 0
    && messageId.length <= 256
  );
}

export async function registerGatewayRoutes(app: FastifyInstance) {

  // ============================================
  // WEBHOOK: Inbound do Gateway (WA_INBOUND)
  // Aceita tanto /gateway/inbound quanto /gateway/inbound/*
  // ============================================
  app.post('/gateway/inbound', {
    preHandler: createGatewayAuthGuard('inbound'),
    schema: {
      description: 'Recebe eventos inbound do gateway',
      tags: ['Gateway'],
      body: {
        type: 'object',
        minProperties: 1,
        maxProperties: 100,
        additionalProperties: true,
      },
    },
  }, handleInbound);
  app.post('/gateway/inbound/*', {
    preHandler: createGatewayAuthGuard('inbound'),
    schema: {
      description: 'Recebe eventos inbound do gateway por tipo de URL',
      tags: ['Gateway'],
      body: {
        type: 'object',
        minProperties: 1,
        maxProperties: 100,
        additionalProperties: true,
      },
    },
  }, handleInbound);

  async function handleInbound(request: FastifyRequest, reply: FastifyReply) {
    const event = request.body as Record<string, unknown> | undefined;

    // Detectar tipo de evento do Evolution API
    const path = request.url;
    let eventType = typeof event?.event === 'string' ? event.event : typeof event?.event_type === 'string' ? event.event_type : '';

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
            request.log.error({ err: result.error }, '[Gateway] Falha ao processar inbound');
            return reply.status(500).send({
              error: 'PROCESSING_ERROR',
              message: 'Gateway event could not be processed',
            });
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
    preHandler: createGatewayAuthGuard('receipt'),
    schema: {
      description: 'Recebe confirmações de entrega do gateway',
      tags: ['Gateway'],
      body: {
        type: 'object',
        required: ['event_type', 'event_id', 'occurred_at', 'provider', 'channel', 'payload'],
        properties: {
          event_type: { type: 'string', const: 'WA_RECEIPT' },
          event_id: { type: 'string', minLength: 1, maxLength: 128 },
          occurred_at: { type: 'string', minLength: 1, maxLength: 64 },
          provider: { type: 'string', minLength: 1, maxLength: 64 },
          channel: { type: 'string', const: 'whatsapp' },
          payload: {
            type: 'object',
            required: ['instance', 'remoteJid', 'messageId', 'status', 'status_at'],
            properties: {
              instance: { type: 'string', minLength: 1, maxLength: 128 },
              remoteJid: { type: 'string', minLength: 1, maxLength: 256 },
              messageId: { type: 'string', minLength: 1, maxLength: 256 },
              status: { type: 'string', enum: ['sent', 'delivered', 'read', 'failed', 'played'] },
              status_at: { type: 'string', minLength: 1, maxLength: 64 },
            },
            additionalProperties: true,
          },
        },
        additionalProperties: true,
      },
    },
  }, async (request, reply) => {
    const event = request.body as WAReceiptEvent;
    request.log.info({ event_id: event.event_id, status: event.payload?.status }, '[Gateway] Receipt recebido');

    const result = await handleGatewayReceipt(event);

    if (result.isErr()) {
      request.log.error({ err: result.error }, '[Gateway] Falha ao processar receipt');
      return reply.status(500).send({
        error: 'PROCESSING_ERROR',
        message: 'Gateway receipt could not be processed',
      });
    }

    return reply.status(200).send(result.value);
  });

  // ============================================
  // WEBHOOK: Instance Status (INSTANCE_STATUS)
  // ============================================
  app.post('/gateway/instance-status', {
    preHandler: createGatewayAuthGuard('instance-status'),
    schema: {
      description: 'Recebe status de instâncias WhatsApp',
      tags: ['Gateway'],
      body: {
        type: 'object',
        required: ['event_type', 'event_id', 'occurred_at', 'provider', 'channel', 'payload'],
        properties: {
          event_type: { type: 'string', const: 'INSTANCE_STATUS' },
          event_id: { type: 'string', minLength: 1, maxLength: 128 },
          occurred_at: { type: 'string', minLength: 1, maxLength: 64 },
          provider: { type: 'string', minLength: 1, maxLength: 64 },
          channel: { type: 'string', const: 'whatsapp' },
          payload: {
            type: 'object',
            required: ['instance', 'state', 'state_at'],
            properties: {
              instance: { type: 'string', minLength: 1, maxLength: 128 },
              state: { type: 'string', enum: ['online', 'offline', 'connecting', 'qr', 'logged_out', 'unknown'] },
              state_at: { type: 'string', minLength: 1, maxLength: 64 },
            },
            additionalProperties: true,
          },
        },
        additionalProperties: true,
      },
    },
  }, async (request, reply) => {
    const event = request.body as InstanceStatusEvent;
    request.log.info({ instance: event.payload?.instance, state: event.payload?.state }, '[Gateway] Instance status');

    const result = await handleInstanceStatus(event);

    if (result.isErr()) {
      request.log.error({ err: result.error }, '[Gateway] Falha ao processar status');
      return reply.status(500).send({
        error: 'PROCESSING_ERROR',
        message: 'Gateway instance status could not be processed',
      });
    }

    return reply.status(200).send(result.value);
  });

  // ============================================
  // Health do Gateway
  // ============================================
  app.get('/gateway/health', {
    preHandler: createGatewayAuthGuard('health'),
    schema: {
      description: 'Verifica conectividade com o gateway',
      tags: ['Gateway'],
    },
  }, async (_request, _reply) => {
    const result = await checkGatewayHealth();
    return result.value;
  });

  // ============================================
  // OUTBOUND: Gateway busca mensagens pendentes
  // ============================================
  app.get('/gateway/outbound/pending', {
    preHandler: createGatewayAuthGuard('outbound:read'),
    schema: {
      description: 'Gateway busca mensagens outbound pendentes para enviar via Evolution',
      tags: ['Gateway'],
      querystring: {
        type: 'object',
        properties: {
          instance: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
        },
      },
    },
  }, async (request, _reply) => {
    const { limit = 10 } = request.query as { instance?: string; limit?: number };

    const handlers = getGatewayDeskHandlers();
    const pendingMessages = await handlers.findPendingOutbound(limit);

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
    preHandler: createGatewayAuthGuard('outbound:write'),
    schema: {
      description: 'Gateway confirma que mensagem foi enviada',
      tags: ['Gateway'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 128 },
        },
      },
      body: {
        type: 'object',
        properties: {
          messageId: { type: 'string', minLength: 1, maxLength: 256 },
        },
        additionalProperties: true,
      },
    },
  }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    if (!isValidOutboundSentBody(request.body)) {
      return _reply.status(400).send({
        error: 'INVALID_PAYLOAD',
        message: 'Invalid outbound confirmation payload',
      });
    }

    const { messageId } = request.body;

    const handlers = getGatewayDeskHandlers();
    await handlers.markOutboundSent(id, messageId);

    return { success: true };
  });
}
