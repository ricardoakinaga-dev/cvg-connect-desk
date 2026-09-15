import { describe, it, expect, vi } from 'vitest';
import { handleGatewayInbound, handleGatewayReceipt } from '../application/use-cases';
import { registerGatewayRoutes } from '../presentation/http/gateway.controller';
import { normalizeEvolutionMessage } from '../infrastructure/gateway-normalizer';
import type { GatewayHandlerPorts, MessageView } from '@cvg/messaging-contracts';

function stubPorts(overrides: Partial<GatewayHandlerPorts> = {}): GatewayHandlerPorts {
  return {
    inbound: {
      submit: vi.fn().mockResolvedValue({
        ok: true,
        value: { messageId: 'm1', conversationId: 'c1', isNewConversation: true },
      }),
    },
    messageRead: {
      findByExternalId: vi.fn().mockResolvedValue(null),
      listPendingOutbound: vi.fn().mockResolvedValue([]),
    },
    messageStatus: {
      applyReceipt: vi.fn().mockResolvedValue({ updated: true, messageId: 'm1' }),
    },
    confirmation: {
      markOutboundSent: vi.fn().mockResolvedValue({ updated: true, messageId: 'm1' }),
    },
    ...overrides,
  };
}

const evolutionTextPayload = {
  event: 'MESSAGES_UPSERT',
  instance: 'cvg-desk',
  data: {
    key: {
      remoteJid: '5511999999999@s.whatsapp.net',
      id: 'wamid.porta.1',
      fromMe: false,
    },
    pushName: 'Porta Teste',
    message: { conversation: 'Ola porta' },
    messageTimestamp: 1789176300,
  },
};

function makeInboundEvent() {
  const waEvent = normalizeEvolutionMessage(evolutionTextPayload);
  if (!waEvent) throw new Error('normalizeEvolutionMessage retornou null no fixture');
  return waEvent;
}

function makeReceiptEvent(status: 'sent' | 'delivered' | 'read' | 'failed' | 'played') {
  return {
    contract_version: '1.0.0',
    event_type: 'WA_RECEIPT' as const,
    event_id: 'receipt-1',
    occurred_at: new Date().toISOString(),
    provider: 'evolutionapi' as const,
    channel: 'whatsapp' as const,
    payload: {
      instance: 'cvg-desk',
      remoteJid: '5511999999999@s.whatsapp.net',
      messageId: 'ext-msg-1',
      status,
      status_at: new Date().toISOString(),
    },
  };
}

describe('gateway → chat via portas injetadas (C02 §5)', () => {
  it('inbound: submete pela InboundMessagePort e responde processado', async () => {
    const ports = stubPorts();
    const result = await handleGatewayInbound(makeInboundEvent(), ports);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toMatchObject({ processed: true, messageId: 'm1', conversationId: 'c1' });
    }
    expect(ports.inbound.submit).toHaveBeenCalledWith(
      expect.objectContaining({ externalMessageId: 'wamid.porta.1', content: 'Ola porta' }),
    );
  });

  it('inbound: rejeição da porta vira err explícito', async () => {
    const ports = stubPorts({
      inbound: {
        submit: vi.fn().mockResolvedValue({ ok: false, error: { code: 'BAD_REQUEST', message: 'rejeitada' } }),
      },
    });
    const result = await handleGatewayInbound(makeInboundEvent(), ports);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('rejeitada');
  });

  it('receipt: aplica pela MessageStatusPort com status interno mapeado', async () => {
    const ports = stubPorts();
    const result = await handleGatewayReceipt(makeReceiptEvent('read') as never, ports);

    expect(ports.messageStatus.applyReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ externalMessageId: 'ext-msg-1', status: 'read' }),
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ updated: true, messageId: 'm1', status: 'delivered' });
    }
  });

  it('receipt: mensagem desconhecida ⇒ skipped sem erro', async () => {
    const ports = stubPorts({
      messageStatus: { applyReceipt: vi.fn().mockResolvedValue({ updated: false }) },
    });
    const result = await handleGatewayReceipt(makeReceiptEvent('delivered') as never, ports);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toEqual({ skipped: true, reason: 'message_not_found' });
  });
});

describe('rotas /gateway/outbound via portas injetadas', () => {
  function fakeApp() {
    const handlers = new Map<string, (request: unknown, reply: unknown) => Promise<unknown>>();
    const app = {
      post: (path: string, _opts: unknown, handler: (request: unknown, reply: unknown) => Promise<unknown>) => {
        handlers.set(`POST ${path}`, handler);
      },
      get: (path: string, _opts: unknown, handler: (request: unknown, reply: unknown) => Promise<unknown>) => {
        handlers.set(`GET ${path}`, handler);
      },
    };
    return { app, handlers };
  }

  const reply = {
    status: (code: number) => ({ send: (body: unknown) => ({ code, body }) }),
  };

  it('pull outbound: usa MessageReadPort e preserva o shape CW_OUTBOUND', async () => {
    const view: MessageView = {
      id: 'm1',
      conversationId: 'c1',
      direction: 'outbound',
      content: 'ola pull',
      sender: 'Agente',
      recipient: null,
      status: 'pending',
      externalMessageId: null,
      createdAt: new Date(),
    };
    const ports = stubPorts({
      messageRead: {
        findByExternalId: vi.fn().mockResolvedValue(null),
        listPendingOutbound: vi.fn().mockResolvedValue([view]),
      },
    });
    const { app, handlers } = fakeApp();
    await registerGatewayRoutes(app as never, ports);

    const handler = handlers.get('GET /gateway/outbound/pending');
    expect(handler).toBeDefined();
    const response = (await handler!({ query: { limit: 5 } }, reply)) as {
      count: number;
      messages: Array<{ event_id: string; payload: { content: string } }>;
    };

    expect(ports.messageRead.listPendingOutbound).toHaveBeenCalledWith(5);
    expect(response.count).toBe(1);
    expect(response.messages[0].event_id).toBe('m1');
    expect(response.messages[0].payload.content).toBe('ola pull');
  });

  it('confirmação: usa OutboundConfirmationPort por id interno e preserva {success:true}', async () => {
    const ports = stubPorts();
    const { app, handlers } = fakeApp();
    await registerGatewayRoutes(app as never, ports);

    const handler = handlers.get('POST /gateway/outbound/:id/sent');
    expect(handler).toBeDefined();
    const response = await handler!({ params: { id: 'm1' }, body: { messageId: 'ext-9' } }, reply);

    expect(ports.confirmation.markOutboundSent).toHaveBeenCalledWith({
      internalMessageId: 'm1',
      externalMessageId: 'ext-9',
    });
    expect(response).toEqual({ success: true });
  });
});
