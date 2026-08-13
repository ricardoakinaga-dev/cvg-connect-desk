/**
 * Smoke Test — Send Message
 *
 * Tests the send message flow:
 * 1. Login as admin
 * 2. E2E fixture creates a stable contact + conversation + message
 * 3. Navigate to inbox with the conversation pre-selected
 * 4. Verify the conversation is loaded (chat area visible)
 * 5. Type a message in the composer
 * 6. Send it
 * 7. Confirm the message appears in the chat UI
 *
 * Required services: postgres, desk-api, desk-web (started by playwright webServer)
 * Prerequisite: fixture runs before test to create conversation data
 */

import { test, expect, type Page } from '@playwright/test';
import { loginAsAdmin, ensureE2EConversation } from './support.ts';

test.describe('Send Message Flow', () => {
  let conversationId: string;

  async function openFixtureConversation(page: Page) {
    // Wait for the real conversation list before selecting the fixture. The
    // inbox loads conversations asynchronously, so selecting by URL alone can
    // race the first query and leave the composer in its empty state.
    await page.goto('/inbox');
    await expect(page.locator('.conv-list-v2')).toBeVisible({ timeout: 15_000 });
    const fixtureContact = page.getByText('E2E Smoke Contact', { exact: true }).first();
    await expect(fixtureContact).toBeVisible({ timeout: 15_000 });
    await fixtureContact.click();
    await expect(page.locator('.composer-v2')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.header-name')).toBeVisible({ timeout: 5_000 });
  }

  test.beforeAll(async () => {
    // Create the E2E conversation fixture once before all tests in this describe
    const result = await ensureE2EConversation();
    conversationId = result.conversationId;
  });

  test('send message appears in chat UI', async ({ page }) => {
    // Login
    await loginAsAdmin(page);

    // Open the fixture conversation through the real inbox list
    await openFixtureConversation(page);
    await expect(page.locator('.layout')).toBeVisible({ timeout: 15_000 });

    // Type a test message — use pressSequentially for React onChange compatibility
    const testMessage = `E2E smoke test message ${Date.now()}`;
    const composerInput = page.locator('.composer-input-v2');
    await composerInput.click();
    await composerInput.pressSequentially(testMessage);

    // Verify the input has the text before sending
    await expect(composerInput).toHaveValue(testMessage);

    const sendResponse = page.waitForResponse(response => {
      return response.request().method() === 'POST'
        && response.url().endsWith('/messages')
        && response.status() === 201;
    });

    // Send the message (submit the composer form)
    await page.locator('.composer-send').click();
    await sendResponse;

    // Wait for the message to appear in the chat
    // The message should appear in the chat area with the text we sent
    await expect(page.locator('.chat-messages-v2')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.message.outbound').filter({ hasText: testMessage })).toBeVisible({ timeout: 10_000 });
  });

  test('composer input accepts text and clears after send', async ({ page }) => {
    await loginAsAdmin(page);
    await openFixtureConversation(page);
    await expect(page.locator('.layout')).toBeVisible({ timeout: 15_000 });

    const composerInput = page.locator('.composer-input-v2');

    // Fill the composer
    await composerInput.fill('Test message for composer');

    // Verify the input has the text
    await expect(composerInput).toHaveValue('Test message for composer');

    // Send
    await page.locator('.composer-send').click();

    // After send, the composer input should be cleared
    await expect(composerInput).toHaveValue('', { timeout: 10_000 });
  });

  test('send button is disabled when composer is empty', async ({ page }) => {
    await loginAsAdmin(page);
    await openFixtureConversation(page);
    await expect(page.locator('.layout')).toBeVisible({ timeout: 15_000 });

    const composerInput = page.locator('.composer-input-v2');
    const sendButton = page.locator('.composer-send');

    // Initially empty — send button shows REC (voice mode)
    await expect(composerInput).toHaveValue('');
    await expect(sendButton).toContainText('REC');

    // Type something — send button changes to ➤
    await composerInput.fill('Hello');
    await expect(sendButton).toContainText('➤');

    // Clear — back to REC
    await composerInput.clear();
    await expect(sendButton).toContainText('REC');
  });
});
