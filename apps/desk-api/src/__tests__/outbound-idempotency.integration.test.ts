import './integration-mocks';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

describe('Outbound idempotency integration', () => {
  const password = 'ChatRoutePass!42';
  const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
  const email = `outbound.idem.${Date.now()}@example.com`;
  const roleName = 'Receptionist';
  const conversationId = randomUUID();
  const userId = randomUUID();
  let sectorId = '';
  let roleId = '';
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
      // Papel compartilhado entre suítes: criação idempotente e nunca removida
      // (apagar em paralelo quebra o teardown de outra suíte via FK).
      roleId = randomUUID();
      await db
        .insert(schema.roles)
        .values({
          id: roleId,
          name: roleName,
          description: 'Role for outbound idempotency tests',
        })
        .onConflictDoNothing({ target: schema.roles.name });
      const [createdRoleRow] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, roleName));
      roleId = createdRoleRow.id;
    }

    await db.insert(schema.users).values({
      id: userId,
      name: 'Outbound Idem User',
      email,
      passwordHash,
      isActive: true,
    });

    await db.insert(schema.userRoles).values({ userId, roleId });

    // AAA-04 (MUD-CAT-002): conversa com setor exige membership para o ator de teste.
    const suffix = String(Date.now()).slice(-6);
    const [sector] = await db.insert(schema.sectors).values({ name: `outbound-idem ${suffix}`, code: `oidem${suffix}` }).returning();
    sectorId = sector.id;
    await db.insert(schema.userSectors).values({ userId, sectorId, accessLevel: 'write' });

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
      sectorId,
    });
  });

  async function cleanupConversation(): Promise<void> {
    const msgs = await db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId));
    if (msgs.length > 0) {
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
      await db.delete(schema.userSectors).where(eq(schema.userSectors.userId, userId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
    if (sectorId) {
      await db.delete(schema.sectors).where(eq(schema.sectors.id, sectorId));
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

    // C04: retry com MESMO payload é a mesma intenção (dedup).
    const second = await sendMessage({ content: 'Original' }, key);
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as { messageId: string; deduplicated: boolean };
    expect(secondBody.messageId).toBe(firstBody.messageId);
    expect(secondBody.deduplicated).toBe(true);

    // C04: reuso com payload divergente é conflito (409), sem side effects.
    const divergent = await sendMessage({ content: 'Conteudo diferente (retry)' }, key);
    expect(divergent.statusCode).toBe(409);
    expect((divergent.json() as { error: string }).error).toBe('IDEMPOTENCY_KEY_CONFLICT');

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

    // C04: mesmo payload deduplica; payload divergente com a mesma chave ⇒ 409.
    const second = await sendMessage({ content: 'Via body', clientMessageId });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { messageId: string }).messageId).toBe(
      (first.json() as { messageId: string }).messageId
    );

    const divergent = await sendMessage({ content: 'Via body retry', clientMessageId });
    expect(divergent.statusCode).toBe(409);
    expect((divergent.json() as { error: string }).error).toBe('IDEMPOTENCY_KEY_CONFLICT');
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

  it('pipeline opt-in bloqueia bytes infectados embarcados', async () => {
    process.env.MEDIA_PIPELINE_ENABLED = 'true';
    process.env.MALWARE_SCANNER = 'fake';
    process.env.MEDIA_STORAGE_DRIVER = 'memory';
    try {
      const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
      const dataUrl = `data:image/jpeg;base64,${Buffer.from(eicar).toString('base64')}`;
      const response = await sendMessage({
        content: 'Anexo?',
        mediaUrl: dataUrl,
        mediaType: 'image',
        mediaMimetype: 'image/jpeg',
      });
      expect(response.statusCode).toBe(400);

      // Nenhuma mensagem persistida para o envio bloqueado.
      const rows = await db
        .select()
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.conversationId, conversationId),
            eq(schema.messages.direction, 'outbound')
          )
        );
      expect(rows).toHaveLength(0);
    } finally {
      delete process.env.MEDIA_PIPELINE_ENABLED;
      delete process.env.MALWARE_SCANNER;
      delete process.env.MEDIA_STORAGE_DRIVER;
      const { createHash } = await import('crypto');
      const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
      const sha = createHash('sha256').update(eicar).digest('hex');
      await db.delete(schema.mediaAssets).where(eq(schema.mediaAssets.sha256, sha));
    }
  });

  it('reconcilia status apos envio ao provider (mock)', async () => {
    const key = `idem-${conversationId}-reconcile`;
    const response = await sendMessage({ content: 'Reconciliar' }, key);
    expect(response.statusCode).toBe(201);
    const { messageId } = response.json() as { messageId: string };

    // sendViaEvolution é assíncrono; aguardar reconciliação (mock resolve imediato).
    // Poll na DELIVERY (última escrita da cadeia) por internal_message_id: a
    // coluna `idempotency_key` guarda a chave de armazenamento derivada (C04).
    let delivery: { status: string | null; attemptCount: number } | null = null;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const [row] = await db
        .select({ status: schema.outboundDeliveries.status, attemptCount: schema.outboundDeliveries.attemptCount })
        .from(schema.outboundDeliveries)
        .where(eq(schema.outboundDeliveries.internalMessageId, messageId));
      delivery = row ?? null;
      if (delivery?.status === 'sent') break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(delivery?.status).toBe('sent');

    const [message] = await db
      .select({ status: schema.messages.status })
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId));
    expect(message?.status).toBe('sent');
    expect(delivery?.attemptCount).toBeGreaterThanOrEqual(1);
  });
});
