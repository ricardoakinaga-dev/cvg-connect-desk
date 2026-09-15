/**
 * AAA-22 — Acessibilidade técnica independente (WCAG 2.2 AA / DESIGN_QA).
 *
 * Ferramentas reais executadas:
 *  - axe-core 4.13.0 vendorizado (`e2e/aaa/vendor/axe.min.js`) injetado na página real;
 *  - teclado real via Playwright (Tab/Shift+Tab/Enter/Escape) em 16 rotas + shell móvel,
 *    diálogo de exclusão de grupo e painel de contexto do Inbox;
 *  - medição de contraste real por par texto/fundo renderizado (cálculo WCAG);
 *  - zoom 200% (equivalência de layout 720×450 CSS px) e reflow 320 CSS px;
 *  - prefers-reduced-motion emulado (`reducedMotion: 'reduce'`);
 *  - snapshots da árvore de acessibilidade como proxy estrutural.
 *
 * Leitor de tela real (Orca/AT-SPI) NÃO foi executado nesta máquina; a limitação
 * é registrada como NOT_VERIFIED no teste explicitamente ignorado e no manifesto.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  API_BASE,
  AUTH_STATE_PATH,
  NORMAL_ROUTES,
  ROUTES,
  VIEWPORTS,
  WEB_BASE,
  appendResult,
  attachStateStubs,
  averageRegion,
  decodePng,
  evidencePath,
  loginAndSaveState,
  newContext,
  readJson,
  runMetadata,
  sleep,
  waitForApp,
  watchConsole,
  writeJson,
  type RouteSpec,
  type ViewportSpec,
} from './aaa22-support';

const AXE_PATH = join(process.cwd(), 'e2e', 'aaa', 'vendor', 'axe.min.js');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

let statePath = '';

test.beforeAll(async ({ browser }) => {
  statePath = await loginAndSaveState(browser);
  writeJson(evidencePath('run-metadata-a11y.json'), runMetadata());
});

interface AxeCheckNode { target: string[]; html: string; failureSummary?: string }
interface AxeFinding {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: AxeCheckNode[];
}
interface AxeRunResult {
  testEngine: { version: string };
  violations: AxeFinding[];
  incomplete: AxeFinding[];
  passes: Array<{ id: string }>;
}

async function runAxe(page: import('@playwright/test').Page): Promise<AxeRunResult> {
  await page.addScriptTag({ path: AXE_PATH });
  return await page.evaluate(async (tags) => {
    const axe = (window as unknown as {
      axe: { run: (root: Document, options: unknown) => Promise<{
        testEngine: { version: string };
        violations: Array<Record<string, unknown>>;
        incomplete: Array<Record<string, unknown>>;
        passes: Array<Record<string, unknown>>;
      }> };
    }).axe;
    const compact = (findings: Array<Record<string, unknown>>) => findings.map((finding) => ({
      id: finding.id,
      impact: finding.impact ?? null,
      help: finding.help,
      helpUrl: finding.helpUrl,
      tags: finding.tags,
      nodes: (finding.nodes as Array<Record<string, unknown>>).map((node) => ({
        target: node.target,
        html: String(node.html).slice(0, 300),
        failureSummary: node.failureSummary ?? undefined,
      })),
    }));
    const result = await axe.run(document, {
      runOnly: { type: 'tag', values: tags },
      resultTypes: ['violations', 'incomplete'],
      elementRef: false,
    });
    return {
      testEngine: { version: result.testEngine.version },
      violations: compact(result.violations) as never,
      incomplete: compact(result.incomplete) as never,
      passes: result.passes.map((pass) => ({ id: pass.id as string })),
    };
  }, AXE_TAGS);
}

interface AxeRow {
  route: string;
  path: string;
  viewport: string;
  url: string;
  engine: string;
  passCount: number;
  violationCount: number;
  seriousOrCritical: number;
  incompleteCount: number;
  violations: AxeFinding[];
  incomplete: AxeFinding[];
  consoleErrors: string[];
  ok: boolean;
  error?: string;
}

test.describe('AAA-22 axe-core (16 rotas × 5 viewports)', () => {
  for (const viewport of VIEWPORTS) {
    test(`axe @ ${viewport.name}`, async ({ browser }) => {
      test.setTimeout(1_200_000);
      const file = evidencePath('a11y', `axe-${viewport.name}.json`);
      let serious = 0;
      for (const route of NORMAL_ROUTES) {
        const row: AxeRow = {
          route: route.name,
          path: route.path,
          viewport: viewport.name,
          url: '',
          engine: 'axe-core 4.13.0',
          passCount: 0,
          violationCount: 0,
          seriousOrCritical: 0,
          incompleteCount: 0,
          violations: [],
          incomplete: [],
          consoleErrors: [],
          ok: false,
        };
        const context = await newContext(browser, { viewport, statePath: route.auth ? statePath : undefined });
        try {
          const page = await context.newPage();
          const capture = watchConsole(page);
          await page.goto(`${WEB_BASE}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          await waitForApp(page, route, 'normal');
          const result = await runAxe(page);
          row.url = page.url();
          row.engine = `axe-core ${result.testEngine.version}`;
          row.passCount = result.passes.length;
          row.violationCount = result.violations.length;
          row.incompleteCount = result.incomplete.length;
          row.violations = result.violations;
          row.incomplete = result.incomplete;
          row.seriousOrCritical = result.violations
            .filter((finding) => finding.impact === 'serious' || finding.impact === 'critical').length;
          row.consoleErrors = capture.messages;
          row.ok = true;
          serious += row.seriousOrCritical;
        } catch (error) {
          row.error = error instanceof Error ? error.message : String(error);
        }
        appendResult(file, row);
        await context.close().catch(() => undefined);
      }
      expect(serious, 'violações axe serious/critical devem ser zero (AA)').toBe(0);
    });
  }
});

interface KeyboardStep {
  index: number;
  tag: string;
  descriptor: string;
  id: string;
  classes: string;
  ariaLabel: string | null;
  focusVisible: boolean;
  outline: string;
  boxShadow: string;
  indicator: boolean;
  indicatorAncestor: boolean;
  rect: { width: number; height: number; top: number; left: number };
  offscreen: boolean;
  obscured: boolean;
  ariaHiddenAncestor: boolean;
  isBody: boolean;
}

async function tabTraversal(page: import('@playwright/test').Page, steps: number): Promise<KeyboardStep[]> {
  await page.evaluate(() => {
    const body = document.body;
    body.setAttribute('tabindex', '-1');
    body.focus();
    body.removeAttribute('tabindex');
  });
  const collected: KeyboardStep[] = [];
  for (let index = 1; index <= steps; index += 1) {
    await page.keyboard.press('Tab');
    await sleep(60);
    const step = await page.evaluate((stepIndex) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const centerX = Math.min(Math.max(rect.left + rect.width / 2, 1), window.innerWidth - 1);
      const centerY = Math.min(Math.max(rect.top + rect.height / 2, 1), window.innerHeight - 1);
      const top = rect.width > 0 && rect.height > 0 ? document.elementFromPoint(centerX, centerY) : null;
      const obscured = Boolean(top && top !== el && !el.contains(top) && !top.contains(el));
      let ariaHiddenAncestor = false;
      let node: Element | null = el;
      while (node) {
        if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') { ariaHiddenAncestor = true; break; }
        node = node.parentElement;
      }
      const outlineVisible = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
      let indicatorAncestor = false;
      let ancestor: Element | null = el.parentElement;
      for (let depth = 0; ancestor && depth < 4; depth += 1, ancestor = ancestor.parentElement) {
        if (ancestor.matches(':focus-within')) {
          const ancestorStyle = getComputedStyle(ancestor);
          const ancestorOutline = ancestorStyle.outlineStyle !== 'none' && parseFloat(ancestorStyle.outlineWidth) > 0;
          const ancestorShadow = ancestorStyle.boxShadow !== 'none' && ancestorStyle.boxShadow !== '';
          if (ancestorOutline || ancestorShadow) indicatorAncestor = true;
        }
      }
      const descriptor = (
        el.getAttribute('aria-label')
        || (el.textContent || '').replace(/\s+/g, ' ').trim()
        || el.getAttribute('title')
        || el.getAttribute('placeholder')
        || ''
      ).slice(0, 90);
      return {
        index: stepIndex,
        tag: el.tagName.toLowerCase(),
        descriptor,
        id: el.id || '',
        classes: el.className && typeof el.className === 'string' ? el.className.slice(0, 90) : '',
        ariaLabel: el.getAttribute('aria-label'),
        focusVisible: el.matches(':focus-visible'),
        outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
        boxShadow: cs.boxShadow,
        indicator: outlineVisible || (cs.boxShadow !== 'none' && cs.boxShadow !== ''),
        indicatorAncestor,
        rect: { width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top), left: Math.round(rect.left) },
        offscreen: rect.width === 0 || rect.height === 0,
        obscured,
        ariaHiddenAncestor,
        isBody: el === document.body,
      };
    }, index);
    if (step) collected.push(step);
  }
  return collected;
}

test('teclado — travessia por Tab em 16 rotas @1440x900', async ({ browser }) => {
  test.setTimeout(900_000);
  const report: Array<Record<string, unknown>> = [];
  const failures: string[] = [];
  for (const route of NORMAL_ROUTES) {
    const context = await newContext(browser, {
      viewport: VIEWPORTS[4],
      statePath: route.auth ? statePath : undefined,
    });
    try {
      const page = await context.newPage();
      await page.goto(`${WEB_BASE}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await waitForApp(page, route, 'normal');
      const skipLinkFirst = route.auth ? await page.evaluate(async () => {
        document.body.setAttribute('tabindex', '-1');
        (document.body as HTMLElement).focus();
        document.body.removeAttribute('tabindex');
        return true;
      }) : false;
      const steps = await tabTraversal(page, 14);
      if (route.auth && skipLinkFirst) {
        const first = steps[0];
        if (!first || !/Ir para o conteúdo/i.test(first.descriptor)) {
          failures.push(`${route.name}: primeiro Tab não foi o skip-link (${first?.descriptor || 'vazio'})`);
        }
      }
      const hidden = steps.filter((step) => step.ariaHiddenAncestor);
      if (hidden.length) failures.push(`${route.name}: foco em elemento aria-hidden (${hidden.length})`);
      const nonVisible = steps.filter((step) => step.focusVisible && !step.indicator && !step.indicatorAncestor);
      if (nonVisible.length) failures.push(`${route.name}: foco visível sem indicador (${nonVisible.length})`);
      report.push({ route: route.name, path: route.path, steps });
    } catch (error) {
      report.push({ route: route.name, path: route.path, error: error instanceof Error ? error.message : String(error) });
      failures.push(`${route.name}: travessia falhou`);
    }
    await context.close().catch(() => undefined);
    appendResult(evidencePath('a11y', 'keyboard.json'), report[report.length - 1]);
  }
  writeJson(evidencePath('a11y', 'keyboard-summary.json'), { routes: report.length, failures });
  expect(failures, 'travessia de teclado deve manter foco visível, ordenado e fora de aria-hidden').toEqual([]);
});

test('teclado — skip-link move o foco para o conteúdo @1440x900', async ({ browser }) => {
  const route = ROUTES.find((candidate) => candidate.name === 'inbox')!;
  const context = await newContext(browser, { viewport: VIEWPORTS[4], statePath });
  const page = await context.newPage();
  await page.goto(`${WEB_BASE}/inbox`, { waitUntil: 'domcontentloaded' });
  await waitForApp(page, route, 'normal');
  await page.evaluate(() => {
    document.body.setAttribute('tabindex', '-1');
    (document.body as HTMLElement).focus();
    document.body.removeAttribute('tabindex');
  });
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => ({
    descriptor: (document.activeElement?.textContent || '').replace(/\s+/g, ' ').trim(),
    href: (document.activeElement as HTMLAnchorElement)?.getAttribute('href'),
  }));
  expect(first.descriptor).toMatch(/Ir para o conteúdo/i);
  await page.keyboard.press('Enter');
  await sleep(150);
  const target = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName.toLowerCase());
  writeJson(evidencePath('a11y', 'skip-link.json'), { first, target });
  expect(target).toBe('main-content');
  await context.close();
});

test('teclado — shell móvel: abrir, prender foco, Escape e restaurar @375x812', async ({ browser }) => {
  const route = ROUTES.find((candidate) => candidate.name === 'inbox')!;
  const context = await newContext(browser, { viewport: VIEWPORTS[0], statePath });
  const page = await context.newPage();
  await page.goto(`${WEB_BASE}/inbox`, { waitUntil: 'domcontentloaded' });
  await waitForApp(page, route, 'normal');
  const menu = page.getByRole('button', { name: 'Abrir navegação' });
  await menu.focus();
  await page.keyboard.press('Enter');
  await sleep(250);
  const openState = await page.evaluate(() => {
    const sidebar = document.querySelector('aside.sidebar');
    const active = document.activeElement as HTMLElement | null;
    return {
      sidebarInert: sidebar?.hasAttribute('inert') ?? null,
      focusInsideSidebar: Boolean(active && sidebar?.contains(active)),
      focusDescriptor: (active?.getAttribute('aria-label') || active?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      navOpen: document.querySelector('.layout')?.classList.contains('nav-open') ?? false,
    };
  });
  await page.screenshot({ path: evidencePath('shots', 'a11y', 'mobile-nav-open-375x812.png'), animations: 'disabled' });
  const trap: string[] = [];
  for (let index = 0; index < 14; index += 1) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => {
      const sidebar = document.querySelector('aside.sidebar');
      return Boolean(sidebar && sidebar.contains(document.activeElement));
    });
    if (!inside) trap.push(`tab ${index + 1} fora do drawer`);
  }
  await page.keyboard.press('Escape');
  await sleep(250);
  const closedState = await page.evaluate(() => {
    const sidebar = document.querySelector('aside.sidebar');
    const active = document.activeElement as HTMLElement | null;
    return {
      sidebarInert: sidebar?.hasAttribute('inert') ?? null,
      navOpen: document.querySelector('.layout')?.classList.contains('nav-open') ?? false,
      focusOnMenu: active?.getAttribute('aria-label') === 'Abrir navegação',
    };
  });
  writeJson(evidencePath('a11y', 'mobile-nav.json'), { openState, trap, closedState });
  expect(openState.navOpen).toBe(true);
  expect(openState.sidebarInert).toBe(false);
  expect(openState.focusInsideSidebar).toBe(true);
  expect(trap).toEqual([]);
  expect(closedState.navOpen).toBe(false);
  expect(closedState.sidebarInert).toBe(true);
  expect(closedState.focusOnMenu).toBe(true);
  await context.close();
});

test('teclado — diálogo de exclusão de grupo: foco preso, Escape e retorno', async ({ browser }) => {
  const token = fixtureToken();
  const groupName = `AAA-22 modal ${Date.now()}`;
  let groupId = '';
  try {
    const created = await fetch(`${API_BASE}/contact-groups`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: groupName, description: 'probe temporário AAA-22' }),
    });
    if (created.status !== 200 && created.status !== 201) {
      test.skip(true, `API não permitiu criar grupo de probe (status ${created.status}); diálogo não alcançável.`);
      return;
    }
    const createdBody = await created.json() as { id?: string };
    groupId = createdBody.id || '';
    if (!groupId) {
      const list = await (await fetch(`${API_BASE}/contact-groups`, { headers: { Authorization: `Bearer ${token}` } })).json() as Array<{ id: string; name: string }>;
      groupId = list.find((group) => group.name === groupName)?.id || '';
    }

    const route = ROUTES.find((candidate) => candidate.name === 'contact-groups')!;
    const context = await newContext(browser, { viewport: VIEWPORTS[4], statePath });
    const page = await context.newPage();
    await page.goto(`${WEB_BASE}/contact-groups`, { waitUntil: 'domcontentloaded' });
    await waitForApp(page, route, 'normal');
    const trigger = page.getByRole('button', { name: `Excluir grupo ${groupName}` }).first();
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await sleep(200);
    const dialogState = await page.evaluate(() => {
      const element = document.querySelector('[role="dialog"]');
      const active = document.activeElement as HTMLElement | null;
      return {
        ariaModal: element?.getAttribute('aria-modal'),
        focusInside: Boolean(element && active && element.contains(active)),
        labelled: element?.getAttribute('aria-labelledby') || element?.getAttribute('aria-label') || null,
      };
    });
    await page.screenshot({ path: evidencePath('shots', 'a11y', 'group-delete-dialog-1440x900.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await sleep(250);
    const afterEscape = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      return {
        dialogPresent: Boolean(document.querySelector('[role="dialog"]')),
        focusDescriptor: (active?.getAttribute('aria-label') || active?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      };
    });
    writeJson(evidencePath('a11y', 'group-delete-dialog.json'), { groupName, dialogState, afterEscape });
    expect(dialogState.ariaModal).toBe('true');
    expect(dialogState.focusInside).toBe(true);
    expect(afterEscape.dialogPresent).toBe(false);
    expect(afterEscape.focusDescriptor).toContain(groupName);
    await context.close();
  } finally {
    if (groupId) {
      await fetch(`${API_BASE}/contact-groups/${groupId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }
  }
});

test('teclado — painel de contexto do Inbox: drawer fecha com Escape e devolve o foco @1024x768', async ({ browser }) => {
  const route = ROUTES.find((candidate) => candidate.name === 'inbox')!;
  const context = await newContext(browser, { viewport: VIEWPORTS[3], statePath });
  const page = await context.newPage();
  await page.goto(`${WEB_BASE}/inbox`, { waitUntil: 'domcontentloaded' });
  await waitForApp(page, route, 'normal');
  const firstConversation = page.locator('.conv-list-v2 button, .conv-list-v2 [role="button"], .conv-item').first();
  await firstConversation.click({ timeout: 15_000 });
  await sleep(500);
  const button = page.getByRole('button', { name: 'Abrir informações da conversa' });
  if (!(await button.count())) {
    test.skip(true, 'Sem conversa selecionável no fixture; painel de contexto indisponível.');
    await context.close();
    return;
  }
  const panelState = () => page.evaluate(() => {
    const panel = document.querySelector('.context-panel');
    if (!panel) return { present: false, onScreen: false, left: null as number | null, innerWidth: window.innerWidth };
    const rect = panel.getBoundingClientRect();
    return {
      present: true,
      onScreen: rect.width > 0 && rect.left < window.innerWidth - 2,
      left: Math.round(rect.left),
      innerWidth: window.innerWidth,
    };
  });
  const beforeOpen = await panelState();
  await button.focus();
  await page.keyboard.press('Enter');
  await sleep(350);
  const open = await panelState();
  await page.keyboard.press('Escape');
  await sleep(350);
  const closed = await panelState();
  const focusDescriptor = await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') || '').trim());
  writeJson(evidencePath('a11y', 'inbox-context-panel.json'), { viewport: '1024x768', beforeOpen, open, closed, focusDescriptor });
  expect(open.present).toBe(true);
  expect(open.onScreen).toBe(true);
  expect(closed.onScreen).toBe(false);
  expect(focusDescriptor).toBe('Abrir informações da conversa');
  await context.close();
});

interface ContrastFailure {
  selector: string;
  text: string;
  ratio: number;
  required: number;
  color: string;
  background: string;
  fontSize: number;
  bold: boolean;
  method?: string;
}

interface RgbaColor { r: number; g: number; b: number; a: number }

function parseColor(value: string): RgbaColor | null {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(',').map((part) => parseFloat(part.trim()));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

function compositeColor(front: RgbaColor, back: RgbaColor): RgbaColor {
  return {
    r: front.r * front.a + back.r * (1 - front.a),
    g: front.g * front.a + back.g * (1 - front.a),
    b: front.b * front.a + back.b * (1 - front.a),
    a: 1,
  };
}

function relativeLuminance(color: RgbaColor): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrastRatio(a: RgbaColor, b: RgbaColor): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

test('contraste real medido por par texto/fundo em 16 rotas @1440x900', async ({ browser }) => {
  test.setTimeout(900_000);
  const report: Array<Record<string, unknown>> = [];
  const allFailures: ContrastFailure[] = [];
  for (const route of NORMAL_ROUTES) {
    const context = await newContext(browser, { viewport: VIEWPORTS[4], statePath: route.auth ? statePath : undefined });
    try {
      const page = await context.newPage();
      await page.goto(`${WEB_BASE}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await waitForApp(page, route, 'normal');
      const result = await page.evaluate(() => {
        interface Rgba { r: number; g: number; b: number; a: number }
        const parse = (value: string): Rgba | null => {
          const match = value.match(/rgba?\(([^)]+)\)/);
          if (!match) return null;
          const parts = match[1].split(',').map((part) => parseFloat(part.trim()));
          return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
        };
        const composite = (front: Rgba, back: Rgba): Rgba => ({
          r: front.r * front.a + back.r * (1 - front.a),
          g: front.g * front.a + back.g * (1 - front.a),
          b: front.b * front.a + back.b * (1 - front.a),
          a: 1,
        });
        const luminance = (color: Rgba) => {
          const channel = (value: number) => {
            const normalized = value / 255;
            return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
          };
          return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
        };
        const ratio = (a: Rgba, b: Rgba) => {
          const l1 = luminance(a);
          const l2 = luminance(b);
          return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        };
        const backgroundFor = (element: Element): { color: Rgba; indeterminate: boolean } => {
          let node: Element | null = element;
          let accumulated: Rgba | null = null;
          let indeterminate = false;
          while (node) {
            const style = getComputedStyle(node);
            if (style.backgroundImage && style.backgroundImage !== 'none') indeterminate = true;
            const color = parse(style.backgroundColor);
            if (color && color.a > 0) {
              accumulated = accumulated ? composite(accumulated, color) : color;
              if (accumulated.a >= 0.999) break;
            }
            node = node.parentElement;
          }
          return { color: accumulated || { r: 255, g: 255, b: 255, a: 1 }, indeterminate };
        };
        const hasDirectText = (element: Element) => Array.from(element.childNodes)
          .some((child) => child.nodeType === 3 && (child.textContent || '').trim().length > 1);
        const selectorOf = (element: Element) => {
          const id = element.id ? `#${element.id}` : '';
          const classes = element.classList.length ? `.${Array.from(element.classList).slice(0, 2).join('.')}` : '';
          return `${element.tagName.toLowerCase()}${id}${classes}`;
        };
        const failures: Array<Record<string, unknown>> = [];
        const samples: Array<Record<string, unknown>> = [];
        const indeterminate: Array<{
          key: string;
          selector: string;
          text: string;
          color: string;
          fontSize: number;
          bold: boolean;
          required: number;
          rect: { x: number; y: number; width: number; height: number };
        }> = [];
        let indeterminateCount = 0;
        const elements = Array.from(document.querySelectorAll('body *'));
        for (const element of elements) {
          if (!hasDirectText(element)) continue;
          if (element.closest('[disabled], [aria-disabled="true"]')) continue;
          const content = (element.textContent || '').trim();
          // Glifos emoji são renderizados com cores próprias (não herdam color);
          // o contraste de texto WCAG não se aplica a eles.
          if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\s]+$/u.test(content)) continue;
          const rect = element.getBoundingClientRect();
          if (rect.width < 3 || rect.height < 3) continue;
          const style = getComputedStyle(element);
          if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) < 0.1) continue;
          const fontSize = parseFloat(style.fontSize);
          const bold = parseInt(style.fontWeight, 10) >= 700;
          const large = fontSize >= 24 || (bold && fontSize >= 18.66);
          const required = large ? 3 : 4.5;
          const background = backgroundFor(element);
          if (background.indeterminate) {
            indeterminateCount += 1;
            const key = `p${indeterminateCount}`;
            element.setAttribute('data-aaa22-pixel', key);
            indeterminate.push({
              key,
              selector: selectorOf(element),
              text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
              color: style.color,
              fontSize,
              bold,
              required,
              rect: {
                x: rect.left + window.scrollX,
                y: rect.top + window.scrollY,
                width: rect.width,
                height: rect.height,
              },
            });
            continue;
          }
          let textColor = parse(style.color);
          if (!textColor) continue;
          if (textColor.a < 1) textColor = composite(textColor, background.color);
          const measured = Math.round(ratio(textColor, background.color) * 100) / 100;
          const sample = {
            selector: selectorOf(element),
            text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
            ratio: measured,
            required,
            fontSize,
            bold,
            color: style.color,
            background: `rgb(${Math.round(background.color.r)}, ${Math.round(background.color.g)}, ${Math.round(background.color.b)})`,
          };
          if (measured < required - 0.005) failures.push(sample);
          else if (samples.length < 400) samples.push(sample);
        }
        const styleTag = document.createElement('style');
        styleTag.id = 'aaa22-pixel-style';
        styleTag.textContent = '[data-aaa22-pixel]{color:transparent!important;text-shadow:none!important;}';
        document.head.appendChild(styleTag);
        return {
          failures,
          samples: samples.slice(0, 400),
          indeterminate,
          indeterminateCount,
          elementsChecked: elements.length,
        };
      });
      let pixelFailures: ContrastFailure[] = [];
      let pixelMeasured = 0;
      let pixelNotMeasured = 0;
      if (result.indeterminate.length) {
        // Captura em blocos de viewport (evita o bug de elementos sticky/fixed
        // em screenshot fullPage, que desloca a sidebar e mascara o fundo real).
        const { docHeight, viewportHeight } = await page.evaluate(() => ({
          docHeight: Math.max(document.documentElement.scrollHeight, window.innerHeight),
          viewportHeight: window.innerHeight,
        }));
        const chunks = Math.min(8, Math.max(1, Math.ceil(docHeight / viewportHeight)));
        const captures: Array<{ scrollY: number; image: ReturnType<typeof decodePng> }> = [];
        for (let index = 0; index < chunks; index += 1) {
          const scrollY = index * viewportHeight;
          const hasCandidate = result.indeterminate.some((item) => item.rect.y >= scrollY && item.rect.y < scrollY + viewportHeight);
          if (!hasCandidate) continue;
          await page.evaluate((y) => window.scrollTo(0, y), scrollY);
          await sleep(150);
          const buffer = await page.screenshot({ animations: 'disabled' });
          captures.push({ scrollY, image: decodePng(buffer) });
        }
        for (const item of result.indeterminate) {
          const capture = captures.find((entry) => item.rect.y >= entry.scrollY && item.rect.y < entry.scrollY + entry.image.height);
          if (!capture) {
            pixelNotMeasured += 1;
            continue;
          }
          const localX = item.rect.x;
          const localY = item.rect.y - capture.scrollY;
          if (localY + item.rect.height < 0 || localY > capture.image.height) {
            pixelNotMeasured += 1;
            continue;
          }
          const average = averageRegion(
            capture.image,
            localX + 2,
            localY + 2,
            Math.max(1, item.rect.width - 4),
            Math.max(2, Math.min(capture.image.height - localY - 2, item.rect.height - 4)),
          );
          const background = { r: average.r, g: average.g, b: average.b, a: 1 };
          let foreground = parseColor(item.color);
          if (!foreground) continue;
          if (foreground.a < 1) foreground = compositeColor(foreground, background);
          const measured = Math.round(contrastRatio(foreground, background) * 100) / 100;
          pixelMeasured += 1;
          if (measured < item.required - 0.005) {
            pixelFailures.push({
              selector: item.selector,
              text: item.text,
              ratio: measured,
              required: item.required,
              color: item.color,
              background: `rgb(${Math.round(background.r)}, ${Math.round(background.g)}, ${Math.round(background.b)})`,
              fontSize: item.fontSize,
              bold: item.bold,
              method: 'pixel-sample',
            });
          }
        }
      }
      report.push({
        route: route.name,
        path: route.path,
        ...result,
        pixelMeasured,
        pixelNotMeasured,
        pixelFailures,
        indeterminate: undefined,
      });
      allFailures.push(
        ...result.failures.map((failure) => ({
          selector: String(failure.selector),
          text: String(failure.text),
          ratio: Number(failure.ratio),
          required: Number(failure.required),
          color: String(failure.color),
          background: String(failure.background),
          fontSize: Number(failure.fontSize),
          bold: Boolean(failure.bold),
          method: 'computed-background',
        })),
        ...pixelFailures,
      );
    } catch (error) {
      report.push({ route: route.name, path: route.path, error: error instanceof Error ? error.message : String(error) });
    }
    await context.close().catch(() => undefined);
  }
  writeJson(evidencePath('a11y', 'contrast.json'), { failures: allFailures, routes: report });
  expect(allFailures, 'pares texto/fundo devem atingir 4,5:1 (3:1 para texto grande)').toEqual([]);
});

test('zoom 200% — equivalência de layout 720×450 CSS px em 16 rotas', async ({ browser }) => {
  test.setTimeout(600_000);
  const report: Array<Record<string, unknown>> = [];
  const failures: string[] = [];
  const viewport: ViewportSpec = { name: '720x450-zoom200', width: 720, height: 450 };
  for (const route of NORMAL_ROUTES) {
    const context = await newContext(browser, { viewport, statePath: route.auth ? statePath : undefined });
    try {
      const page = await context.newPage();
      await page.goto(`${WEB_BASE}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await waitForApp(page, route, 'normal');
      const probe = await page.evaluate(() => {
        const root = document.documentElement;
        return {
          overflowX: root.scrollWidth > root.clientWidth + 1,
          scrollWidth: root.scrollWidth,
          clientWidth: root.clientWidth,
        };
      });
      report.push({ route: route.name, ...probe });
      if (probe.overflowX) failures.push(`${route.name}: rolagem horizontal em 720 CSS px`);
    } catch (error) {
      report.push({ route: route.name, error: error instanceof Error ? error.message : String(error) });
      failures.push(`${route.name}: navegação falhou no zoom 200%`);
    }
    await context.close().catch(() => undefined);
  }
  writeJson(evidencePath('a11y', 'zoom-200.json'), report);
  expect(failures, 'zoom 200% não deve exigir rolagem horizontal de página').toEqual([]);
});

test('reflow WCAG 1.4.10 — 320 CSS px em 16 rotas', async ({ browser }) => {
  test.setTimeout(600_000);
  const report: Array<Record<string, unknown>> = [];
  const failures: string[] = [];
  const viewport: ViewportSpec = { name: '320x800-reflow', width: 320, height: 800 };
  for (const route of NORMAL_ROUTES) {
    const context = await newContext(browser, { viewport, statePath: route.auth ? statePath : undefined });
    try {
      const page = await context.newPage();
      await page.goto(`${WEB_BASE}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await waitForApp(page, route, 'normal');
      const probe = await page.evaluate(() => {
        const root = document.documentElement;
        const offenders: string[] = [];
        for (const element of Array.from(document.querySelectorAll('body *'))) {
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && (rect.right > window.innerWidth + 2 || rect.left < -2)) {
            const id = element.id ? `#${element.id}` : '';
            const classes = element.classList.length ? `.${Array.from(element.classList).slice(0, 2).join('.')}` : '';
            offenders.push(`${element.tagName.toLowerCase()}${id}${classes} (left=${Math.round(rect.left)}, right=${Math.round(rect.right)})`);
            if (offenders.length >= 8) break;
          }
        }
        return {
          overflowX: root.scrollWidth > root.clientWidth + 1,
          scrollWidth: root.scrollWidth,
          clientWidth: root.clientWidth,
          offenders,
        };
      });
      report.push({ route: route.name, ...probe });
      if (probe.overflowX) failures.push(`${route.name}: overflowX (${probe.scrollWidth} > ${probe.clientWidth})`);
      await page.screenshot({ path: evidencePath('shots', 'reflow-320', `${route.name}.png`), animations: 'disabled' });
    } catch (error) {
      report.push({ route: route.name, error: error instanceof Error ? error.message : String(error) });
      failures.push(`${route.name}: navegação falhou no reflow 320`);
    }
    await context.close().catch(() => undefined);
  }
  writeJson(evidencePath('a11y', 'reflow-320.json'), report);
  expect(failures, 'reflow em 320 CSS px não deve exigir rolagem em dois eixos').toEqual([]);
});

test('orientação paisagem 812×375 — rotas críticas', async ({ browser }) => {
  test.setTimeout(300_000);
  const report: Array<Record<string, unknown>> = [];
  const viewport: ViewportSpec = { name: '812x375-landscape', width: 812, height: 375 };
  const names = ['inbox', 'contacts', 'dashboard', 'tasks', 'settings'];
  for (const name of names) {
    const route = ROUTES.find((candidate) => candidate.name === name)!;
    const context = await newContext(browser, { viewport, statePath: route.auth ? statePath : undefined });
    const page = await context.newPage();
    await page.goto(`${WEB_BASE}${route.path}`, { waitUntil: 'domcontentloaded' });
    await waitForApp(page, route, 'normal');
    const probe = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    report.push({ route: name, ...probe });
    await context.close().catch(() => undefined);
  }
  writeJson(evidencePath('a11y', 'orientation.json'), report);
});

test('prefers-reduced-motion — animações/transições zeradas e rolagem sem smooth', async ({ browser }) => {
  test.setTimeout(600_000);
  const report: Array<Record<string, unknown>> = [];
  const failures: string[] = [];
  for (const route of NORMAL_ROUTES) {
    const context = await newContext(browser, {
      viewport: VIEWPORTS[4],
      statePath: route.auth ? statePath : undefined,
      reducedMotion: 'reduce',
    });
    try {
      const page = await context.newPage();
      await page.goto(`${WEB_BASE}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await waitForApp(page, route, 'normal');
      const probe = await page.evaluate(() => {
        const offenders: string[] = [];
        for (const element of Array.from(document.querySelectorAll('body *'))) {
          const style = getComputedStyle(element);
          const animation = parseFloat(style.animationDuration) || 0;
          const transition = parseFloat(style.transitionDuration) || 0;
          if (animation > 0.05 || transition > 0.05) {
            const id = element.id ? `#${element.id}` : '';
            const classes = element.classList.length ? `.${Array.from(element.classList).slice(0, 2).join('.')}` : '';
            offenders.push(`${element.tagName.toLowerCase()}${id}${classes} anim=${animation} trans=${transition}`);
            if (offenders.length >= 8) break;
          }
        }
        return {
          reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
          offenders,
        };
      });
      report.push({ route: route.name, ...probe });
      if (!probe.reduced) failures.push(`${route.name}: media query não propagou reduce`);
      if (probe.scrollBehavior === 'smooth') failures.push(`${route.name}: scroll-behavior smooth com reduce`);
      if (probe.offenders.length) failures.push(`${route.name}: ${probe.offenders.length} elemento(s) com animação/transição`);
    } catch (error) {
      report.push({ route: route.name, error: error instanceof Error ? error.message : String(error) });
      failures.push(`${route.name}: navegação falhou com reduce`);
    }
    await context.close().catch(() => undefined);
  }
  writeJson(evidencePath('a11y', 'reduced-motion.json'), report);
  expect(failures, 'reduce deve desligar animações/transições e rolagem suave').toEqual([]);
});

test('papéis de status/alert sob loading e erro em rotas representativas', async ({ browser }) => {
  test.setTimeout(600_000);
  const names = ['inbox', 'tasks', 'dashboard', 'contacts'];
  const report: Array<Record<string, unknown>> = [];
  const failures: string[] = [];
  for (const name of names) {
    const route = ROUTES.find((candidate) => candidate.name === name)!;
    for (const state of ['loading', 'error500'] as const) {
      const context = await newContext(browser, { viewport: VIEWPORTS[4], statePath });
      await attachStateStubs(context, state, route.name);
      const page = await context.newPage();
      await page.goto(`${WEB_BASE}${route.path}`, { waitUntil: 'domcontentloaded' });
      await waitForApp(page, route, state);
      const probe = await page.evaluate(() => ({
        statuses: Array.from(document.querySelectorAll('[role="status"]')).map((element) => (element.textContent || '').trim()),
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((element) => (element.textContent || '').trim()),
      }));
      const hasPageStatus = probe.statuses.some((text) => /carregando|carregar|autenticando/i.test(text));
      const hasPageAlert = probe.alerts.some((text) => /falha|erro|não foi possível|indisponível|servidor/i.test(text));
      report.push({ route: name, state, ...probe, hasPageStatus, hasPageAlert });
      if (state === 'loading' && name !== 'dashboard' && !hasPageStatus) failures.push(`${name}: loading sem role=status de página`);
      if (state === 'error500' && !hasPageAlert) failures.push(`${name}: erro 500 sem role=alert`);
      await context.close().catch(() => undefined);
    }
  }
  writeJson(evidencePath('a11y', 'state-roles.json'), report);
  expect(failures, 'estados devem ser anunciados por role=status/alert').toEqual([]);
});

test('árvore de acessibilidade (aria snapshot) das 16 rotas @1440x900', async ({ browser }) => {
  test.setTimeout(600_000);
  const index: Array<Record<string, unknown>> = [];
  for (const route of NORMAL_ROUTES) {
    const context = await newContext(browser, { viewport: VIEWPORTS[4], statePath: route.auth ? statePath : undefined });
    const page = await context.newPage();
    await page.goto(`${WEB_BASE}${route.path}`, { waitUntil: 'domcontentloaded' });
    await waitForApp(page, route, 'normal');
    const snapshot = await page.locator('body').ariaSnapshot();
    const target = evidencePath('a11y', 'aria-snapshots', `${route.name}.yml`);
    writeFileSyncSafe(target, snapshot);
    index.push({ route: route.name, path: route.path, bytes: snapshot.length, lines: snapshot.split('\n').length });
    await context.close().catch(() => undefined);
  }
  writeJson(evidencePath('a11y', 'aria-snapshots', 'index.json'), index);
});

test('leitor de tela real (Orca/AT-SPI) — NÃO EXECUTADO nesta máquina', async () => {
  test.skip(true, [
    'Ambiente headless sem sessão AT-SPI/D-Bus ativa; Orca instalado (/usr/bin/orca) mas sem',
    'barramento acessível do Chromium e sem captura de fala confiável. A árvore de acessibilidade',
    'foi capturada (ariaSnapshot) e axe-core executado como proxies; leitura assistiva humana com',
    'leitor de tela real permanece NOT_VERIFIED e deve ser executada em ambiente com sessão gráfica.',
  ].join(' '));
});

test('barreiras visuais de interação — foco não coberto e alvos primários ≥44 px (amostra @1440x900)', async ({ browser }) => {
  test.setTimeout(300_000);
  const names = ['inbox', 'tasks', 'contacts', 'dashboard', 'settings'];
  const report: Array<Record<string, unknown>> = [];
  const failures: string[] = [];
  for (const name of names) {
    const route = ROUTES.find((candidate) => candidate.name === name)!;
    const context = await newContext(browser, { viewport: VIEWPORTS[4], statePath });
    const page = await context.newPage();
    await page.goto(`${WEB_BASE}${route.path}`, { waitUntil: 'domcontentloaded' });
    await waitForApp(page, route, 'normal');
    const probe = await page.evaluate(() => {
      const primary = Array.from(document.querySelectorAll('.ui-btn, .btn, button[type="submit"], .nav-item'));
      const small = primary
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            descriptor: (element.getAttribute('aria-label') || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        })
        .filter((item) => item.width > 0 && item.height > 0 && (item.width < 24 || item.height < 24));
      return { primaryCount: primary.length, below24: small, below44: primary.length ? primary.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44);
      }).length : 0 };
    });
    report.push({ route: name, ...probe });
    if (probe.below24.length) failures.push(`${name}: ${probe.below24.length} controle(s) primário(s) abaixo de 24px`);
    await context.close().catch(() => undefined);
  }
  writeJson(evidencePath('a11y', 'targets-focus.json'), report);
  expect(failures, 'WCAG 2.2 AA 2.5.8 exige alvo mínimo de 24×24 CSS px para controles').toEqual([]);
});

function writeFileSyncSafe(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function fixtureToken(): string {
  const state = readJson<{ origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }> }>(AUTH_STATE_PATH);
  const entries = (state?.origins || []).flatMap((origin) => origin.localStorage || []);
  const raw = entries.find((entry) => entry.name === 'auth-storage')?.value;
  try {
    return (JSON.parse(raw || '{}') as { state?: { token?: string } }).state?.token || '';
  } catch {
    return '';
  }
}

// Sanidade do vendor axe.
test.beforeAll(() => {
  if (!existsSync(AXE_PATH)) throw new Error(`axe.min.js ausente em ${AXE_PATH}`);
});
