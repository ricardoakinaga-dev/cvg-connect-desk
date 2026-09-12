import { expect, type Page } from '@playwright/test';
import { db, schema } from '@cvg/database';
import { eq, and } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';

export const ADMIN_EMAIL = process.env.ADMIN_BOOTSTRAP_EMAIL || 'admin@cvg.com';
export const ADMIN_PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || 'admin123';
let cachedAdminAuthStorage: string | null = null;

type AuthStorageState = {
  state: {
    token: string;
    user: {
      id: string;
      email: string;
      name: string;
      roles: string[];
    };
    isAuthenticated: boolean;
  };
  version: number;
};

async function seedAdminSession(): Promise<string> {
  const [adminUser] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, ADMIN_EMAIL))
    .limit(1);

  if (!adminUser) {
    throw new Error(`Admin user ${ADMIN_EMAIL} not found`);
  }

  const userRoles = await db
    .select({ roleId: schema.userRoles.roleId, roleName: schema.roles.name })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(eq(schema.userRoles.userId, adminUser.id));

  const token = randomUUID();
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
  await db.insert(schema.sessions).values({
    userId: adminUser.id,
    token: tokenHash,
    tokenHash,
    lastSeenAt: new Date(),
    absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  const authStorage: AuthStorageState = {
    state: {
      token,
      user: {
        id: adminUser.id,
        email: adminUser.email,
        name: adminUser.name,
        roles: userRoles.map(role => role.roleName),
      },
      isAuthenticated: true,
    },
    version: 0,
  };

  return JSON.stringify(authStorage);
}

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
    if (!conversation.assignedUserId && adminUser?.id) updates.assignedUserId = adminUser.id;
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

export async function loginAsAdmin(page: Page) {
  if (cachedAdminAuthStorage) {
    await page.addInitScript(storage => {
      localStorage.setItem('auth-storage', storage);
    }, cachedAdminAuthStorage);
    return cachedAdminAuthStorage;
  }

  cachedAdminAuthStorage = await seedAdminSession();
  await page.addInitScript(storage => {
    localStorage.setItem('auth-storage', storage);
  }, cachedAdminAuthStorage);
  return cachedAdminAuthStorage;
}
