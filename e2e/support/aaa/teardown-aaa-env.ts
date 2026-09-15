import { teardownIsolatedEnv } from './isolated-env.ts';
import { getRunContext } from './run-context.ts';

const stopServices = process.argv.includes('--stop-services');
const dropDatabase = process.argv.includes('--drop-database');

if (!stopServices) {
  console.error('[teardown-aaa-env] Recusado: todo teardown exige --stop-services (escopo explicito).');
  console.error('Uso: pnpm exec tsx e2e/support/aaa/teardown-aaa-env.ts --stop-services [--drop-database]');
  process.exit(2);
}

const ctx = getRunContext();
const result = teardownIsolatedEnv(ctx, { stopServices: true, dropDatabase });
console.log(JSON.stringify({ runId: ctx.runId, ...result }, null, 2));
