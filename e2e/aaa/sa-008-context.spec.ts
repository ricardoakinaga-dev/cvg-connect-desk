/**
 * SA-008 — contexto de conversa comprovado em NAVEGADOR REAL + API REAL.
 *
 * Cobre o AC2/AC3 do cartão com a stack isolada do harness AAA:
 *  - duas conversas (A acessível, B de outro setor);
 *  - seleção, painel de contexto e ações na Inbox;
 *  - atalhos levam contexto para Tarefas/Notas/Alertas e filtram no servidor;
 *  - alternância repetida A↔B sem vazamento de estado/contexto;
 *  - back, forward, refresh e deep-link preservam a seleção;
 *  - criação com vínculo pré-preenchido;
 *  - negativos: UUID inválido e conversa inacessível → erro claro sem vazar título;
 *  - viewport desktop e móvel pertinente, sem overflow horizontal.
 *
 * Nenhum mock de API: os dados são criados via endpoints reais com o token de
 * fixture e as páginas consomem o desk-api real do run.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { FIXTURE_IDS, FIXTURE_PASSWORDS, FIXTURE_TOKENS } from '../support/aaa/fixtures.ts';
import { getRunContext } from '../support/aaa/run-context.ts';

const ctx = getRunContext();
const API = process.env.AAA_API_URL || `http://127.0.0.1:${ctx.ports.api}`;
const RUN_TAG = `sa008-${Date.now().toString(36)}`;

// Títulos únicos por run para não colidir com fixtures/outras execuções.
const TASK_A = `${RUN_TAG} tarefa da conversa A`;
const TASK_B = `${RUN_TAG} tarefa da conversa B`;
const ALERT_A = `${RUN_TAG} alerta da conversa A`;
const ALERT_B = `${RUN_TAG} alerta da conversa B`;
const NOTE_A = `${RUN_TAG} nota da conversa A`;
const NOTE_B = `${RUN_TAG} nota da conversa B`;

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

async function apiPost(request: APIRequestContext, path: string, data: unknown, token = FIXTURE_TOKENS.admin) {
  const response = await request.post(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    data,
  });
  const body = await response.text().catch(() => '');
  expect(response.status(), `${path} -> ${response.status()} ${body}`).toBeLessThan(300);
  return response;
}

async function apiGet(request: APIRequestContext, path: string, token = FIXTURE_TOKENS.admin) {
  const response = await request.get(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status(), `${path} -> ${response.status()}`).toBe(200);
  return response;
}

async function apiPut(request: APIRequestContext, path: string, data: unknown, token = FIXTURE_TOKENS.admin) {
  const response = await request.put(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    data,
  });
  const body = await response.text().catch(() => '');
  expect(response.status(), `${path} -> ${response.status()} ${body}`).toBeLessThan(300);
  return response;
}

/**
 * Provisiona RBAC REAL para a prova de acesso cruzado no browser: dá ao papel
 * `Agent` da fixture exatamente as leituras (inclusive `tasks:read`) para que o
 * gate de capacidade da UI passe e o SERVIDOR decida o 404 de setor. O papel
 * `Admin` NÃO é alterado aqui: a migration 0025 já o provisiona com o catálogo
 * completo, e a instalação já é autoritativa.
 */
async function provisionRbac(request: APIRequestContext): Promise<void> {
  // A migration 0025 já popula `permissions` e associa os papéis built-in.
  // O papel `Agent` da fixture é customizado: recebe aqui exatamente as
  // leituras para que o gate de capacidade da UI passe e o SERVIDOR decida o
  // 404 de setor na prova de acesso cruzado.
  const wanted = ['chat:read', 'tasks:read', 'alerts:read', 'notes:read'];
  const permissions = (await (await apiGet(request, '/admin/permissions')).json()) as Array<{ id: string; name: string }>;
  const byName = new Map(permissions.map((permission) => [permission.name, permission.id]));
  const missing = wanted.filter((name) => !byName.has(name));
  expect(missing, `permissões ausentes no catálogo: ${missing.join(', ')}`).toHaveLength(0);
  const roles = (await (await apiGet(request, '/admin/roles')).json()) as Array<{ id: string; name: string }>;
  const agentRole = roles.find((role) => role.name === 'Agent')?.id;
  expect(agentRole, 'papel Agent da fixture deve existir').toBeTruthy();
  await apiPut(request, `/admin/roles/${agentRole}`, {
    permissionIds: wanted.map((name) => byName.get(name)),
  });
}

