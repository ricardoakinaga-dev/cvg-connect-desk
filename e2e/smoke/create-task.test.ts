import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support';

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test.describe('Create Task Flow', () => {
  test('navigates to tasks page and sees task list', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: /Tarefas/ })).toBeVisible();
    await expect(page.getByText('Gerencie as tarefas da operação')).toBeVisible();
    await expect(page.getByText('Total')).toBeVisible();
  });

  test('opens create task form', async ({ page }) => {
    await page.goto('/tasks');
    await page.getByRole('button', { name: /Nova tarefa/i }).click();
    await expect(page.getByPlaceholder('Título da tarefa')).toBeVisible();
    await expect(page.getByPlaceholder('Descrição (opcional)')).toBeVisible();
    await expect(page.locator('select')).toBeVisible();
  });

  test('creates a new task with valid data', async ({ page }) => {
    await page.goto('/tasks');
    await page.getByRole('button', { name: /Nova tarefa/i }).click();

    const testTaskTitle = `Smoke Test Task ${Date.now()}`;
    await page.getByPlaceholder('Título da tarefa').fill(testTaskTitle);
    await page.getByPlaceholder('Descrição (opcional)').fill('Smoketest end-to-end do botão de criação');
    const createRequest = page.waitForRequest(request => {
      return request.method() === 'POST'
        && request.url().endsWith('/tasks');
    });

    await page.getByRole('button', { name: 'Criar' }).click();
    await createRequest;

    await page.reload();
    await expect(page.getByText(testTaskTitle)).toBeVisible({ timeout: 15_000 });
  });

  test('create task form has priority selector', async ({ page }) => {
    await page.goto('/tasks');
    await page.getByRole('button', { name: /Nova tarefa/i }).click();
    await expect(page.locator('select')).toBeVisible();
    await expect(page.getByLabel('Prioridade da tarefa').locator('option')).toHaveText([
      'Baixa',
      'Média',
      'Alta',
      'Urgente',
    ]);
  });
});
