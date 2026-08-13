import { type Page } from '@playwright/test';
const { db, schema } = await import('../../packages/database/src/index.ts');
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';


export const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || process.env.E2E_ADMIN_EMAIL || 'e2e-admin@cvg.test';
export const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || process.env.E2E_ADMIN_PASSWORD || 'E2eSmokePass!2026';

/**
 * E2E Conversation Fixture — creates a stable contact + conversation + message
 * for the send-message smoke test. Idempotent: cleans up after itself.
 *
 * Returns the conversation ID and contact ID so the test can use them directly.
 */
export async function ensureE2EConversation(): Promise<{
  conversationId: string;
  contactId: string;
}> {
  const fixturePhone = '+5511988880011';
  const fixtureName = 'E2E Smoke Contact';

  // Get admin user ID so the conversation is assigned to them
  const [adminUser] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, ADMIN_EMAIL))
    .limit(1);

  const [preferredSector] = await db
    .select()
    .from(schema.sectors)
    .where(eq(schema.sectors.isActive, true))
    .limit(1);

  // Upsert contact
  let [contact] = await db
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.phone, fixturePhone))
    .limit(1);

  if (!contact) {
    [contact] = await db
      .insert(schema.contacts)
      .values({
        phone: fixturePhone,
        name: fixtureName,
        email: 'e2e@smoke.test',
      })
      .returning();
  }

  // Upsert conversation (active, open, assigned to admin)
  let [conversation] = await db
    .select()
    .from(schema.conversations)
    .where(and(eq(schema.conversations.contactId, contact.id), eq(schema.conversations.isActive, true)))
    .limit(1);

  if (!conversation) {
    [conversation] = await db
      .insert(schema.conversations)
      .values({
        contactId: contact.id,
        status: 'open',
        statusV2: 'novo',
        interactionType: 'clinical',
        sectorId: preferredSector?.id,
        assignedUserId: adminUser?.id,
        isActive: true,
      })
      .returning();
  } else {
    // Ensure the conversation is assigned to admin and has a sector
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (conversation.assignedUserId !== adminUser?.id && adminUser?.id) updates.assignedUserId = adminUser.id;
    if (!conversation.sectorId && preferredSector?.id) updates.sectorId = preferredSector.id;
    if (Object.keys(updates).length > 1) {
      [conversation] = await db
        .update(schema.conversations)
        .set(updates)
        .where(eq(schema.conversations.id, conversation.id))
        .returning();
    }
  }

  // Add an inbound message so the conversation has content
  const existingMessage = await db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.conversationId, conversation.id), eq(schema.messages.direction, 'inbound')))
    .limit(1);

  if (existingMessage.length === 0) {
    await db.insert(schema.messages).values({
      conversationId: conversation.id,
      direction: 'inbound',
      content: 'Hello from E2E fixture',
      sender: fixturePhone,
      senderType: 'contact',
      recipient: 'bot',
      status: 'delivered',
      externalMessageId: `e2e-fixture-${randomUUID()}`,
      sentAt: new Date(),
      deliveredAt: new Date(),
    });
  }

  return { conversationId: conversation.id, contactId: contact.id };
}

export async function loginAsAdmin(page: Page): Promise<string> {
  await page.goto('/login');
  await page.getByPlaceholder('Email').fill(ADMIN_EMAIL);
  await page.getByPlaceholder('Senha').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/inbox');

  const sessionCookie = (await page.context().cookies()).find(cookie => cookie.name === 'cvg_session');
  if (!sessionCookie) {
    throw new Error('Login did not set the cvg_session cookie');
  }

  return sessionCookie.value;
}