function conversationRow(page: Page, previewText: string) {
  // A lista tem DUAS conversas do mesmo contato (contato A aparece na conversa
  // com setor e na sem setor); o preview da última mensagem identifica a certa.
  return page.locator('.conv-row').filter({ hasText: previewText }).first();
}

test.describe('SA-008 — contexto de conversa (browser + API reais)', () => {
  test.beforeAll(async ({ request }) => {
    await provisionRbac(request);
    await apiPost(request, '/tasks', {
      title: TASK_A, conversationId: FIXTURE_IDS.conversationA, priority: 'high',
    });
    await apiPost(request, '/tasks', {
      title: TASK_B, conversationId: FIXTURE_IDS.conversationB, priority: 'high',
    });
    await apiPost(request, '/alerts', {
      conversationId: FIXTURE_IDS.conversationA, type: 'system', title: ALERT_A, severity: 'warning',
    });
    await apiPost(request, '/alerts', {
      conversationId: FIXTURE_IDS.conversationB, type: 'system', title: ALERT_B, severity: 'warning',
    });
    await apiPost(request, '/notes', {
      conversationId: FIXTURE_IDS.conversationA, referenceType: 'conversation',
      referenceId: FIXTURE_IDS.conversationA, content: NOTE_A,
    });
    await apiPost(request, '/notes', {
      conversationId: FIXTURE_IDS.conversationB, referenceType: 'conversation',
      referenceId: FIXTURE_IDS.conversationB, content: NOTE_B,
    });
  });

  test('Inbox → atalhos → Tarefas/Notas/Alertas filtram pelo contexto e voltam à conversa', async ({ page }) => {
    await login(page, 'aaa-admin@cvg.test', FIXTURE_PASSWORDS.admin);

    // Seleciona a conversa A e abre o painel de contexto.
    await page.goto('/inbox');
    await conversationRow(page, '[fixture] inbound A1').click();
    await page.getByRole('button', { name: 'Abrir informações da conversa' }).click();
    const contextPanel = page.getByRole('complementary', { name: 'Contexto da conversa' });
    await expect(contextPanel).toBeVisible();
    await expect(contextPanel.getByRole('heading', { name: 'Atendimento', exact: true })).toBeVisible();

    // Atalho de Tarefas: URL com contexto + somente dados de A.
    await contextPanel.getByRole('link', { name: /^Tarefas/ }).click();
    await expect(page).toHaveURL(new RegExp(`/tasks\\?conversationId=${FIXTURE_IDS.conversationA}`));
    await expect(page.getByText('Mostrando apenas as tarefas da conversa selecionada.')).toBeVisible();
    await expect(page.getByText(TASK_A)).toBeVisible();
    await expect(page.getByText(TASK_B)).toHaveCount(0);

    // Vínculo de criação pré-preenchido com a conversa selecionada.
    await page.getByRole('button', { name: 'Nova tarefa' }).click();
    await expect(page.locator('#task-conversation')).toHaveValue(FIXTURE_IDS.conversationA);
    await page.getByRole('button', { name: 'Cancelar' }).first().click();

    // Volta à conversa: seleção preservada (thread real, não o preview da lista).
    await page.getByRole('link', { name: 'Voltar à conversa' }).click();
    await expect(page).toHaveURL(new RegExp(`/inbox\\?conversation=${FIXTURE_IDS.conversationA}`));
    const thread = page.locator('.chat-messages-v2');
    await expect(thread.getByText('[fixture] inbound A1')).toBeVisible();
    await expect(thread.getByText('[fixture] inbound B1')).toHaveCount(0);

    // Atalho de Notas: contexto autorizado da conversa (não "minhas notas").
    await page.getByRole('button', { name: 'Abrir informações da conversa' }).click();
    await page.getByRole('complementary', { name: 'Contexto da conversa' })
      .getByRole('link', { name: /^Notas/ }).click();
    await expect(page).toHaveURL(new RegExp(`/notes\\?conversationId=${FIXTURE_IDS.conversationA}`));
    await expect(page.getByText('Mostrando apenas as notas da conversa selecionada.')).toBeVisible();
    await expect(page.getByText(NOTE_A)).toBeVisible();
    await expect(page.getByText(NOTE_B)).toHaveCount(0);

    // Atalho de Alertas.
    await page.getByRole('link', { name: 'Voltar à conversa' }).click();
    await page.getByRole('button', { name: 'Abrir informações da conversa' }).click();
    await page.getByRole('complementary', { name: 'Contexto da conversa' })
      .getByRole('link', { name: /^Alertas/ }).click();
    await expect(page).toHaveURL(new RegExp(`/alerts\\?conversationId=${FIXTURE_IDS.conversationA}`));
    await expect(page.getByText('Mostrando apenas os alertas da conversa selecionada.')).toBeVisible();
    await expect(page.getByText(ALERT_A)).toBeVisible();
    await expect(page.getByText(ALERT_B)).toHaveCount(0);
  });

  test('back, forward, refresh e deep-link preservam o contexto selecionado', async ({ page }) => {
    await login(page, 'aaa-admin@cvg.test', FIXTURE_PASSWORDS.admin);
    await page.goto(`/tasks?conversationId=${FIXTURE_IDS.conversationA}`);
    await expect(page.getByText(TASK_A)).toBeVisible();

    // Navega para fora e volta com o botão do navegador. A prova exige que a
    // página REMONTE e refaça a consulta contextual (não apenas bfcache).
    await page.goto('/dashboard');
    const refetch = page.waitForRequest((request) => request.url().includes(`/tasks?conversationId=${FIXTURE_IDS.conversationA}`));
    await page.goBack();
    await refetch;
    await expect(page).toHaveURL(new RegExp(`conversationId=${FIXTURE_IDS.conversationA}`));
    await expect(page.getByText(TASK_A)).toBeVisible();
    await expect(page.getByText(TASK_B)).toHaveCount(0);

    // Forward mantém a URL contextual.
    await page.goForward();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goBack();

    // Refresh no mesmo deep-link.
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`conversationId=${FIXTURE_IDS.conversationA}`));
    await expect(page.getByText(TASK_A)).toBeVisible();
    await expect(page.getByText(TASK_B)).toHaveCount(0);

    // Remover filtro é ação explícita e recarrega sem contexto.
    await page.getByRole('button', { name: 'Remover filtro' }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByText(TASK_A)).toBeVisible();
    await expect(page.getByText(TASK_B)).toBeVisible();
  });

  test('alternância repetida A↔B na Inbox isola histórico, seleção e painel', async ({ page }) => {
    await login(page, 'aaa-admin@cvg.test', FIXTURE_PASSWORDS.admin);
    await page.goto('/inbox');

    const thread = page.locator('.chat-messages-v2');
    for (let round = 0; round < 3; round += 1) {
      await conversationRow(page, '[fixture] inbound A1').click();
      await expect(thread.getByText('[fixture] inbound A1')).toBeVisible();
      await expect(thread.getByText('[fixture] inbound B1')).toHaveCount(0);
      await expect(conversationRow(page, '[fixture] inbound A1')).toHaveAttribute('aria-pressed', 'true');

      await conversationRow(page, '[fixture] inbound B1').click();
      await expect(thread.getByText('[fixture] inbound B1')).toBeVisible();
      await expect(thread.getByText('[fixture] inbound A1')).toHaveCount(0);
      await expect(conversationRow(page, '[fixture] inbound B1')).toHaveAttribute('aria-pressed', 'true');
    }

    // Painel de contexto reflete a conversa selecionada no momento.
    await page.getByRole('button', { name: 'Abrir informações da conversa' }).click();
    const panel = page.getByRole('complementary', { name: 'Contexto da conversa' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Contato Setor B', { exact: true })).toBeVisible();
    await expect(panel.getByText('Contato Setor A', { exact: true })).toHaveCount(0);
  });

  test('negativos: UUID inválido e contexto inexistente/inacessível sem vazamento', async ({ page }) => {
    // Formato inválido: erro claro e nenhuma lista carregada.
    await login(page, 'aaa-admin@cvg.test', FIXTURE_PASSWORDS.admin);
    await page.goto('/tasks?conversationId=nao-e-uuid');
    await expect(page.getByText('Contexto inválido')).toBeVisible();
    await expect(page.getByText(TASK_A)).toHaveCount(0);
    await expect(page.getByText(TASK_B)).toHaveCount(0);

    // Conversa inexistente: 404 real do servidor → contexto inacessível sem títulos.
    await page.goto('/tasks?conversationId=99999999-9999-4999-8999-999999999999');
    await expect(page.getByText('Contexto inacessível')).toBeVisible();
    await expect(page.getByText(TASK_A)).toHaveCount(0);
    await expect(page.getByText(TASK_B)).toHaveCount(0);

    // Acesso cruzado com RBAC REAL: Agente A tem tasks:read (gate de UI passa)
    // mas não é membro do setor B — o SERVIDOR responde 404 e a UI mostra
    // "Contexto inacessível" sem vazar nenhum título.
    await page.getByRole('button', { name: /Sair com segurança/ }).first().click();
    await page.waitForURL(/\/login/, { timeout: 30_000 }).catch(async () => {
      await page.goto('/login');
    });
    await login(page, 'aaa-agente-a@cvg.test', FIXTURE_PASSWORDS.agentA);
    const deniedResponse = page.waitForResponse(
      (response) => response.url().startsWith(API) && response.url().includes('/tasks?conversationId='),
    );
    await page.goto(`/tasks?conversationId=${FIXTURE_IDS.conversationB}`);
    expect((await deniedResponse).status(), 'servidor deve negar a conversa B').toBe(404);
    await expect(page.getByText('Contexto inacessível')).toBeVisible();
    await expect(page.getByText(TASK_B)).toHaveCount(0);
    await expect(page.getByText(TASK_A)).toHaveCount(0);
  });

  test('viewport móvel: contexto visível, sem overflow e primeiro item útil no topo', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, 'aaa-admin@cvg.test', FIXTURE_PASSWORDS.admin);
    await page.goto(`/tasks?conversationId=${FIXTURE_IDS.conversationA}`);

    await expect(page.getByText('Mostrando apenas as tarefas da conversa selecionada.')).toBeVisible();
    await expect(page.getByText(TASK_A)).toBeVisible();
    await expect(page.getByText(TASK_B)).toHaveCount(0);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // A09: a tarefa prioritária do contexto aparece dentro do primeiro viewport.
    const box = await page.getByText(TASK_A).boundingBox();
    expect(box, 'tarefa contextual deve ter caixa visível').not.toBeNull();
    expect((box?.y ?? 9999)).toBeLessThan(844);
  });

  test('falha de transporte recuperável preserva o contexto (fault injection de API)', async ({ page }) => {
    await login(page, 'aaa-admin@cvg.test', FIXTURE_PASSWORDS.admin);
    await page.goto(`/tasks?conversationId=${FIXTURE_IDS.conversationA}`);
    await expect(page.getByText(TASK_A).first()).toBeVisible();

    // Injeta falha de TRANSPORTE apenas na rota de API (documento/servidor são
    // reais); a página deve mostrar erro recuperável, nunca vazio falso.
    // Somente chamadas de API (fetch/XHR) falham; a navegação do documento e o
    // servidor real continuam íntegros.
    await page.route('**/tasks*', (route) => {
      const type = route.request().resourceType();
      if (type === 'fetch' || type === 'xhr') return route.abort('failed');
      return route.continue();
    });
    await page.reload();
    await expect(page.locator('#main-content .ui-state__title', { hasText: 'Sem conexão' })).toBeVisible();
    await expect(page.getByText(TASK_B)).toHaveCount(0);

    // Remove a falha e recupera pelo botão real de retry, mantendo o contexto.
    await page.unroute('**/tasks*');
    await page.getByRole('button', { name: /Tentar novamente|Recarregar/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`conversationId=${FIXTURE_IDS.conversationA}`));
    await expect(page.getByText(TASK_A).first()).toBeVisible();
    await expect(page.getByText(TASK_B)).toHaveCount(0);
  });
});
