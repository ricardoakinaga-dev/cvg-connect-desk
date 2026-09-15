import { expect, test } from '@playwright/test';
import { runIdentity } from '../support/production/spec-helpers.mjs';

/**
 * Suite production 01 — identidade e isolamento do run em execução real.
 * Prova que web/API/marcador de banco pertencem ao MESMO run isolado e ao
 * mesmo candidato (HEAD), sem reutilizar servidor alheio.
 */
test.describe('PROD produção — identidade do run isolado', () => {
  test('marcador de banco pertence ao run e ao HEAD atual', async () => {
    const identity = await runIdentity();
    expect(identity.markerRunId).toBe(identity.runId);
    expect(identity.markerRevision).toBe(identity.head);
  });

  test('web /login renderiza no host/porta do run', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('form')).toBeVisible();
    expect(page.url()).toContain(`127.0.0.1:${(await runIdentity()).ports.web}`);
  });

  test('API /health do run responde', async ({ request }) => {
    const identity = await runIdentity();
    const response = await request.get(`http://127.0.0.1:${identity.ports.api}/health`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toBeTruthy();
  });
});
