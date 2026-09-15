import { FastifyInstance } from 'fastify';
import { handleGatewayInbound, handleGatewayReceipt, handleInstanceStatus, checkGatewayHealth } from '../../application/use-cases';
import { toWAInboundEvent, normalizeConnectionUpdate, normalizeMessageUpdate } from '../../infrastructure/gateway-normalizer';
import { createWebhookGuard } from '@cvg/shared';
import type { GatewayHandlerPorts } from '@cvg/messaging-contracts';
import type { WAReceiptEvent, InstanceStatusEvent } from '../../types/gateway-contracts';

export async function registerGatewayRoutes(app: FastifyInstance, ports: GatewayHandlerPorts) {
  const webhookGuard = createWebhookGuard();

  // G-C02-1: rotas internas de outbound exigem credencial de serviço (C02 D-C02-8),
  // separada da sessão de usuário. Fail-closed quando o segredo não está configurado.
  function createServiceCredentialGuard() {
    const secrets = [process.env.GATEWAY_API_KEY, process.env.INTERNAL_EVENTS_SECRET]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim());

    return async function serviceCredentialGuard(request: any, reply: any) {
      const raw = request.headers?.['x-api-key'];
      const provided = Array.isArray(raw) ? raw[0] : raw;
      const valid = typeof provided === 'string'
        && provided.trim().length > 0
        && secrets.length > 0
        && secrets.includes(provided.trim());

      if (!valid) {
        request.log?.warn?.({ hasCredential: typeof provided === 'string' && provided.length > 0 }, '[Gateway] Service credential rejected');
        return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Service credential required' });
      }
    };
  }

  const serviceGuard = createServiceCredentialGuard();

  // ============================================
  // WEBHOOK: Inbound do Gateway (WA_INBOUND)
  // Protegido por HMAC (fail-secure em produção).
  // ============================================
  const webhookRateLimit = {
    max: Number(process.env.RATE_LIMIT_WEBHOOK_MAX) || 300,
    timeWindow: process.env.RATE_LIMIT_WEBHOOK_WINDOW || '1 minute',
  };
  app.post('/gateway/inbound', { preHandler: webhookGuard, config: { rateLimit: webhookRateLimit } }, handleInbound);
  app.post('/gateway/inbound/*', { preHandler: webhookGuard, config: { rateLimit: webhookRateLimit } }, handleInbound);

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
        const waEvent = toWAInboundEvent(event, eventType);
        if (waEvent) {
          const result = await handleGatewayInbound(waEvent, ports);
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
          await handleGatewayReceipt(receipt, ports);
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
    preHandler: webhookGuard,
    config: { rateLimit: webhookRateLimit },
    schema: {
      description: 'Recebe confirmações de entrega do gateway',
      tags: ['Gateway'],
    },
  }, async (request, reply) => {
    const event = request.body as WAReceiptEvent;
    request.log.info({ event_id: event.event_id, status: event.payload?.status }, '[Gateway] Receipt recebido');

    const result = await handleGatewayReceipt(event, ports);

    if (result.isErr()) {
      return reply.status(500).send({ error: 'PROCESSING_ERROR', message: result.error.message });
    }

    return reply.status(200).send(result.value);
  });

  // ============================================
  // WEBHOOK: Instance Status (INSTANCE_STATUS)
  // ============================================
  app.post('/gateway/instance-status', {
    preHandler: webhookGuard,
    config: { rateLimit: webhookRateLimit },
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
  }, async () => {
    const result = await checkGatewayHealth();
    return result.value;
  });

  // ============================================
  // OUTBOUND: Gateway busca mensagens pendentes
  // ============================================
  app.get('/gateway/outbound/pending', {
    preHandler: serviceGuard,
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
  }, async (request) => {
    const { limit = 10 } = request.query as { instance?: string; limit?: number };

    // Buscar mensagens outbound pendentes pela porta injetada (C02 §5).
    const pendingMessages = await ports.messageRead.listPendingOutbound(limit);

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
    preHandler: serviceGuard,
    schema: {
      description: 'Gateway confirma que mensagem foi enviada',
      tags: ['Gateway'],
    },
  }, async (request) => {
    const { id } = request.params as { id: string };
    const { messageId } = request.body as { messageId?: string };

    await ports.confirmation.markOutboundSent({
      internalMessageId: id,
      externalMessageId: messageId,
    });

    return { success: true };
  });
}
