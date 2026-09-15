import { test, expect } from '@playwright/test';
import { getRunContext } from '../support/aaa/run-context.ts';
import { verifyMarker } from '../support/aaa/pg.ts';

const ctx = getRunContext();
const apiUrl = process.env.AAA_API_URL || `http://127.0.0.1:${ctx.ports.api}`;

test.describe('AAA-00 harness — sanidade da stack isolada', () => {
  test('API responde health na porta exclusiva do run', async ({ request }) => {
    const response = await request.get(`${apiUrl}/health`);
    expect(response.status()).toBe(200);
  });

  test('banco em uso carrega marcador de teste do run', () => {
    const marker = verifyMarker(ctx);
    expect(marker.runId).toBe(ctx.runId);
    expect(ctx.databaseName).toMatch(/^cvg_aaa_/);
  });

  test('web /login renderiza formulario', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('form')).toBeVisible();
    await expect(page.locator('input').first()).toBeVisible();
  });
});
