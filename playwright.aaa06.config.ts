import { defineConfig } from '@playwright/test';

/**
 * Harness auto-contido de AAA-06 (C08-AAA06), versionado com caminhos relativos.
 * Sem webServer: o próprio spec sobe TLS local + mock WebSocket efêmero.
 *
 * Comando exato:
 *   pnpm exec playwright test -c playwright.aaa06.config.ts e2e/smoke/aaa-06-remote.spec.ts
 */
export default defineConfig({
  testDir: './e2e/smoke',
  testMatch: 'aaa-06-remote.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  outputDir: './test-results/aaa-06',
  use: {
    ignoreHTTPSErrors: true,
  },
});
