import { test, expect } from '@playwright/test';
import { loginAsAdmin, ADMIN_EMAIL } from './support.ts';

test.describe('Login Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('login page loads with correct elements', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('CVG Connect Desk');
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
    await loginAsAdmin(page);
    await expect(page.locator('.layout')).toBeVisible();
    await expect(page.getByText('Inbox')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Conversas/ })).toBeVisible();
  });

  test('login keeps the session out of localStorage and uses an HttpOnly cookie', async ({ page }) => {
    await loginAsAdmin(page);
    const authStorage = await page.evaluate(() => localStorage.getItem('auth-storage'));
    expect(authStorage).not.toBeNull();
    const parsed = JSON.parse(authStorage!);
    expect(parsed.state.token).toBeUndefined();
    expect(parsed.state.isAuthenticated).toBe(true);

    const sessionCookie = (await page.context().cookies()).find(cookie => cookie.name === 'cvg_session');
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.value).toBeTruthy();
    expect(ADMIN_EMAIL).toContain('@');
  });
});
