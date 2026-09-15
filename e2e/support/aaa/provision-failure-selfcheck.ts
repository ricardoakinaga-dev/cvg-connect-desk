// SA-003/AC3 — controle negativo de PROVISIONAMENTO: se o alvo (porta do
// PostgreSQL do run) já pertence a outro processo, o harness precisa ABORTAR
// sem tocar no recurso alheio e sem deixar recursos próprios para trás.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { getRunContext } from './run-context.ts';
import { provisionIsolatedEnv } from './isolated-env.ts';

const ctx = getRunContext();
mkdirSync(ctx.runRoot, { recursive: true });
const out = process.env.AAA_SELFCHECK_OUT || join(ctx.runRoot, 'provision-failure-selfcheck.json');

function occupy(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port }, () => resolve(server));
  });
}

async function isListening(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

const checks: Array<Record<string, unknown>> = [];
let blocker: net.Server | null = null;

async function main() {
try {
  blocker = await occupy(ctx.ports.postgres);
  checks.push({ name: 'porta_bloqueada_por_terceiro', ok: true, port: ctx.ports.postgres });

  let aborted = false;
  let message = '';
  try {
    await provisionIsolatedEnv(ctx);
  } catch (error) {
    aborted = true;
    message = String(error);
  }
  checks.push({ name: 'provisionamento_aborta_sem_tocar_alvo', ok: aborted, message: message.slice(0, 200) });
  checks.push({ name: 'processo_alheio_intacto', ok: await isListening(ctx.ports.postgres) });
  checks.push({ name: 'sem_diretorio_gerenciado_proprio', ok: !existsSync(join(ctx.runRoot, 'pg', 'data', 'postmaster.pid')) });
} catch (error) {
  checks.push({ name: 'execucao', ok: false, error: String(error) });
} finally {
  if (blocker) await new Promise<void>((resolve) => blocker!.close(() => resolve()));
}

const summary = {
  runId: ctx.runId,
  checkedAt: new Date().toISOString(),
  result: checks.every((check) => check.ok) ? 'PASS' : 'FAIL',
  checks,
};
writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.result === 'PASS' ? 0 : 1);
}

void main();
