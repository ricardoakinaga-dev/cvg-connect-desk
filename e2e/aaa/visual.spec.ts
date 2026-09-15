/**
 * AAA-22 — Matriz visual independente (DESIGN_QA / C09).
 *
 * Executa a stack isolada REAL do harness AAA-00 (API + PostgreSQL + Redis +
 * realtime + web) e captura:
 *  - normal: 16 rotas × 5 viewports (375×812, 390×844, 768×1024, 1024×768, 1440×900)
 *  - estados: loading, erro 500, forbidden 403, vazio aplicável em 1440 e 375
 *  - login: credenciais inválidas e loading
 *  - dashboard premium degradado (real) e premium OK (stub isolado)
 *  - conteúdo longo sob perfil `benchmark` (gate por AAA_FIXTURE_PROFILE)
 *
 * Falhas de API reais do candidato (ex.: /metrics/premium 500 e /notes 400)
 * são registradas na coluna `consoleErrors` da matriz, nunca escondidas.
 */
import { test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import {
  API_BASE,
  NORMAL_ROUTES,
  PROTECTED_ROUTES,
  ROUTES,
  STATE_VIEWPORTS,
  VIEWPORTS,
  PROFILE,
  WEB_BASE,
  appendResult,
  attachStateStubs,
  evidencePath,
  loginAndSaveState,
  matrixRowBase,
  newContext,
  probePage,
  runMetadata,
  screenshot,
  sleep,
  waitForApp,
  watchConsole,
  writeJson,
  type MatrixRow,
  type RouteSpec,
  type StateName,
  type ViewportSpec,
} from './aaa22-support';

const MATRIX_NORMAL = evidencePath('matrix-normal.json');
const MATRIX_STATES = evidencePath('matrix-states.json');
const MATRIX_LONG = evidencePath('matrix-long.json');

let statePath = '';

test.beforeAll(async ({ browser }) => {
  statePath = await loginAndSaveState(browser);
  writeJson(evidencePath('run-metadata-visual.json'), runMetadata());
});

async function captureStateCase(
  browser: Browser,
  matrixFile: string,
  state: StateName,
  viewport: ViewportSpec,
  route: RouteSpec,
  steps?: (page: Page) => Promise<void>,
): Promise<MatrixRow> {
  const row = matrixRowBase(state, route, viewport, false);
  const context = await newContext(browser, { viewport, statePath: route.auth ? statePath : undefined });
  const capture = { messages: [] as string[], pageErrors: [] as string[], failedRequests: [] as string[] };
  let page: Page | null = null;
  try {
    await attachStateStubs(context, state, route.name);
    page = await context.newPage();
    const watched = watchConsole(page);
    Object.assign(capture, watched);
    await page.goto(`${WEB_BASE}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await waitForApp(page, route, state);
    if (steps) await steps(page);
    row.probe = await probePage(page);
    row.screenshot = await screenshot(page, `${state}/${viewport.name}/${route.name}.png`);
    row.ok = true;
  } catch (error) {
    row.error = error instanceof Error ? error.message : String(error);
  }
  row.consoleErrors = [...capture.messages];
  row.pageErrors = [...capture.pageErrors];
  row.failedRequests = capture.failedRequests.filter((entry) => !entry.includes('ERR_ABORTED'));
  await context.close().catch(() => undefined);
  appendResult(matrixFile, row);
  return row;
}

test.describe('AAA-22 matriz visual normal', () => {
  test('16 rotas × 5 viewports (captura obrigatória)', async ({ browser }) => {
    // 80 isolated browser contexts are intentionally serial; on CI this can
    // exceed 20 minutes even when every page is healthy.
    test.setTimeout(1_800_000);
    let ok = 0;
    for (const viewport of VIEWPORTS) {
      for (const route of NORMAL_ROUTES) {
        const row = await captureStateCase(browser, MATRIX_NORMAL, 'normal', viewport, route);
        if (row.ok) ok += 1;
      }
    }
    writeJson(evidencePath('summary-normal.json'), { total: NORMAL_ROUTES.length * VIEWPORTS.length, ok });
    if (ok === 0) throw new Error('nenhuma captura normal concluída');
  });
});

for (const state of ['loading', 'error500', 'forbidden403', 'empty'] as StateName[]) {
  test.describe(`AAA-22 estados — ${state}`, () => {
    test(`${state}: rotas aplicáveis × 2 viewports`, async ({ browser }) => {
      test.setTimeout(1_200_000);
      const routes = state === 'empty'
        ? PROTECTED_ROUTES.filter((route) => route.empty)
        : PROTECTED_ROUTES;
      let ok = 0;
      for (const viewport of STATE_VIEWPORTS) {
        for (const route of routes) {
          const row = await captureStateCase(browser, MATRIX_STATES, state, viewport, route);
          if (row.ok) ok += 1;
        }
      }
      if (ok === 0) throw new Error(`nenhuma captura de estado ${state} concluída`);
    });
  });
}

test.describe('AAA-22 dashboard premium', () => {
  for (const viewport of STATE_VIEWPORTS) {
    test(`premium OK (stub isolado) @ ${viewport.name}`, async ({ browser }) => {
      test.setTimeout(180_000);
      const route = ROUTES.find((candidate) => candidate.name === 'dashboard')!;
      const row = await captureStateCase(browser, MATRIX_STATES, 'premium-ok', viewport, route);
      if (!row.ok) throw new Error(row.error || 'captura premium-ok falhou');
    });
  }
});

test.describe('AAA-22 login', () => {
  for (const viewport of STATE_VIEWPORTS) {
    test(`credenciais inválidas @ ${viewport.name}`, async ({ browser }) => {
      test.setTimeout(180_000);
      const route = ROUTES.find((candidate) => candidate.name === 'login')!;
      const context = await newContext(browser, { viewport });
      await context.route(`${API_BASE}/**`, (routeHandler) => {
        const request = routeHandler.request();
        if (new URL(request.url()).pathname !== '/auth/login') return routeHandler.continue();
        return routeHandler.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'INVALID_CREDENTIALS', message: 'E-mail ou senha inválidos.' }),
        });
      });
      const page = await context.newPage();
      const capture = watchConsole(page);
      const row = matrixRowBase('login-invalid', route, viewport, false);
      try {
        await page.goto(`${WEB_BASE}/login`, { waitUntil: 'domcontentloaded' });
        await page.fill('input[type="email"]', 'aaa-admin@cvg.test');
        await page.fill('input[type="password"]', 'senha-errada');
        await page.click('button[type="submit"]');
        await page.waitForSelector('[role="alert"]', { timeout: 20_000 });
        await sleep(300);
        row.probe = await probePage(page);
        row.screenshot = await screenshot(page, `login-invalid/${viewport.name}/login.png`);
        row.ok = true;
      } catch (error) {
        row.error = error instanceof Error ? error.message : String(error);
      }
      row.consoleErrors = capture.messages;
      row.pageErrors = capture.pageErrors;
      await context.close().catch(() => undefined);
      appendResult(MATRIX_STATES, row);
      if (!row.ok) throw new Error(row.error || 'login inválido falhou');
    });

    test(`loading de autenticação @ ${viewport.name}`, async ({ browser }) => {
      test.setTimeout(180_000);
      const route = ROUTES.find((candidate) => candidate.name === 'login')!;
      const context = await newContext(browser, { viewport });
      await context.route(`${API_BASE}/**`, async (routeHandler) => {
        if (new URL(routeHandler.request().url()).pathname !== '/auth/login') return routeHandler.continue();
        await sleep(3000);
        return routeHandler.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'INVALID_CREDENTIALS' }) });
      });
      const page = await context.newPage();
      const capture = watchConsole(page);
      const row = matrixRowBase('login-loading', route, viewport, false);
      try {
        await page.goto(`${WEB_BASE}/login`, { waitUntil: 'domcontentloaded' });
        await page.fill('input[type="email"]', 'aaa-admin@cvg.test');
        await page.fill('input[type="password"]', 'senha-qualquer');
        await page.click('button[type="submit"]');
        await sleep(500);
        row.probe = await probePage(page);
        row.screenshot = await screenshot(page, `login-loading/${viewport.name}/login.png`);
        row.ok = true;
      } catch (error) {
        row.error = error instanceof Error ? error.message : String(error);
      }
      row.consoleErrors = capture.messages;
      row.pageErrors = capture.pageErrors;
      await context.close().catch(() => undefined);
      appendResult(MATRIX_STATES, row);
      if (!row.ok) throw new Error(row.error || 'login loading falhou');
    });
  }
});

test.describe('AAA-22 conteúdo longo (perfil benchmark)', () => {
  const longRoutes = ['inbox', 'contacts', 'kanban', 'dashboard', 'admin'] as const;
  test.skip(PROFILE !== 'benchmark', 'Requer AAA_FIXTURE_PROFILE=benchmark (execução dedicada de conteúdo longo).');
  for (const viewport of STATE_VIEWPORTS) {
    test(`conteúdo longo @ ${viewport.name}`, async ({ browser }) => {
      test.setTimeout(600_000);
      for (const routeName of longRoutes) {
        const route = ROUTES.find((candidate) => candidate.name === routeName)!;
        const row = await captureStateCase(browser, MATRIX_LONG, 'long', viewport, route);
        if (routeName === 'inbox' && row.ok) {
          const context = await newContext(browser, { viewport, statePath });
          const page = await context.newPage();
          const capture = watchConsole(page);
          const convRow = matrixRowBase('long-conversation', route, viewport, false);
          try {
            await page.goto(`${WEB_BASE}/inbox`, { waitUntil: 'domcontentloaded' });
            await waitForApp(page, route, 'normal');
            const firstConversation = page.locator('.conv-list-v2 button, .conv-list-v2 [role="button"], .conv-item').first();
            await firstConversation.click({ timeout: 10_000 });
            await sleep(900);
            convRow.probe = await probePage(page);
            convRow.screenshot = await screenshot(page, `long/${viewport.name}/inbox-conversation.png`);
            convRow.ok = true;
          } catch (error) {
            convRow.error = error instanceof Error ? error.message : String(error);
          }
          convRow.consoleErrors = capture.messages;
          convRow.pageErrors = capture.pageErrors;
          await context.close().catch(() => undefined);
          appendResult(MATRIX_LONG, convRow);
        }
      }
    });
  }
});
