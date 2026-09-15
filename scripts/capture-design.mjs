import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const baseUrl = process.env.CVG_DESIGN_URL || 'http://127.0.0.1:5173';
const outputDir = process.env.CVG_DESIGN_OUTPUT || '/tmp/cvg-design-current';
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const viewports = [
  { name: 'mobile-375', width: 375, height: 812 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
];

const results = [];
const summary = {
  generatedAt: new Date().toISOString(),
  conversations: { total: 184, open: 27, pending: 9, closed: 148 },
  tasks: { total: 2, pending: 1, inProgress: 1, completed: 0, overdue: 1 },
  alerts: { total: 18, active: 5, acknowledged: 9, resolved: 4, bySeverity: { critical: 1, error: 1, warning: 2, info: 1 } },
};
const premium = {
  generatedAt: new Date().toISOString(),
  responseTime: { avgFirstResponseTime: 228, totalConversationsWithResponse: 41 },
  handoff: { handoffRate: 18.4, totalHandoffs: 12 },
  alertsByCriticality: { critical: 1, error: 1 },
  sectorBacklog: [{ sectorId: 'reception', sectorName: 'Recepção', totalBacklog: 14, openConversations: 10, pendingConversations: 4 }],
  agingConversations: [{ conversationId: 'visual-1', sectorName: 'Clínica', status: 'open', hoursSinceLastMessage: 1.4, agingBucket: 'normal' }],
};
const demoTasks = [
  { id: 'task-1', conversationId: null, title: 'Confirmar retorno do Thor', description: 'Validar evolução e horário com a tutora.', status: 'pending', priority: 'high', assignedTo: 'equipe-clinica', createdBy: 'visual-user', dueAt: new Date(Date.now() + 5400000).toISOString(), completedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'task-2', conversationId: null, title: 'Revisar exames da Luna', description: 'Hemograma recebido pelo canal digital.', status: 'in_progress', priority: 'urgent', assignedTo: 'visual-user', createdBy: 'visual-user', dueAt: new Date(Date.now() - 3600000).toISOString(), completedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];
const demoAlerts = [
  { id: 'alert-1', conversationId: null, taskId: 'task-2', type: 'sla', title: 'Tempo de resposta crítico', message: 'Conversa clínica aguarda retorno humano.', severity: 'critical', status: 'active', triggeredBy: null, acknowledgedBy: null, acknowledgedAt: null, resolvedBy: null, resolvedAt: null, createdAt: new Date(Date.now() - 900000).toISOString(), updatedAt: new Date().toISOString() },
  { id: 'alert-2', conversationId: null, taskId: null, type: 'queue', title: 'Fila da recepção em atenção', message: 'Volume acima da média dos últimos 30 minutos.', severity: 'warning', status: 'acknowledged', triggeredBy: null, acknowledgedBy: 'visual-user', acknowledgedAt: new Date().toISOString(), resolvedBy: null, resolvedAt: null, createdAt: new Date(Date.now() - 1800000).toISOString(), updatedAt: new Date().toISOString() },
];
const demoSectors = [
  { id: 'reception', name: 'Recepção', code: 'recepcao', color: '#0ea5e9', icon: '', isActive: true },
  { id: 'admin', name: 'Administrativo', code: 'administrativo', color: '#64748b', icon: '', isActive: true },
  { id: 'surgery', name: 'Cirurgia', code: 'cirurgia', color: '#b42334', icon: '', isActive: true },
  { id: 'clinic', name: 'Clínica', code: 'clinica', color: '#16a34a', icon: '', isActive: true },
];
const demoAdminUsers = [
  { id: 'visual-user', name: 'Equipe CVG', email: 'atendimento@cevetguarapiranga.com.br', isActive: true, createdAt: new Date().toISOString() },
  { id: 'visual-vet', name: 'Dra. Camila', email: 'clinica@cevetguarapiranga.com.br', isActive: true, createdAt: new Date(Date.now() - 86400000).toISOString() },
];
const demoAdminRoles = [{ id: 'role-1', name: 'Atendimento', description: 'Acesso ao fluxo operacional e às conversas.' }];
const demoAdminQueues = [{ id: 'queue-1', name: 'Recepção', description: 'Triagem e primeiro atendimento.', isActive: true }];
const demoAdminTeams = [{ id: 'team-1', name: 'Equipe Clínica', description: 'Veterinários em atendimento.', isActive: true }];
const demoAuthUser = {
  id: 'visual-user',
  name: 'Equipe CVG',
  email: 'atendimento@cevetguarapiranga.com.br',
  isActive: true,
  createdAt: new Date(Date.now() - 180 * 86400000).toISOString(),
  roles: ['ADMIN', 'Gestão'],
  permissions: [
    'chat:read', 'chat:write', 'chat:delete',
    'tasks:read', 'tasks:write', 'tasks:delete',
    'notes:read', 'notes:write', 'notes:delete',
    'alerts:read', 'alerts:write', 'alerts:delete',
    'dashboard:read', 'admin:read', 'admin:write', 'audit:read',
  ],
  permissionsAuthoritative: true,
  sectors: demoSectors.map(({ id, name, code }) => ({ id, name, code, accessLevel: 'admin' })),
};
const demoConversations = { conversations: [{ id: 'conv-1', contactId: 'contact-1', contactName: 'Ricardo Akinaga', contactPhone: '11999999999', status: 'open', statusV2: 'em_atendimento', sectorId: 'reception', unreadCount: 1, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), lastMessage: { content: 'Pode esclarecer um pouco mais sua solicitação?', direction: 'outbound', createdAt: new Date(Date.now() - 780000).toISOString() } }] };
const demoContacts = [{ id: 'contact-1', name: 'Marina Souza', phone: '11999999999', email: 'marina@example.com', createdAt: new Date().toISOString() }];
const demoContactGroups = [{ id: 'group-1', name: 'Equipe Retorno', description: 'Acompanhamentos clínicos', groupType: 'internal', color: '#0284c7', icon: '', memberCount: 2 }];
const demoGroupMembers = [{ id: 'member-1', contactId: 'contact-1', contactName: 'Marina Souza', contactPhone: '11999999999' }];
const demoTutors = [{ id: 'tutor-1', externalId: null, name: 'Marina Souza', phone: '11999999999', email: 'marina@example.com', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), patients: [{ id: 'patient-1', name: 'Thor', species: 'Cachorro', breed: 'SRD' }], conversationCount: 2, taskCount: 1 }];
const demoPatients = [{ id: 'patient-1', externalId: null, name: 'Thor', species: 'Cachorro', breed: 'SRD', tutorId: 'tutor-1', tutor: { id: 'tutor-1', name: 'Marina Souza', phone: '11999999999' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), conversationCount: 2, taskCount: 1 }];
const demoContactDetail = { ...demoContacts[0], externalId: null, metadata: null, conversations: [{ id: 'conv-1', status: 'open', statusV2: 'em_atendimento', createdAt: new Date().toISOString(), lastMessage: 'Retorno confirmado para hoje.' }], notesCount: 2, tasksCount: 1, labels: [{ id: 'label-1', name: 'Retorno', color: '#0284c7' }], groups: [] };
const demoKanban = { columns: [
  { status: 'novo', label: 'Novos', icon: '', color: '#0ea5e9', count: 1, cards: [{ id: 'conv-1', contactName: 'Marina e Thor', contactPhone: '11999999999', lastMessage: 'Preciso agendar um retorno.', assignedUserName: null, sectorName: 'Recepção', sectorColor: '#0ea5e9', sectorIcon: '', labels: [{ name: 'Retorno', color: '#0284c7' }], priority: 'medium', minutesSinceUpdate: 8 }] },
  { status: 'em_atendimento', label: 'Em atendimento', icon: '', color: '#0369a1', count: 1, cards: [{ id: 'conv-2', contactName: 'Rafael e Luna', contactPhone: '11888888888', lastMessage: 'Exames anexados para avaliação.', assignedUserName: 'Dra. Camila', sectorName: 'Clínica', sectorColor: '#0369a1', sectorIcon: '', labels: [{ name: 'Exames', color: '#16a34a' }], priority: 'high', minutesSinceUpdate: 22 }] },
  { status: 'pendente', label: 'Pendentes', icon: '', color: '#d97706', count: 0, cards: [] },
  { status: 'em_espera', label: 'Em espera', icon: '', color: '#64748b', count: 0, cards: [] },
  { status: 'finalizado', label: 'Finalizados', icon: '', color: '#16a34a', count: 0, cards: [] },
], filters: { sectors: [{ id: 'reception', name: 'Recepção', icon: '', color: '#0ea5e9' }], labels: [] } };
const routeApi = async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith('/auth/me')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: demoAuthUser }) });
  if (path.endsWith('/metrics/summary')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(summary) });
  if (path.endsWith('/metrics/premium')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(premium) });
  if (path.endsWith('/kanban/board')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demoKanban) });
  if (path.endsWith('/tasks')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demoTasks) });
  if (path.endsWith('/alerts')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demoAlerts) });
  if (path.endsWith('/sectors')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demoSectors) });
  if (path.endsWith('/conversations')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demoConversations) });
  if (path.endsWith('/contacts/contact-1')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demoContactDetail) });
  if (path.endsWith('/contacts')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demoContacts) });
  if (path.endsWith('/contact-groups/group-1/members')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demoGroupMembers) });
  if (path.endsWith('/contact-groups')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demoContactGroups) });
  if (path.endsWith('/tutors/tutor-1')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demoTutors[0]) });
  if (path.endsWith('/tutors')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demoTutors) });
  if (path.endsWith('/patients/patient-1')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demoPatients[0]) });
  if (path.endsWith('/patients')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demoPatients) });
  if (path.endsWith('/admin/users')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demoAdminUsers) });
  if (path.endsWith('/admin/roles')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demoAdminRoles) });
  if (path.endsWith('/admin/queues')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demoAdminQueues) });
  if (path.endsWith('/admin/teams')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demoAdminTeams) });
  if (path.endsWith('/admin/dead-letters/stats')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: 0, unresolved: 0, resolved: 0, replayable: 0, manualOnly: 0, byHandler: [], byReason: [], lastFailedAt: null }) });
  if (path.endsWith('/admin/dead-letters')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], stats: { total: 0, unresolved: 0, resolved: 0 } }) });
  if (path.endsWith('/admin/webhook-security/stats')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: 0, allowed: 0, denied: 0, byReason: { missing_secret: 0, missing_signature: 0, invalid_signature_format: 0, invalid_signature: 0, signature_valid: 0 }, lastDecisionAt: null, lastDecision: null }) });
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
};
for (const viewport of viewports) {
  const context = await browser.newContext({ viewport, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${outputDir}/login-${viewport.name}.png`, fullPage: true });
  results.push(await page.evaluate((name) => ({
    target: `login-${name}`,
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    activeAnimations: document.getAnimations().filter((animation) => animation.playState === 'running').length,
  }), viewport.name));
  await context.close();
}

for (const viewport of viewports) {
  const context = await browser.newContext({ viewport, reducedMotion: 'no-preference' });
  await context.addInitScript(() => {
    localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'visual-only-token', user: { id: 'visual-user', name: 'Equipe CVG', email: 'visual@local', roles: ['Atendimento'] }, isAuthenticated: true }, version: 0 }));
  });
  const page = await context.newPage();
  await page.route('**/*', (route) => ['fetch', 'xhr'].includes(route.request().resourceType()) ? routeApi(route) : route.continue());
  await page.goto(`${baseUrl}/inbox`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${outputDir}/inbox-${viewport.name}.png`, fullPage: true });
  results.push(await page.evaluate((name) => ({
    target: `inbox-${name}`,
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    navVisible: getComputedStyle(document.querySelector('.sidebar')).transform === 'none',
    clippedSectorChips: Array.from(document.querySelectorAll('.sector-tab')).filter((chip) => chip.getBoundingClientRect().right > document.querySelector('.sector-tabs').getBoundingClientRect().right + 1).length,
  }), viewport.name));
  await context.close();
}

