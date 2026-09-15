import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';
import { getRunContext } from './e2e/support/aaa/run-context.ts';

/**
 * Configuracao do programa de producao (docs/producao-2026-09-13).
 * Inclui as suites AAA existentes e as novas suites de producao em e2e/production.
 * Executar com NODE_OPTIONS=--import tsx (loader TS unificado do repo); sem isso
 * o loader CJS do Playwright conflita com o type-stripping do Node 24.
 */
const ctx = getRunContext();
const webBaseUrl = process.env.AAA_WEB_URL || `http://127.0.0.1:${ctx.ports.web}`;
const artifactDir = join(ctx.runtimeDir, 'harness', 'playwright-artifacts');

export default defineConfig({
  testDir: './e2e',
  testMatch: ['aaa/**/*.spec.ts', 'production/**/*.spec.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: Number(process.env.AAA_WORKERS || 1),
  reporter: [
    ['list'],
    ['json', { outputFile: process.env.AAA_PLAYWRIGHT_JSON || join(ctx.runtimeDir, 'harness', 'production-report.json') }],
  ],
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
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      AAA_RUN_ID: ctx.runId,
      AAA_RUN_ROOT: ctx.runRoot,
      CVG_PROGRAM_DIR: process.env.CVG_PROGRAM_DIR || '',
      CVG_RUNTIME_DIR: process.env.CVG_RUNTIME_DIR || '',
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
      testMatch: ['aaa/**/*.spec.ts'],
      testIgnore: ['**/*.canary.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'production',
      testMatch: ['production/**/*.spec.ts'],
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
