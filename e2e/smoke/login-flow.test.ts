import { test, expect } from '@playwright/test';
import { loginAsAdmin, ADMIN_EMAIL } from './support';

test.describe('Login Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('login page loads with correct elements', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Bem-vindo ao plantão.' })).toBeVisible();
    await expect(page.getByLabel('CVG Connect Desk')).toBeVisible();
    await expect(page.getByPlaceholder('Email')).toBeVisible();
    await expect(page.getByPlaceholder('Senha')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  });

  test('shows error on invalid credentials', async ({ page }) => {
    await page.getByPlaceholder('Email').fill('wrong@email.com');
    await page.getByPlaceholder('Senha').fill('wrongpassword');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.locator('.login-error')).toBeVisible({ timeout: 10_000 });
  });

  test('successful login redirects to inbox', async ({ page }) => {
    const authStorage = await loginAsAdmin(page);
    expect(authStorage).toContain(ADMIN_EMAIL);
    await page.goto('/inbox');
    await expect(page.locator('.layout')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Inbox', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Conversas/ })).toBeVisible();
  });

  test('login stores auth token in localStorage', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/inbox');
    const authStorage = await page.evaluate(() => localStorage.getItem('auth-storage'));
    expect(authStorage).not.toBeNull();
    const parsed = JSON.parse(authStorage!);
    expect(parsed.state.token).toBeTruthy();
    expect(parsed.state.isAuthenticated).toBe(true);
  });
});
