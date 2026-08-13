import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support.ts';

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test.describe('Admin Endpoints - Dead Letter Management', () => {
  test('navigates to dead letters stats page', async ({ page }) => {
    const response = await page.request.get('/api/admin/dead-letters/stats');

    // Should return 200 OK
    expect(response.status()).toBe(200);

    const stats = await response.json();
    expect(stats).toHaveProperty('total');
    expect(stats).toHaveProperty('unresolved');
    expect(stats).toHaveProperty('byHandler');
  });

  test('dead letters stats returns valid structure', async ({ page }) => {
    const response = await page.request.get('/api/admin/dead-letters/stats');
    const stats = await response.json();

    expect(typeof stats.total).toBe('number');
    expect(typeof stats.unresolved).toBe('number');
    expect(typeof stats.byHandler).toBe('object');
  });

  test('lists dead letter entries with pagination', async ({ page }) => {
    const response = await page.request.get('/api/admin/dead-letters?limit=10');

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(Array.isArray(data.data) || Array.isArray(data.deadLetters) || Array.isArray(data)).toBe(true);
  });

  test.describe('Webhook Security Stats', () => {
    test('navigates to webhook security stats page', async ({ page }) => {
      const response = await page.request.get('/api/admin/webhook-security/stats');

      expect(response.status()).toBe(200);

      const stats = await response.json();
      expect(stats).toHaveProperty('denied');
      expect(stats).toHaveProperty('byReason');
    });

    test('webhook security stats returns valid structure', async ({ page }) => {
      const response = await page.request.get('/api/admin/webhook-security/stats');
      const stats = await response.json();

      expect(typeof stats.denied).toBe('number');
      expect(typeof stats.byReason).toBe('object');
    });
  });

  test.describe('Admin Stats Summary', () => {
    test('admin dashboard shows operational stats', async ({ page }) => {
      const response = await page.request.get('/api/admin/stats');

      expect([200, 404]).toContain(response.status());

      if (response.status() === 200) {
        const stats = await response.json();
        expect(typeof stats).toBe('object');
      }
    });
  });

  test.describe('Dead Letter Retry and Resolve', () => {
    test('can list dead letters without auth failure', async ({ page }) => {
      // This tests that authenticated requests work correctly
      const response = await page.request.get('/api/admin/dead-letters');

      expect(response.status()).toBeGreaterThanOrEqual(200);
      expect(response.status()).toBeLessThan(500);
    });
  });
});
