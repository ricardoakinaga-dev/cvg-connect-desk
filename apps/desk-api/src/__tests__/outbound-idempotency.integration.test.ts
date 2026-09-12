import './integration-mocks';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

describe('Outbound idempotency integration', () => {
  const password = 'ChatRoutePass!42';
  const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
  const email = `outbound.idem.${Date.now()}@example.com`;
  const roleName = 'Receptionist';
  const conversationId = randomUUID();
  const userId = randomUUID();
  let roleId = '';
  let createdRole = false;
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  let token = '';

  beforeAll(async () => {
    app = await buildDeskApiApp();
    await app.ready();

    const [existingRole] = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.name, roleName));

    if (existingRole) {
      roleId = existingRole.id;
    } else {
      roleId = randomUUID();
      createdRole = true;
      await db.insert(schema.roles).values({
        id: roleId,
        name: roleName,
        description: 'Role for outbound idempotency tests',
      });
    }

    await db.insert(schema.users).values({
      id: userId,
      name: 'Outbound Idem User',
      email,
      passwordHash,
      isActive: true,
    });

    await db.insert(schema.userRoles).values({ userId, roleId });

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    token = (login.json() as { token: string }).token;
  });

  beforeEach(async () => {
    await cleanupConversation();
    await db.insert(schema.conversations).values({
      id: conversationId,
      status: 'open',
      statusV2: 'novo',
      currentHandler: 'bot',
      isActive: true,
    });
  });

  async function cleanupConversation(): Promise<void> {
    const msgs = await db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId));
    if (msgs.length > 0) {
      const { inArray } = await import('drizzle-orm');
      await db.delete(schema.outboundDeliveries).where(
        inArray(schema.outboundDeliveries.internalMessageId, msgs.map((m) => m.id))
      );
    }
    await db.delete(schema.messages).where(eq(schema.messages.conversationId, conversationId));
    await db.delete(schema.conversationStatusHistory).where(eq(schema.conversationStatusHistory.conversationId, conversationId));
    await db.delete(schema.conversations).where(eq(schema.conversations.id, conversationId));
  }

  afterAll(async () => {
    await cleanupConversation();
    if (userId) {
      await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, userId));
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
    if (createdRole) {
      await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
    }
    await app.close();
  });

  async function sendMessage(payload: Record<string, unknown>, idempotencyKey?: string) {
    return app.inject({
      method: 'POST',
      url: '/messages',
      headers: {
        authorization: `Bearer ${token}`,
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      payload: {
        conversationId,
        recipient: '+5511999999000',
        content: 'Mensagem outbound idempotente',
        ...payload,
      },
    });
  }

  it('primeiro envio com Idempotency-Key retorna 201', async () => {
    const response = await sendMessage({ content: 'Primeira' }, `idem-${conversationId}-a`);

    expect(response.statusCode).toBe(201);
    const body = response.json() as { messageId: string; deduplicated: boolean };
    expect(body.messageId).toBeTypeOf('string');
    expect(body.deduplicated).toBe(false);
  });

  it('retry com a mesma chave retorna 200 com o mesmo messageId sem duplicar', async () => {
    const key = `idem-${conversationId}-b`;

    const first = await sendMessage({ content: 'Original' }, key);
    expect(first.statusCode).toBe(201);
    const firstBody = first.json() as { messageId: string };

    const second = await sendMessage({ content: 'Conteudo diferente (retry)' }, key);
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as { messageId: string; deduplicated: boolean };
    expect(secondBody.messageId).toBe(firstBody.messageId);
    expect(secondBody.deduplicated).toBe(true);

    const rows = await db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.conversationId, conversationId),
          eq(schema.messages.direction, 'outbound')
        )
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('Original');
  });

  it('clientMessageId no body também deduplica', async () => {
    const clientMessageId = `client-${Date.now()}`;

    const first = await sendMessage({ content: 'Via body', clientMessageId });
    expect(first.statusCode).toBe(201);

    const second = await sendMessage({ content: 'Via body retry', clientMessageId });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { messageId: string }).messageId).toBe(
      (first.json() as { messageId: string }).messageId
    );
  });

  it('sem chave, cada request cria mensagem nova', async () => {
    const first = await sendMessage({ content: 'Sem chave 1' });
    const second = await sendMessage({ content: 'Sem chave 2' });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect((first.json() as { messageId: string }).messageId).not.toBe(
      (second.json() as { messageId: string }).messageId
    );
  });

  it('rejeita MIME nao permitido (media policy)', async () => {
    const response = await sendMessage({
      content: 'Malware?',
      mediaUrl: 'https://example.com/evil.sh',
      mediaType: 'image',
      mediaMimetype: 'application/x-sh',
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejeita URL interna SSRF (media policy)', async () => {
    const response = await sendMessage({
      content: 'SSRF?',
      mediaUrl: 'http://169.254.169.254/latest/meta-data/',
      mediaType: 'document',
      mediaMimetype: 'application/pdf',
    });
    expect(response.statusCode).toBe(400);
  });

  it('reconcilia status apos envio ao provider (mock)', async () => {
    const key = `idem-${conversationId}-reconcile`;
    const response = await sendMessage({ content: 'Reconciliar' }, key);
    expect(response.statusCode).toBe(201);
    const { messageId } = response.json() as { messageId: string };

    // sendViaEvolution é assíncrono; aguardar reconciliação (mock resolve imediato).
    let status: string | null = null;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const [row] = await db
        .select({ status: schema.messages.status })
        .from(schema.messages)
        .where(eq(schema.messages.id, messageId));
      status = row?.status ?? null;
      if (status === 'sent') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(status).toBe('sent');

    const [delivery] = await db
      .select()
      .from(schema.outboundDeliveries)
      .where(eq(schema.outboundDeliveries.idempotencyKey, key));
    expect(delivery).toMatchObject({ status: 'sent' });
    expect(delivery.attemptCount).toBeGreaterThanOrEqual(1);
  });
});
