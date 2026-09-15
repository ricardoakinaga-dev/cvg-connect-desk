/**
 * AAA-22 — Suporte compartilhado das specs independentes de acessibilidade e
 * visual (DESIGN_QA / C09). Não altera o harness AAA-00: apenas consome a stack
 * isolada real iniciada por `playwright.aaa.config.ts`
 * (`e2e/support/aaa/start-aaa-stack.ts`) com o perfil de fixture informado.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';
import type { Browser, BrowserContext, Page, Route } from '@playwright/test';
import { getRunContext, RUNTIME_DIR } from '../support/aaa/run-context.ts';

const RUN_CONTEXT = getRunContext();

// Defaults must come from the same isolated run context as the Playwright
// config. Fixed ports here made AAA-22 silently target a stale/nonexistent
// service (historically 4403/4660) even after AAA-00 had booted 4373/4630.
export const WEB_BASE = process.env.AAA_WEB_URL || `http://127.0.0.1:${RUN_CONTEXT.ports.web}`;
export const API_BASE = process.env.AAA_API_URL || `http://127.0.0.1:${RUN_CONTEXT.ports.api}`;
export const RUN_ROOT = process.env.AAA_RUN_ROOT || RUN_CONTEXT.runRoot;
export const EVIDENCE_DIR = process.env.AAA22_EVIDENCE
  || join(RUNTIME_DIR, 'visual');
export const AUTH_STATE_PATH = join(RUN_ROOT, 'auth-admin.json');
export const PROFILE = process.env.AAA_FIXTURE_PROFILE || 'minimal';

export const FIXTURE_USER = {
  email: process.env.AAA_FIXTURE_EMAIL || 'aaa-admin@cvg.test',
  password: process.env.AAA_FIXTURE_PASSWORD || 'aaa-admin-password',
};

export interface ViewportSpec {
  name: string;
  width: number;
  height: number;
}

export const VIEWPORTS: ViewportSpec[] = [
  { name: '375x812', width: 375, height: 812 },
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1440x900', width: 1440, height: 900 },
];

export const STATE_VIEWPORTS: ViewportSpec[] = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '375x812', width: 375, height: 812 },
];

export interface RouteSpec {
  path: string;
  name: string;
  auth: boolean;
  /** Estados aplicáveis e motivo de N/A documentado no manifesto. */
  empty: boolean;
  notes?: string;
}

export const ROUTES: RouteSpec[] = [
  { path: '/login', name: 'login', auth: false, empty: false, notes: 'Rota pública; estados loading/erro próprios (credenciais).' },
  { path: '/inbox', name: 'inbox', auth: true, empty: true },
  { path: '/contacts', name: 'contacts', auth: true, empty: true },
  { path: '/tutors', name: 'tutors', auth: true, empty: true },
  { path: '/patients', name: 'patients', auth: true, empty: true },
  { path: '/kanban', name: 'kanban', auth: true, empty: true },
  { path: '/tasks', name: 'tasks', auth: true, empty: true },
  { path: '/notes', name: 'notes', auth: true, empty: true },
  { path: '/alerts', name: 'alerts', auth: true, empty: true },
  { path: '/dashboard', name: 'dashboard', auth: true, empty: true },
  { path: '/sectors', name: 'sectors', auth: true, empty: true },
  { path: '/labels', name: 'labels', auth: true, empty: true },
  { path: '/contact-groups', name: 'contact-groups', auth: true, empty: true },
  { path: '/admin', name: 'admin', auth: true, empty: true },
  { path: '/audit', name: 'audit', auth: true, empty: true },
  { path: '/settings', name: 'settings', auth: true, empty: false, notes: 'Página de perfil/segurança; sem coleção vazia aplicável.' },
];

export const PROTECTED_ROUTES = ROUTES.filter((route) => route.auth);
export const NORMAL_ROUTES = ROUTES;