for (const viewport of viewports) {
  const context = await browser.newContext({ viewport, reducedMotion: 'no-preference' });
  await context.addInitScript(() => localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'visual-only-token', user: { id: 'visual-user', name: 'Equipe CVG', email: 'visual@local', roles: ['Gestão'] }, isAuthenticated: true }, version: 0 })));
  const page = await context.newPage();
  await page.route('**/*', (route) => ['fetch', 'xhr'].includes(route.request().resourceType()) ? routeApi(route) : route.continue());
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${outputDir}/dashboard-${viewport.name}.png`, fullPage: true });
  results.push(await page.evaluate((name) => ({ target: `dashboard-${name}`, innerWidth: innerWidth, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }), viewport.name));
  await context.close();
}

for (const target of ['tasks', 'alerts', 'notes', 'kanban', 'sectors', 'labels', 'contact-groups', 'admin', 'audit', 'settings', 'contacts', 'tutors', 'patients']) {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, reducedMotion: 'no-preference' });
    await context.addInitScript(() => localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'visual-only-token', user: { id: 'visual-user', name: 'Equipe CVG', email: 'visual@local', roles: ['ADMIN', 'Gestão'] }, isAuthenticated: true }, version: 0 })));
    const page = await context.newPage();
    await page.route('**/*', (route) => ['fetch', 'xhr'].includes(route.request().resourceType()) ? routeApi(route) : route.continue());
    await page.goto(`${baseUrl}/${target}`, { waitUntil: 'networkidle' });
    if (target === 'contacts') {
      await page.getByRole('button', { name: /Marina Souza/ }).click();
      await page.locator('.contacts-col-profile .ui-loading').waitFor({ state: 'hidden' });
      await page.locator('.contacts-col-profile .profile-header').waitFor();
    }
    if (target === 'contact-groups') {
      await page.getByRole('button', { name: /^Equipe Retorno/ }).click();
      await page.locator('.contact-groups-page.has-selection').waitFor();
      await page.locator('.group-detail .ui-loading').waitFor({ state: 'hidden' });
    }
    if (target === 'tutors') {
      await page.locator('.entity-table tbody tr').first().click();
      await page.locator('.entity-page.has-selection').waitFor();
      await page.locator('.entity-detail .ui-loading').waitFor({ state: 'hidden' });
      await page.locator('.entity-detail-list').waitFor();
    }
    if (target === 'patients') {
      await page.locator('.entity-table tbody tr').first().click();
      await page.locator('.entity-page.has-selection').waitFor();
      await page.locator('.entity-detail .ui-loading').waitFor({ state: 'hidden' });
      await page.locator('.entity-detail-list').waitFor();
    }
    await page.screenshot({ path: `${outputDir}/${target}-${viewport.name}.png`, fullPage: true });
    results.push(await page.evaluate(({ target, name }) => {
      const visible = (node) => !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
      const controls = Array.from(document.querySelectorAll('input,select,textarea,button')).filter(visible);
      const unnamedControls = controls.filter((control) => {
        if (control.getAttribute('aria-label') || control.getAttribute('aria-labelledby') || control.title) return false;
        if ('labels' in control && control.labels?.length) return false;
        return control.tagName === 'BUTTON' ? !control.textContent.trim() : true;
      }).length;
      const tableScroll = document.querySelector('.admin-table-scroll');
      const contrast = (selector) => {
        const node = document.querySelector(selector); if (!node) return null;
        const parse = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const lum = (rgb) => rgb.map((v) => { const c = v / 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, c, index) => sum + c * [.2126, .7152, .0722][index], 0);
        const fg = lum(parse(getComputedStyle(node).color));
        let parent = node; let bgValue = 'rgb(255, 255, 255)';
        while (parent) { const candidate = getComputedStyle(parent).backgroundColor; if (candidate && !candidate.endsWith(', 0)') && candidate !== 'transparent') { bgValue = candidate; break; } parent = parent.parentElement; }
        const bg = lum(parse(bgValue)); return Number(((Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05)).toFixed(2));
      };
      const singlePanelSelection = target === 'contacts' ? document.querySelector('.contacts-page')?.classList.contains('has-selection') && (innerWidth > 860 || !visible(document.querySelector('.contacts-col-list'))) : target === 'contact-groups' ? document.querySelector('.contact-groups-page')?.classList.contains('has-selection') && (innerWidth > 860 || !visible(document.querySelector('.groups-list'))) : target === 'tutors' || target === 'patients' ? document.querySelector('.entity-page')?.classList.contains('has-selection') && (innerWidth > 900 || !visible(document.querySelector('.entity-layout > section'))) : true;
      return { target: `${target}-${name}`, innerWidth, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, unnamedControls, hasTouchMoveAlternative: target !== 'kanban' || !!document.querySelector('.card-move select'), singlePanelSelection, adminTabsVisible: target !== 'admin' || Array.from(document.querySelectorAll('.admin-tab')).every(visible), adminTableScrollable: target !== 'admin' || innerWidth > 720 || (!!tableScroll && tableScroll.scrollWidth > tableScroll.clientWidth), contrastChecks: target === 'alerts' ? { filterLabel: contrast('.filter-label'), alertTime: contrast('.alert-time'), acknowledgedTime: contrast('.alert-ack') } : target === 'tasks' ? { filterLabel: contrast('.filter-label') } : target === 'kanban' ? { cardTime: contrast('.card-time') } : null };
    }, { target, name: viewport.name }));
    await context.close();
  }
}

const interactionContext = await browser.newContext({ viewport: viewports[0], reducedMotion: 'no-preference' });
await interactionContext.addInitScript(() => localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'visual-only-token', user: { id: 'visual-user', name: 'Equipe CVG', email: 'visual@local', roles: ['ADMIN'] }, isAuthenticated: true }, version: 0 })));
const interactionPage = await interactionContext.newPage();
await interactionPage.route('**/*', (route) => ['fetch', 'xhr'].includes(route.request().resourceType()) ? routeApi(route) : route.continue());
await interactionPage.goto(`${baseUrl}/inbox`, { waitUntil: 'networkidle' });
await interactionPage.getByRole('button', { name: 'Abrir navegação' }).click();
const drawerOpen = await interactionPage.locator('.layout').evaluate((node) => node.classList.contains('nav-open'));
const drawerFocusInside = await interactionPage.evaluate(() => !!document.activeElement?.closest('.sidebar'));
await interactionPage.keyboard.press('Escape');
const drawerClosedByEscape = await interactionPage.locator('.layout').evaluate((node) => !node.classList.contains('nav-open'));
const focusRestored = await interactionPage.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Abrir navegação');
const keyboardSequence = [];
for (let index = 0; index < 10; index += 1) {
  await interactionPage.keyboard.press('Tab');
  keyboardSequence.push(await interactionPage.evaluate(() => { const active = document.activeElement; return { tag: active?.tagName, name: active?.getAttribute('aria-label') || (active && 'labels' in active && active.labels?.[0]?.textContent?.trim()) || active?.textContent?.trim().slice(0, 48) || '' }; }));
}
results.push({ target: 'mobile-navigation-keyboard', drawerOpen, drawerFocusInside, drawerClosedByEscape, focusRestored, keyboardSequence, unnamedInSequence: keyboardSequence.filter((entry) => !entry.name).length });
await interactionPage.goto(`${baseUrl}/admin`, { waitUntil: 'networkidle' });
const sectorTrigger = interactionPage.getByRole('button', { name: 'Setores', exact: true }).first();
await sectorTrigger.click();
const adminDialog = interactionPage.getByRole('dialog', { name: 'Permissões por setor' });
await adminDialog.waitFor();
await interactionPage.waitForTimeout(50);
const adminDialogInitialFocus = await interactionPage.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
const adminDialogBackgroundInert = await interactionPage.evaluate(() => !!document.querySelector('button[aria-label^="Excluir usuário"]')?.closest('[inert]'));
await interactionPage.keyboard.press('Shift+Tab');
const adminDialogTrapReverse = await interactionPage.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
await interactionPage.keyboard.press('Escape');
const adminDialogClosedByEscape = await interactionPage.locator('[role="dialog"]').count() === 0;
const adminDialogFocusRestored = await interactionPage.evaluate(() => document.activeElement?.textContent?.trim().includes('Setores'));
results.push({ target: 'admin-dialog-keyboard', adminDialogInitialFocus, adminDialogBackgroundInert, adminDialogTrapReverse, adminDialogClosedByEscape, adminDialogFocusRestored });
for (const modalCase of [
  { route: 'tutors', trigger: 'Novo tutor', dialog: 'Novo tutor' },
  { route: 'patients', trigger: 'Novo paciente', dialog: 'Novo paciente' },
  { route: 'contacts', trigger: 'Novo contato', dialog: 'Novo contato' },
]) {
  await interactionPage.goto(`${baseUrl}/${modalCase.route}`, { waitUntil: 'networkidle' });
  await interactionPage.getByRole('button', { name: modalCase.trigger, exact: true }).first().click();
  const dialog = interactionPage.getByRole('dialog', { name: modalCase.dialog, exact: true });
  await dialog.waitFor();
  await interactionPage.waitForTimeout(50);
  const initialFocus = await interactionPage.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  const backgroundInert = await interactionPage.evaluate(() => { const backdrop = document.querySelector('[role="dialog"]')?.parentElement; return !!backdrop && Array.from(backdrop.parentElement?.children || []).filter((node) => node !== backdrop).every((node) => node.hasAttribute('inert')); });
  await interactionPage.keyboard.press('Shift+Tab');
  const reverseTrap = await interactionPage.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  await interactionPage.keyboard.press('Escape');
  const closedByEscape = await interactionPage.locator('[role="dialog"]').count() === 0;
  const restored = await interactionPage.evaluate((label) => (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || '').toLowerCase().includes(label.toLowerCase()), modalCase.trigger);
  results.push({ target: `${modalCase.route}-dialog-keyboard`, initialFocus, backgroundInert, reverseTrap, closedByEscape, restored });
}
await interactionContext.close();

const breakpointContext = await browser.newContext({ viewport: { width: 900, height: 700 }, reducedMotion: 'no-preference' });
await breakpointContext.addInitScript(() => localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'visual-only-token', user: { id: 'visual-user', name: 'Equipe CVG', email: 'visual@local', roles: ['ADMIN'] }, isAuthenticated: true }, version: 0 })));
const breakpointPage = await breakpointContext.newPage();
await breakpointPage.route('**/*', (route) => ['fetch', 'xhr'].includes(route.request().resourceType()) ? routeApi(route) : route.continue());
await breakpointPage.goto(`${baseUrl}/inbox`, { waitUntil: 'networkidle' });
results.push(await breakpointPage.evaluate(() => ({ target: 'layout-intermediate-900', innerWidth, scrollWidth: document.documentElement.scrollWidth, sidebarVisible: getComputedStyle(document.querySelector('.sidebar')).display !== 'none' && getComputedStyle(document.querySelector('.sidebar')).transform === 'none', sidebarInert: document.querySelector('.sidebar').hasAttribute('inert'), sidebarAriaHidden: document.querySelector('.sidebar').getAttribute('aria-hidden'), mobileMenuVisible: !!(document.querySelector('.topbar-menu')?.offsetWidth || document.querySelector('.topbar-menu')?.offsetHeight) })));
await breakpointContext.close();

const zoomContext = await browser.newContext({ viewport: { width: 640, height: 450 }, deviceScaleFactor: 2, reducedMotion: 'no-preference' });
await zoomContext.addInitScript(() => localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'visual-only-token', user: { id: 'visual-user', name: 'Equipe CVG', email: 'visual@local', roles: ['ADMIN'] }, isAuthenticated: true }, version: 0 })));
const zoomPage = await zoomContext.newPage();
await zoomPage.route('**/*', (route) => ['fetch', 'xhr'].includes(route.request().resourceType()) ? routeApi(route) : route.continue());
await zoomPage.goto(`${baseUrl}/inbox`, { waitUntil: 'networkidle' });
await zoomPage.screenshot({ path: `${outputDir}/inbox-200pct-reflow.png`, fullPage: true });
results.push(await zoomPage.evaluate(() => ({ target: 'inbox-200pct-reflow', cssViewportWidth: innerWidth, devicePixelRatio, scrollWidth: document.documentElement.scrollWidth, clippedSectorChips: Array.from(document.querySelectorAll('.sector-tab')).filter((chip) => chip.getBoundingClientRect().right > document.querySelector('.sector-tabs').getBoundingClientRect().right + 1).length })));
await zoomContext.close();

const perfContext = await browser.newContext({ viewport: viewports[0], reducedMotion: 'no-preference' });
const perfPage = await perfContext.newPage();
await perfPage.addInitScript(() => {
  window.__cvgPerf = { lcp: 0, cls: 0 };
  new PerformanceObserver((list) => { const entries = list.getEntries(); window.__cvgPerf.lcp = entries.at(-1)?.startTime || window.__cvgPerf.lcp; }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cvgPerf.cls += entry.value; }).observe({ type: 'layout-shift', buffered: true });
});
await perfPage.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
await perfPage.waitForTimeout(500);
results.push(await perfPage.evaluate(() => ({ target: 'login-performance-mobile-production', lcpMs: Math.round(window.__cvgPerf.lcp), cls: Number(window.__cvgPerf.cls.toFixed(4)), transferBytes: performance.getEntriesByType('resource').reduce((sum, entry) => sum + (entry.transferSize || 0), 0) })));
await perfContext.close();

const reduced = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const reducedPage = await reduced.newPage();
await reducedPage.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
await reducedPage.screenshot({ path: `${outputDir}/login-reduced-motion.png`, fullPage: true });
results.push(await reducedPage.evaluate(() => ({ target: 'login-reduced-motion', activeAnimations: document.getAnimations().filter((animation) => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations === Infinity).length })));
await reduced.close();
await browser.close();

console.log(JSON.stringify({ baseUrl, outputDir, results }, null, 2));
