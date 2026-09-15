import { test, expect } from '@playwright/test';

/**
 * Controle negativo do harness.
 *
 * Executado apenas pelo projeto `canary` (playwright.aaa.config.ts) e orquestrado
 * por e2e/support/aaa/harness-selfcheck.ts. O teste DEVE falhar; se ele passar ou
 * for pulado, o selfcheck acusa o harness como quebrado (green por skip e proibido).
 */
test('@negative-control rejeita um candidato conhecido ruim', async () => {
  expect(process.env.AAA_CANARY_MODE, 'AAA_CANARY_MODE deve ser "fail" no controle negativo').toBe('fail');
  expect('known-bad-candidate').toBe('rejected');
});
