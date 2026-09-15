#!/usr/bin/env node
/**
 * Browser accessibility gate for the authenticated product surface.
 *
 * The API is deliberately stubbed at the browser boundary so this check is
 * deterministic and can run before a deploy. API authorization remains
 * covered by the real integration/production suites.
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const baseUrl = process.env.CVG_DESIGN_URL || 'http://127.0.0.1:5173';
const targets = ['login', 'inbox', 'dashboard', 'tasks', 'alerts', 'notes', 'kanban', 'sectors', 'labels', 'contact-groups', 'admin', 'audit', 'settings', 'contacts', 'tutors', 'patients'];

const user = {
  id: 'axe-user',
  name: 'Equipe CVG',
  email: 'axe@example.com',
  roles: ['ADMIN', 'Gestão'],
  permissions: ['chat:read', 'chat:write', 'tasks:read', 'tasks:write', 'tasks:delete', 'notes:read', 'notes:write', 'notes:delete', 'alerts:read', 'alerts:write', 'dashboard:read', 'admin:read', 'admin:write', 'audit:read'],
  permissionsAuthoritative: true,
  sectors: [],
};

const summary = {
  conversations: { open: 4, pending: 2, closed: 10, archived: 0, total: 16 },
  tasks: { total: 8, pending: 2, inProgress: 2, completed: 4, cancelled: 0, overdue: 1 },
  alerts: { total: 4, active: 2, acknowledged: 1, resolved: 1, bySeverity: { info: 1, warning: 1, error: 1, critical: 1 } },
  generatedAt: new Date().toISOString(),
};

const payloads = new Map([
  ['metrics/summary', summary],
  ['metrics/premium', { ...summary, responseTime: { avgFirstResponseTime: 228, avgResponseTime: 300, totalConversationsWithResponse: 4 }, handoff: { totalHandoffs: 1, totalConversations: 16, handoffRate: 6.25 }, alertsByCriticality: { critical: 1, error: 1 }, sectorBacklog: [], agingConversations: [] }],
  ['kanban/board', { columns: [], filters: { sectors: [], labels: [] } }],
  ['conversations', { conversations: [] }],
  ['admin/dead-letters/stats', { total: 0, unresolved: 0, resolved: 0, replayable: 0, manualOnly: 0, byHandler: [], byReason: [] }],
  ['admin/dead-letters', { data: [], stats: { total: 0, unresolved: 0, resolved: 0 } }],
  ['admin/webhook-security/stats', { total: 0, allowed: 0, denied: 0, byReason: {} }],
]);

async function fulfillApi(route) {
  const path = new URL(route.request().url()).pathname.replace(/^\/api\//, '');
  const key = [...payloads.keys()].sort((a, b) => b.length - a.length).find((candidate) => path.includes(candidate));
  const body = path.endsWith('auth/me') ? { user } : key ? payloads.get(key) : [];
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

const browser = await chromium.launch({ headless: true });
const report = [];

for (const target of targets) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (target !== 'login') {
    await context.addInitScript(() => localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'axe-token', user: null, isAuthenticated: true }, version: 0 })));
  }
  const page = await context.newPage();
  await page.route('**/*', (route) => ['fetch', 'xhr'].includes(route.request().resourceType()) ? fulfillApi(route) : route.continue());
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('WebSocket')) consoleErrors.push(message.text());
  });
  await page.goto(`${baseUrl}/${target}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(150);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze();
  report.push({
    target,
    url: page.url(),
    violations: result.violations.map(({ id, impact, help, nodes }) => ({ id, impact, help, nodes: nodes.length })),
    passes: result.passes.length,
    incomplete: result.incomplete.length,
    consoleErrors,
  });
  await context.close();
}

await browser.close();
const failures = report.filter((entry) => entry.violations.length > 0 || entry.consoleErrors.length > 0);
console.log(JSON.stringify({ baseUrl, routes: report.length, failures: failures.length, report }, null, 2));
process.exitCode = failures.length > 0 ? 1 : 0;
