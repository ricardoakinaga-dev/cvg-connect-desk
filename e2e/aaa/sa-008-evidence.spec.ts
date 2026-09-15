/**
 * SA-008 — captura de evidência visual (navegador real) do contexto de conversa.
 * Produz screenshots identificados com rota/estado/viewport em
 * `evidencias/SA-008/screenshots/` para inspeção humana e revisão independente.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURE_IDS, FIXTURE_PASSWORDS } from '../support/aaa/fixtures.ts';

const SHOTS_DIR = process.env.AAA_SA008_SHOTS
  || join(process.cwd(), 'docs', 'programa-triplo-aaa-2026-09-14', 'evidencias', 'SA-008', 'screenshots');
mkdirSync(SHOTS_DIR, { recursive: true });

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill('aaa-admin@cvg.test');
  await page.locator('input[type="password"]').fill(FIXTURE_PASSWORDS.admin);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

test.describe('SA-008 — evidência visual', () => {
  test('captura desktop e móvel com contexto selecionado e negativos', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    // Inbox com conversa A selecionada e painel de contexto aberto.
    await page.goto('/inbox');
    await page.locator('.conv-row').filter({ hasText: '[fixture] inbound A1' }).first().click();
    await page.getByRole('button', { name: 'Abrir informações da conversa' }).click();
    await expect(page.getByRole('complementary', { name: 'Contexto da conversa' })).toBeVisible();
    await page.screenshot({ path: join(SHOTS_DIR, 'sa-008-inbox-contexto-desktop-1440.png'), fullPage: true });

    // Tarefas contextuais (filtro visível + dados de A).
    await page.goto(`/tasks?conversationId=${FIXTURE_IDS.conversationA}`);
    await expect(page.getByText('Mostrando apenas as tarefas da conversa selecionada.')).toBeVisible();
    await page.screenshot({ path: join(SHOTS_DIR, 'sa-008-tarefas-contexto-desktop-1440.png'), fullPage: true });

    // Notas contextuais em viewport móvel.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/notes?conversationId=${FIXTURE_IDS.conversationA}`);
    await expect(page.getByText('Mostrando apenas as notas da conversa selecionada.')).toBeVisible();
    await page.screenshot({ path: join(SHOTS_DIR, 'sa-008-notas-contexto-mobile-390.png'), fullPage: true });

    // Negativo: contexto inexistente.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/tasks?conversationId=99999999-9999-4999-8999-999999999999');
    await expect(page.getByText('Contexto inacessível')).toBeVisible();
    await page.screenshot({ path: join(SHOTS_DIR, 'sa-008-contexto-inacessivel-desktop-1440.png'), fullPage: true });
  });
});
