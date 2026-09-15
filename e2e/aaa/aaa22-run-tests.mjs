/**
 * AAA-22 — runner equivalente ao check declarado.
 *
 * Motivo: `playwright.aaa.config.ts` importa `e2e/support/aaa/run-context.ts`,
 * que usa `import.meta.url`. Com o Node 24 e o loader interno do Playwright, o
 * `require` desse .ts quebra ("exports is not defined in ES module scope");
 * executar o CLI sob o loader `tsx` resolve o carregamento do config, mas o
 * `tsx` injeta helpers esbuild (`__name`) que são herdados pelos workers via
 * `execArgv` e quebram `page.evaluate`. Este wrapper inicia o CLI com o loader
 * tsx e limpa `process.execArgv` antes do fork dos workers, de modo que as
 * specs sejam transformadas pelo Babel do próprio Playwright.
 *
 * Uso:
 *   node --import tsx e2e/aaa/aaa22-run-tests.mjs test <specs...> --config playwright.aaa.config.ts
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.execArgv = [];
require('@playwright/test/cli');
