import { defineConfig, devices } from '@playwright/test';

const webBaseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4173';
const e2ePostgresPort = process.env.E2E_POSTGRES_PORT || '55432';
const e2eRedisPort = process.env.E2E_REDIS_PORT || '56379';

/**
 * Playwright E2E Configuration — CVG Connect Desk
 *
 * Minimal smoke setup for the critical browser flows.
 */

export default defineConfig({
  testDir: './e2e/smoke',
  testMatch: '**/*.test.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,

  use: {
    baseURL: webBaseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  webServer: {
    command: `DATABASE_URL=postgresql://connect_desk:root@localhost:${e2ePostgresPort}/connect_desk_db REDIS_URL=redis://localhost:${e2eRedisPort} E2E_POSTGRES_PORT=${e2ePostgresPort} E2E_REDIS_PORT=${e2eRedisPort} PORT=4330 REALTIME_PORT=4930 VITE_API_URL=http://localhost:4330 VITE_REALTIME_URL=ws://localhost:4930 INTERNAL_EVENTS_SECRET=e2e-internal-events-secret SEED_ADMIN_EMAIL=e2e-admin@cvg.test SEED_ADMIN_PASSWORD=E2eSmokePass!2026 pnpm exec tsx e2e/support/start-e2e-stack.ts`,
    url: `${webBaseUrl}/login`,
    reuseExistingServer: true,
    timeout: 180_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
