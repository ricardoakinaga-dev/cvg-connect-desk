/**
 * AAA-22 — configuração equivalente à do harness AAA-00.
 *
 * Motivo: `playwright.aaa.config.ts` (harness AAA-00, fora da escrita desta
 * tarefa) importa `e2e/support/aaa/run-context.ts`, que usa `import.meta.url`.
 * No Node 24 o carregador interno do Playwright transforma esse .ts para CJS e
 * o `import.meta` remanescente quebra antes de qualquer teste rodar
 * ("exports is not defined in ES module scope"). Este arquivo reproduz a mesma
 * configuração (mesmos defaults de porta, mesmo webServer
 * `e2e/support/aaa/start-aaa-stack.ts`, mesmos projetos) sem importar o módulo
 * problemático, para que o check declarado possa ser executado de verdade.
 * Nenhuma outra diferença de comportamento.
 *
 * Uso (equivalente ao check declarado):
 *   pnpm exec playwright test e2e/aaa/accessibility.spec.ts e2e/aaa/visual.spec.ts \
 *     --config e2e/aaa/aaa22.playwright.config.mjs
 */
import { defineConfig, devices } from '@playwright/test';
import { join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const runtimeDir = join(repoRoot, 'docs', 'execucao-aaa-2026-09-12', 'runtime');
const visualDir = join(runtimeDir, 'visual');

function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`${name} invalido: "${raw}" (esperado porta 1-65535).`);
  }
  return value;
}

const runId = (process.env.AAA_RUN_ID || 'aaa-20260912')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 40);
const runRoot = process.env.AAA_RUN_ROOT || join('/tmp', 'cvg-aaa-runs', runId);

const ports = {
  postgres: envInt('AAA_PG_PORT', 56432),
  redis: envInt('AAA_REDIS_PORT', 56680),
  api: envInt('AAA_API_PORT', 4630),
  realtime: envInt('AAA_REALTIME_PORT', 4931),
  web: envInt('AAA_WEB_PORT', 4373),
  evolutionMock: envInt('AAA_EVOLUTION_MOCK_PORT', 8083),
};

const webBaseUrl = process.env.AAA_WEB_URL || `http://127.0.0.1:${ports.web}`;
const artifactDir = process.env.AAA22_OUTPUT_DIR || join(visualDir, 'playwright-output');

export default defineConfig({
  testDir: here,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: Number(process.env.AAA_WORKERS || 1),
  reporter: [
    ['list'],
    ['json', { outputFile: process.env.AAA_PLAYWRIGHT_JSON || join(visualDir, 'harness', 'last-report.json') }],
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
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      AAA_RUN_ID: runId,
      AAA_RUN_ROOT: runRoot,
      AAA_PG_PORT: String(ports.postgres),
      AAA_REDIS_PORT: String(ports.redis),
      AAA_API_PORT: String(ports.api),
      AAA_REALTIME_PORT: String(ports.realtime),
      AAA_WEB_PORT: String(ports.web),
      AAA_EVOLUTION_MOCK_PORT: String(ports.evolutionMock),
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
