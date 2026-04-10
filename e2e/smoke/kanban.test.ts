import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support';

test.describe('Kanban Smoke', () => {
  test('kanban opens and renders the board shell', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/kanban');

    await expect(page.getByRole('heading', { name: /Kanban/ })).toBeVisible();
    await expect(page.locator('.kanban-header')).toBeVisible();
    await expect(page.locator('.kanban-board')).toBeVisible();
    await expect(page.locator('select')).toBeVisible();
    await expect(page.getByRole('button', { name: '🔄' })).toBeVisible();
  });
});
