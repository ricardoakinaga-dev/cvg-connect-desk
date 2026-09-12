import './integration-mocks';
import crypto from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { resetWebhookSecurityStats } from '@cvg/shared';
import { buildDeskApiApp } from '../app.ts';

describe('Webhook security stats integration', () => {
  const password = 'Str0ngPass!42';
  const passwordHash = '$2a$10$QMxMJ8QfVxjH93DvTDs2m.OVuALoBBR6S9d58BwIPb8rcXHsUBJWC';
  const email = `webhook.stats.${Date.now()}@example.com`;
  const roleName = 'Admin';
  const secret = 'webhook-secret-stats';
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  let userId = '';
  let roleId = '';
  let createdRole = false;
  let token = '';
  const conversationId = `webhook.stats.${Date.now()}.conv`;
  const messageId = `webhook.stats.${Date.now()}.msg`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.DESK_ENV = 'production';
    process.env.WEBHOOK_SECRET = secret;
    process.env.CORS_ORIGIN = 'https://desk.test';

    app = await buildDeskApiApp();
    await app.ready();

    const existingRole = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.name, roleName))
      .limit(1);

    if (existingRole.length > 0) {
      roleId = existingRole[0].id;
    } else {
      roleId = randomUUID();
      createdRole = true;
      await db.insert(schema.roles).values({
        id: roleId,
        name: roleName,
        description: 'Role with admin permissions for webhook stats tests',
      });
    }

    userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId,
      name: 'Webhook Stats Admin',
      email,
      passwordHash,
      isActive: true,
    });

    await db.insert(schema.userRoles).values({
      userId,
      roleId,
    });

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });

    expect(login.statusCode).toBe(200);
    token = (login.json() as { token: string }).token;
  });

  beforeEach(async () => {
    resetWebhookSecurityStats();
    await cleanupWebhookArtifacts();
  });

  afterAll(async () => {
    resetWebhookSecurityStats();
    await cleanupWebhookArtifacts();
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));

    if (createdRole && roleId) {
      await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
    }

    await app.close();
  });

  async function cleanupWebhookArtifacts(): Promise<void> {
    const [conversation] = await db
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(eq(schema.conversations.externalConversationId, conversationId));

    if (conversation) {
      await db.delete(schema.messages).where(eq(schema.messages.conversationId, conversation.id));
      await db.delete(schema.conversationStatusHistory).where(eq(schema.conversationStatusHistory.conversationId, conversation.id));
      await db.delete(schema.conversations).where(eq(schema.conversations.id, conversation.id));
    }

    await db.delete(schema.messages).where(eq(schema.messages.externalMessageId, messageId));
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

  it('exposes operational counters for webhook reasons', async () => {
    const missingSignatureBody = {
      messageId: `${messageId}-missing`,
      conversationId: `${conversationId}-missing`,
      from: '+5511999000100',
      content: 'Sem assinatura',
    };
    const invalidSignatureBody = {
      messageId: `${messageId}-invalid`,
      conversationId: `${conversationId}-invalid`,
      from: '+5511999000101',
      content: 'Assinatura invalida',
    };
    const validBody = {
      messageId,
      conversationId,
      from: '+5511999000102',
      content: 'Assinatura valida',
      timestamp: new Date().toISOString(),
    };

    const missingSignature = await app.inject({
      method: 'POST',
      url: '/webhook/inbound',
      payload: missingSignatureBody,
    });
    expect(missingSignature.statusCode).toBe(401);

    const invalidSignature = await app.inject({
      method: 'POST',
      url: '/webhook/inbound',
      headers: {
        'x-webhook-signature': 'sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        'x-webhook-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-webhook-event-id': `evt-stats-invalid-${Date.now()}`,
      },
      payload: invalidSignatureBody,
    });
    expect(invalidSignature.statusCode).toBe(401);

    const validResponse = await app.inject({
      method: 'POST',
      url: '/webhook/inbound',
      headers: signedHeaders(validBody, `evt-stats-valid-${Date.now()}`),
      payload: validBody,
    });
    expect(validResponse.statusCode).toBe(200);

    const statsResponse = await app.inject({
      method: 'GET',
      url: '/admin/webhook-security/stats',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(statsResponse.statusCode).toBe(200);
    expect(statsResponse.json()).toMatchObject({
      total: 3,
      allowed: 1,
      denied: 2,
      byReason: {
        missing_signature: 1,
        invalid_signature: 1,
        signature_valid: 1,
      },
    });
  });
});
