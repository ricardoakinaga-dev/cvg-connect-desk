import { defineConfig, devices } from '@playwright/test';

const webBaseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4173';

/**
 * Playwright E2E Configuration — CVG Connect Desk
 *
 * Minimal smoke setup for the critical browser flows.
 */

export default defineConfig({
  testDir: './e2e/smoke',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['list'], ['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : 'list',
  timeout: 60_000,

  use: {
    baseURL: webBaseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  webServer: {
    command: 'DATABASE_URL=postgresql://connect_desk:root@localhost:55432/connect_desk_db REDIS_URL=redis://localhost:56379 PORT=4330 REALTIME_PORT=4930 VITE_API_URL=http://localhost:4330 VITE_REALTIME_URL=ws://localhost:4930 pnpm exec tsx e2e/support/start-e2e-stack.ts',
    url: `${webBaseUrl}/login`,
    reuseExistingServer: !process.env.CI,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    timeout: 180_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