export function evidencePath(...parts: string[]): string {
  const target = join(EVIDENCE_DIR, ...parts);
  mkdirSync(dirname(target), { recursive: true });
  return target;
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function appendResult(file: string, row: unknown): void {
  const rows = readJson<unknown[]>(file) || [];
  rows.push(row);
  writeJson(file, rows);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ConsoleCapture {
  messages: string[];
  pageErrors: string[];
  failedRequests: string[];
}

export function watchConsole(page: Page): ConsoleCapture {
  const capture: ConsoleCapture = { messages: [], pageErrors: [], failedRequests: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') capture.messages.push(message.text());
  });
  page.on('pageerror', (error) => capture.pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    capture.failedRequests.push(`${request.method()} ${request.url()} :: ${failure?.errorText || 'unknown'}`);
  });
  return capture;
}

/** Login real pela UI uma vez; o storageState resultante alimenta a matriz. */
export async function loginAndSaveState(browser: Browser): Promise<string> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${WEB_BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', FIXTURE_USER.email);
  await page.fill('input[type="password"]', FIXTURE_USER.password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/inbox', { timeout: 30_000 });
  await page.waitForFunction(
    () => (window.localStorage.getItem('auth-storage') || '').includes('"isAuthenticated":true'),
    undefined,
    { timeout: 15_000 },
  );
  const state = await context.storageState();
  writeJson(AUTH_STATE_PATH, state);
  await context.close();
  return AUTH_STATE_PATH;
}

export interface ContextOptions {
  viewport: ViewportSpec;
  statePath?: string;
  reducedMotion?: 'reduce' | 'no-preference';
  locale?: string;
}

export async function newContext(browser: Browser, options: ContextOptions): Promise<BrowserContext> {
  return await browser.newContext({
    viewport: { width: options.viewport.width, height: options.viewport.height },
    deviceScaleFactor: 1,
    reducedMotion: options.reducedMotion,
    locale: options.locale,
    storageState: options.statePath,
  });
}

export const EMPTY_BODIES = {
  inbox: [{ path: '/conversations', body: { items: [], conversations: [], nextCursor: null } }],
  contacts: [{ path: '/contacts', body: [] }],
  tutors: [{ path: '/tutors', body: [] }],
  patients: [{ path: '/patients', body: [] }],
  kanban: [{ path: '/kanban/board', body: { columns: [], filters: { sectors: [], labels: [] } } }],
  tasks: [{ path: '/tasks', body: [] }],
  notes: [{ path: '/notes', body: [] }],
  alerts: [{ path: '/alerts', body: [] }],
  dashboard: [{
    path: '/metrics/summary',
    body: {
      conversations: { open: 0, pending: 0, closed: 0, archived: 0, total: 0 },
      tasks: { total: 0, pending: 0, inProgress: 0, completed: 0, cancelled: 0, overdue: 0 },
      alerts: { total: 0, active: 0, acknowledged: 0, resolved: 0, bySeverity: { info: 0, warning: 0, error: 0, critical: 0 } },
      generatedAt: '2026-09-13T00:00:00.000Z',
    },
  }],
  sectors: [{ path: '/sectors', body: [] }],
  labels: [{ path: '/labels', body: [] }],
  'contact-groups': [{ path: '/contact-groups', body: [] }],
  admin: [
    { path: '/admin/users', body: [] },
    { path: '/admin/roles', body: [] },
    { path: '/admin/queues', body: [] },
    { path: '/admin/teams', body: [] },
    { path: '/sectors', body: [] },
  ],
  audit: [{ path: '/audit/logs', body: [] }],
} as const;

export const PREMIUM_OK_BODY = {
  responseTime: { avgFirstResponseTime: 42, avgResponseTime: 65, totalConversationsWithResponse: 30 },
  handoff: { totalHandoffs: 4, totalConversations: 57, handoffRate: 7.02 },
  sectorBacklog: [{ sectorId: 's1', sectorName: 'Recepção', openConversations: 5, pendingConversations: 1, totalBacklog: 6 }],
  agingConversations: [],
  alertsByCriticality: { critical: 2, error: 2, warning: 3, info: 2 },
};

export type StateName = 'normal' | 'loading' | 'error500' | 'forbidden403' | 'empty' | 'premium-ok';

export const LOADING_DELAY_MS = 4000;

function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

/** Intercepta apenas o origin da API; assets e WebSocket permanecem reais. */
export async function attachStateStubs(context: BrowserContext, state: StateName, routeName: string): Promise<void> {
  if (state === 'normal') return;
  const pattern = `${API_BASE}/**`;

  if (state === 'loading') {
    await context.route(pattern, async (route) => {
      await sleep(LOADING_DELAY_MS);
      await route.continue().catch(() => undefined);
    });
    return;
  }

  if (state === 'error500') {
    await context.route(pattern, (route) => fulfillJson(route, 500, {
      error: 'INTERNAL_ERROR',
      message: 'Falha simulada 500 (AAA-22)',
    }));
    return;
  }

  if (state === 'forbidden403') {
    await context.route(pattern, (route) => fulfillJson(route, 403, {
      error: 'FORBIDDEN',
      message: 'Acesso negado simulado (AAA-22)',
    }));
    return;
  }

  if (state === 'premium-ok') {
    await context.route(pattern, (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/metrics/premium') return fulfillJson(route, 200, PREMIUM_OK_BODY);
      return route.continue();
    });
    return;
  }

  const stubs = (EMPTY_BODIES as Record<string, ReadonlyArray<{ path: string; body: unknown }>>)[routeName] || [];
  await context.route(pattern, (route) => {
    const path = new URL(route.request().url()).pathname;
    const stub = stubs.find((candidate) => path === candidate.path);
    if (stub) return fulfillJson(route, 200, stub.body);
    return route.continue();
  });
}

/** Aguarda o shell e o cliente de tempo real estabilizarem (evita "Reconectando" na captura). */
export async function waitForShellReady(page: Page, timeoutMs = 15_000): Promise<boolean> {
  try {
    await page.waitForFunction(() => {
      const targets = Array.from(document.querySelectorAll('.system-presence, .topbar-status'));
      if (!targets.length) return true;
      return targets.some((target) => /Central conectada|Conectado|Conectando|Reconectando|Central instável|Tempo real inativo/.test(target.textContent || '')
        || /offline|Offline|indisponível|desconectado/i.test(target.textContent || ''));
    }, undefined, { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

export async function waitForApp(page: Page, route: RouteSpec, state: StateName): Promise<void> {
  if (route.name === 'login') {
    await page.waitForSelector('form', { timeout: 15_000 });
    return;
  }
  if (state === 'loading') {
    await page.waitForLoadState('domcontentloaded');
    await sleep(500);
    return;
  }
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await waitForShellReady(page);
  await sleep(600);
}

export interface PageProbe {
  url: string;
  title: string;
  h1: string | null;
  headings: string[];
  alerts: string[];
  statuses: string[];
  spinners: number;
  retryButtons: string[];
  unnamedControls: number;
  interactiveCount: number;
  overflowX: boolean;
  scrollWidth: number;
  clientWidth: number;
  docHeight: number;
  realtime: string | null;
  htmlLang: string;
  bodyText: string;
}

/** Fatos objetivos coletados na página real (sem heurística de nota visual). */
export async function probePage(page: Page): Promise<PageProbe> {
  return await page.evaluate(() => {
    const text = (el: Element | null) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 220) : null);
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const name = (el: Element) => (
      el.getAttribute('aria-label')
      || (el.getAttribute('aria-labelledby')
        ? el.getAttribute('aria-labelledby')!.split(/\s+/).map((id) => text(document.getElementById(id))).filter(Boolean).join(' ')
        : '')
      || el.textContent
      || el.getAttribute('title')
      || el.getAttribute('placeholder')
      || el.getAttribute('alt')
      || (el as HTMLInputElement).value
      || ''
    ).replace(/\s+/g, ' ').trim();

    const interactive = Array.from(document.querySelectorAll('a,button,input,select,textarea,[role="button"],[role="checkbox"],[role="switch"]'))
      .filter(visible);
    const unnamedControls = interactive.filter((el) => {
      if ((el as HTMLInputElement).type === 'hidden') return false;
      return !name(el);
    }).length;

    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
      .filter(visible)
      .map((heading) => `${heading.tagName}:${text(heading)}`)
      .slice(0, 8);

    const realtimeEl = document.querySelector('.system-presence, .topbar-status');
    const root = document.documentElement;

    return {
      url: location.pathname + location.search,
      title: document.title,
      h1: text(document.querySelector('h1')),
      headings,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).filter(visible).map(text).filter(Boolean) as string[],
      statuses: Array.from(document.querySelectorAll('[role="status"]')).filter(visible).map(text).filter(Boolean) as string[],
      spinners: document.querySelectorAll('.ui-spinner, .spinner, .btn-spinner').length,
      retryButtons: Array.from(document.querySelectorAll('button'))
        .filter(visible)
        .filter((button) => /tentar novamente|recarregar|tentar de novo|carregar novamente/i.test(button.textContent || ''))
        .map(text).filter(Boolean) as string[],
      unnamedControls,
      interactiveCount: interactive.length,
      overflowX: root.scrollWidth > root.clientWidth + 1,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      docHeight: root.scrollHeight,
      realtime: realtimeEl ? text(realtimeEl) : null,
      htmlLang: root.getAttribute('lang') || '',
      bodyText: text(document.body).slice(0, 240),
    };
  });
}

export async function screenshot(page: Page, relativePath: string, fullPage = false): Promise<string> {
  const target = evidencePath('shots', relativePath);
  await page.screenshot({ path: target, fullPage, animations: 'disabled' });
  return target;
}

export interface MatrixRow {
  state: string;
  route: string;
  path: string;
  viewport: string;
  dpr: number;
  profile: string;
  ok: boolean;
  probe?: PageProbe;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  screenshot: string | null;
  error?: string;
  at: string;
}

export function matrixRowBase(state: string, route: RouteSpec, viewport: ViewportSpec, ok: boolean): MatrixRow {
  return {
    state,
    route: route.name,
    path: route.path,
    viewport: viewport.name,
    dpr: 1,
    profile: PROFILE,
    ok,
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    screenshot: null,
    at: new Date().toISOString(),
  };
}

export function runMetadata(): Record<string, unknown> {
  return {
    task: 'AAA-22',
    generatedAt: new Date().toISOString(),
    webBase: WEB_BASE,
    apiBase: API_BASE,
    fixtureProfile: PROFILE,
    runRoot: RUN_ROOT,
    evidenceDir: EVIDENCE_DIR,
    node: process.version,
    axeVersion: '4.13.0 (vendorizado em e2e/aaa/vendor/axe.min.js)',
    viewports: VIEWPORTS.map((viewport) => viewport.name),
  };
}

export interface DecodedPng {
  width: number;
  height: number;
  bpp: number;
  data: Buffer;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Decodifica PNG 8-bit não entrelaçado (RGB/RGBA/cinza) sem dependências externas. */
export function decodePng(buffer: Buffer): DecodedPng {
  if (buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG inválido');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error(`PNG não suportado (bitDepth=${bitDepth}, interlace=${interlace})`);
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const rowStart = y * stride;
    const prevStart = rowStart - stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[pos];
      pos += 1;
      const a = x >= bpp ? out[rowStart + x - bpp] : 0;
      const b = y > 0 ? out[prevStart + x] : 0;
      const c = y > 0 && x >= bpp ? out[prevStart + x - bpp] : 0;
      let result: number;
      if (filter === 0) result = value;
      else if (filter === 1) result = value + a;
      else if (filter === 2) result = value + b;
      else if (filter === 3) result = value + ((a + b) >> 1);
      else if (filter === 4) result = value + paeth(a, b, c);
      else throw new Error(`filtro PNG desconhecido ${filter}`);
      out[rowStart + x] = result & 0xff;
    }
  }
  return { width, height, bpp, data: out };
}

export interface RegionAverage {
  r: number;
  g: number;
  b: number;
  samples: number;
}

/** Média RGB de uma região (passo de amostragem para limitar custo). */
export function averageRegion(image: DecodedPng, x: number, y: number, width: number, height: number): RegionAverage {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(image.width, Math.ceil(x + width));
  const bottom = Math.min(image.height, Math.ceil(y + height));
  const total = Math.max(1, (right - left) * (bottom - top));
  const step = Math.max(1, Math.floor(Math.sqrt(total / 400)));
  let r = 0;
  let g = 0;
  let b = 0;
  let samples = 0;
  for (let py = top; py < bottom; py += step) {
    for (let px = left; px < right; px += step) {
      const index = (py * image.width + px) * image.bpp;
      r += image.data[index];
      g += image.data[index + 1];
      b += image.data[index + 2];
      samples += 1;
    }
  }
  if (!samples) return { r: 255, g: 255, b: 255, samples: 0 };
  return { r: r / samples, g: g / samples, b: b / samples, samples };
}
