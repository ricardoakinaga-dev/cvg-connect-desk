import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';
import { getRunContext } from './e2e/support/aaa/run-context.ts';

const ctx = getRunContext();
const webBaseUrl = process.env.AAA_WEB_URL || `http://127.0.0.1:${ctx.ports.web}`;
const artifactDir = join(ctx.runtimeDir, 'harness', 'playwright-artifacts');

export default defineConfig({
  testDir: './e2e/aaa',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: Number(process.env.AAA_WORKERS || 1),
  reporter: [['list'], ['json', { outputFile: process.env.AAA_PLAYWRIGHT_JSON || join(ctx.runtimeDir, 'harness', 'last-report.json') }]],
  outputDir: artifactDir,
  timeout: 90_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: webBaseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  webServer: {
    command: 'pnpm exec tsx e2e/support/aaa/start-aaa-stack.ts',
    url: `${webBaseUrl}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      AAA_RUN_ID: ctx.runId,
      AAA_RUN_ROOT: ctx.runRoot,
      AAA_PG_PORT: String(ctx.ports.postgres),
      AAA_REDIS_PORT: String(ctx.ports.redis),
      AAA_API_PORT: String(ctx.ports.api),
      AAA_REALTIME_PORT: String(ctx.ports.realtime),
      AAA_WEB_PORT: String(ctx.ports.web),
      AAA_EVOLUTION_MOCK_PORT: String(ctx.ports.evolutionMock),
    },
  },

  projects: [
    {
      name: 'aaa',
      testIgnore: ['**/*.canary.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'canary',
      testMatch: ['**/*.canary.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
