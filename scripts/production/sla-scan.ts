// SA-017 — varredura de alertas automáticos por regra/limiar congelados.
//
// Uso: DATABASE_URL=<banco> pnpm exec tsx scripts/production/sla-scan.ts [--limit N] [--now ISO8601]
//      [--loop] [--interval-ms N]  → modo agendador residente (executa a cada N ms)
// Saída: JSON estruturado com candidatos, alertas criados e falhas.
// Pensado para cron/worker agendado; idempotente por janela via recibo durável.
// `--now` permite ensaio com relógio controlado (janela fixa) sem alterar o
// comportamento em produção (default: relógio do processo).
import { scanSlaAlerts } from '@cvg/alerts';

const limitArg = process.argv.indexOf('--limit');
const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : undefined;
const nowArg = process.argv.indexOf('--now');
const now = nowArg >= 0 ? new Date(process.argv[nowArg + 1]) : undefined;
if (nowArg >= 0 && (!now || Number.isNaN(now.getTime()))) {
  console.error(JSON.stringify({ ok: false, error: 'argumento --now invalido' }));
  process.exit(2);
}
const loop = process.argv.includes('--loop');
const intervalArg = process.argv.indexOf('--interval-ms');
const intervalMs = intervalArg >= 0 ? Number(process.argv[intervalArg + 1]) : 60_000;
if (loop && (!Number.isInteger(intervalMs) || intervalMs < 250)) {
  console.error(JSON.stringify({ ok: false, error: 'interval-ms invalido (>=250)' }));
  process.exit(2);
}

async function runOnce() {
  const result = await scanSlaAlerts({ limit, now });
  if (result.isErr()) {
    console.error(JSON.stringify({ ok: false, error: result.error.message }));
    return false;
  }
  console.log(JSON.stringify({ ok: true, iterationAt: new Date().toISOString(), ...result.value }));
  return true;
}

async function main() {
  if (!loop) {
    const ok = await runOnce();
    process.exit(ok ? 0 : 1);
  }

  // Agendador residente: repete a varredura no intervalo configurado até SIGTERM.
  console.log(JSON.stringify({ ok: true, mode: 'loop', intervalMs, startedAt: new Date().toISOString() }));
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ ok: true, mode: 'loop', stoppedAt: new Date().toISOString() }));
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  while (!stopping) {
    await runOnce();
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

void main();
