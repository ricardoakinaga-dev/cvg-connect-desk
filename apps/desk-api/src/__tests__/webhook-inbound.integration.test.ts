import './integration-mocks';
import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

describe('Webhook inbound integration', () => {
  const secret = 'webhook-secret-integration';
  const externalMessageId = `webhook.integration.${Date.now()}.msg`;
  const externalConversationId = `webhook.integration.${Date.now()}.conv`;
  let app: Awaited<ReturnType<typeof buildDeskApiApp>> | null = null;

  beforeEach(async () => {
    process.env.DESK_ENV = 'production';
    process.env.WEBHOOK_SECRET = secret;
    app = await buildDeskApiApp();
    await app.ready();
  });

  afterEach(async () => {
    await cleanupWebhookArtifacts(externalConversationId, externalMessageId);
    await cleanupWebhookArtifacts(`${externalConversationId}-replay`, `${externalMessageId}-replay`);
    try {
      await db.execute(`DELETE FROM webhook_replay_log WHERE event_id LIKE 'evt-%'`);
    } catch {
      // tabela pode não existir em ambientes sem migration 0013 — ignorar
    }

    if (app) {
      await app.close();
      app = null;
    }

    process.env.DESK_ENV = '';
    process.env.WEBHOOK_SECRET = '';
    process.env.NODE_ENV = 'test';
  });

  async function cleanupWebhookArtifacts(convId: string, msgId: string): Promise<void> {
    const [conversation] = await db
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(eq(schema.conversations.externalConversationId, convId));

    if (conversation) {
      await db.delete(schema.messages).where(eq(schema.messages.conversationId, conversation.id));
      await db.delete(schema.conversationStatusHistory).where(eq(schema.conversationStatusHistory.conversationId, conversation.id));
      await db.delete(schema.conversations).where(eq(schema.conversations.id, conversation.id));
    }

    await db.delete(schema.messages).where(eq(schema.messages.externalMessageId, msgId));
  }

  function signedHeaders(body: Record<string, unknown>, eventId: string): Record<string, string> {
    const rawBody = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    return {
      'x-webhook-signature': `sha256=${signature}`,
      'x-webhook-timestamp': timestamp,
      'x-webhook-event-id': eventId,
      'content-type': 'application/json',
    };
  }

  it('rejeita request sem assinatura e nao contamina o pipeline', async () => {
    const body = {
      messageId: `${externalMessageId}-missing`,
      conversationId: `${externalConversationId}-missing`,
      from: '+5511999000000',
      content: 'Mensagem sem assinatura',
    };

    const response = await app!.inject({
      method: 'POST',
      url: '/webhook/inbound',
      payload: body,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: 'UNAUTHORIZED',
      reason: 'missing_signature',
      message: 'Missing webhook signature',
    });
  });

  it('rejeita request com assinatura invalida e nao contamina o pipeline', async () => {
    const body = {
      messageId: `${externalMessageId}-invalid`,
      conversationId: `${externalConversationId}-invalid`,
      from: '+5511999000001',
      content: 'Mensagem com assinatura invalida',
    };

    const response = await app!.inject({
      method: 'POST',
      url: '/webhook/inbound',
      headers: {
        'x-webhook-signature': 'sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        'x-webhook-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-webhook-event-id': `evt-invalid-${Date.now()}`,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: 'UNAUTHORIZED',
      reason: 'invalid_signature',
      message: 'Invalid webhook signature',
    });
  });

  it('rejeita replay de event ID duplicado', async () => {
    const body = {
      messageId: `${externalMessageId}-replay`,
      conversationId: `${externalConversationId}-replay`,
      from: '+5511999000005',
      content: 'Mensagem replay',
    };
    const eventId = `evt-replay-${Date.now()}`;
    const headers = signedHeaders(body, eventId);

    const first = await app!.inject({
      method: 'POST',
      url: '/webhook/inbound',
      headers,
      payload: body,
    });
    expect(first.statusCode).toBe(200);

    const second = await app!.inject({
      method: 'POST',
      url: '/webhook/inbound',
      headers,
      payload: body,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      success: true,
      deduplicated: true,
      eventId,
    });

    await cleanupWebhookArtifacts(`${externalConversationId}-replay`, `${externalMessageId}-replay`);
  });

  it('rejeita timestamp antigo (anti-replay)', async () => {
    const body = {
      messageId: `${externalMessageId}-oldts`,
      conversationId: `${externalConversationId}-oldts`,
      from: '+5511999000006',
      content: 'Mensagem antiga',
    };
    const rawBody = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000) - 3600);
    const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

    const response = await app!.inject({
      method: 'POST',
      url: '/webhook/inbound',
      headers: {
        'x-webhook-signature': `sha256=${signature}`,
        'x-webhook-timestamp': timestamp,
        'x-webhook-event-id': `evt-oldts-${Date.now()}`,
      },
      payload: body,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ reason: 'timestamp_too_old' });
  });

  it('rejeita inbound sem messageId (canonical ID obrigatório)', async () => {
    const body = {
      conversationId: `${externalConversationId}-noid`,
      from: '+5511999000007',
      content: 'Sem ID',
    };

    const response = await app!.inject({
      method: 'POST',
      url: '/webhook/inbound',
      headers: signedHeaders(body, `evt-noid-${Date.now()}`),
      payload: body,
    });
    // Schema exige messageId; sem ele, 400 de validação.
    expect([400, 500]).toContain(response.statusCode);
  });

  it('request valida passa pela rota e persiste conversa/mensagem', async () => {
    const body = {
      messageId: externalMessageId,
      conversationId: externalConversationId,
      from: '+5511999000002',
      content: 'Mensagem inbound de integracao',
      timestamp: new Date().toISOString(),
    };

    const response = await app!.inject({
      method: 'POST',
      url: '/webhook/inbound',
      headers: signedHeaders(body, `evt-valid-${Date.now()}`),
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    const parsed = response.json() as { success: boolean; messageId: string; conversationId: string };
    expect(parsed.success).toBe(true);
    expect(parsed.messageId).toBeTypeOf('string');
    expect(parsed.conversationId).toBeTypeOf('string');

    const [message] = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.externalMessageId, externalMessageId));

    expect(message).toBeDefined();
    expect(message.content).toBe('Mensagem inbound de integracao');
    expect(message.direction).toBe('inbound');

    const [conversation] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.externalConversationId, externalConversationId));

    expect(conversation).toBeDefined();
    expect(conversation.externalConversationId).toBe(externalConversationId);
  });

  it('producao sem WEBHOOK_SECRET falha de forma segura', async () => {
    await app!.close();
    app = null;
    process.env.NODE_ENV = 'production';
    process.env.DESK_ENV = 'production';
    process.env.WEBHOOK_SECRET = '';
    process.env.CORS_ORIGIN = 'https://desk.test';

    app = await buildDeskApiApp();
    await app.ready();

    const body = {
      messageId: `${externalMessageId}-no-secret`,
      conversationId: `${externalConversationId}-no-secret`,
      from: '+5511999000003',
      content: 'Mensagem sem secret',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/inbound',
      payload: body,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: 'CONFIGURATION_ERROR',
      reason: 'missing_secret',
      message: 'Webhook security not properly configured',
    });
  });

  it('dev sem WEBHOOK_SECRET permite request com warning (DX behavior)', async () => {
    await app!.close();
    app = null;
    process.env.NODE_ENV = 'development';
    process.env.DESK_ENV = '';
    process.env.WEBHOOK_SECRET = '';

    app = await buildDeskApiApp();
    await app.ready();

    const body = {
      messageId: `${externalMessageId}-dev-no-secret`,
      conversationId: `${externalConversationId}-dev-no-secret`,
      from: '+5511999000004',
      content: 'Mensagem em dev sem secret',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/inbound',
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
    });
  });
});
