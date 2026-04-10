import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support';

test.describe('Inbox Authenticated Smoke', () => {
  test('inbox loads authenticated and renders shell markers', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/inbox');

    await expect(page.getByRole('heading', { name: /Conversas/ })).toBeVisible();
    await expect(page.locator('.inbox-sidebar')).toBeVisible();
    await expect(page.locator('.conv-list-v2')).toBeVisible();
    await expect(page.getByPlaceholder('🔍 Pesquisar conversas...')).toBeVisible();
    await expect(page.locator('.inbox-main')).toBeVisible();
    await expect(page.getByText('CVG Connect Desk')).toBeVisible();
  });
});
