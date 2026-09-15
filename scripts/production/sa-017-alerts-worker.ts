// SA-017 — alertas automáticos ponta a ponta: AGENDADOR real, janela,
// concorrência, WORKER real de eventos e CAS ack/resolve via HTTP.
//
// Uso: pnpm exec tsx scripts/production/sa-017-alerts-worker.ts
//
// Cobre o que a auditoria R2 exigiu além do teste de unidade: disparo pelo
// processo agendador (script real), idempotência por janela com relógio
// controlado, corrida de dois agendadores, criação de alerta pelo
// message-worker a partir de evento de outbox e CAS concorrente de ack/resolve
// com trilha de auditoria correta.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { getRunContext } from '../../e2e/support/aaa/run-context.ts';
import { provisionIsolatedEnv, teardownIsolatedEnv } from '../../e2e/support/aaa/isolated-env.ts';

const ctx = getRunContext();
const evidenceDir = process.env.CVG_RUNTIME_DIR
  ? join(process.env.CVG_RUNTIME_DIR, 'sa-017')
  : join(ctx.repoRoot, 'docs', 'programa-triplo-aaa-2026-09-14', 'evidencias', 'SA-017');
mkdirSync(evidenceDir, { recursive: true });

const apiPort = ctx.ports.api;
const internalSecret = 'sa017-internal-events-secret-synthetic';
const password = 'Sa017-Senha!Forte';
const WORKER_ID = randomUUID();
const workerHealthPort = 9300 + ctx.workerIndex;

const report: Record<string, unknown> = {
  runId: ctx.runId,
  startedAt: new Date().toISOString(),
  checks: [] as Array<Record<string, unknown>>,
  failures: [] as string[],
};

function check(name: string, ok: boolean, detail: Record<string, unknown> = {}) {
  (report.checks as Array<Record<string, unknown>>).push({ name, ok, ...detail });
  if (!ok) (report.failures as string[]).push(name);
  console.log(`[sa017] ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number, intervalMs = 300): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await delay(intervalMs);
  }
  return false;
}

function spawnProcess(command: string, args: string[], env: NodeJS.ProcessEnv, logFile: string): ChildProcess {
  const logFd = openSync(logFile, 'a');
  return spawn(command, args, { cwd: ctx.repoRoot, detached: true, env, stdio: ['ignore', logFd, logFd] });
}

function stopGroup(child: ChildProcess | null) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* já encerrado */ }
  setTimeout(() => {
    try { process.kill(-(child.pid as number), 'SIGKILL'); } catch { /* já encerrado */ }
  }, 1500).unref();
}

async function runScheduler(nowIso: string, logLabel: string): Promise<{ ok: boolean; created: number; deduplicated: number; failed: number; raw: string }> {
  const logFile = join(evidenceDir, `${logLabel}.log`);
  return await new Promise((resolve) => {
    const child = spawnProcess(
      'pnpm',
      ['exec', 'tsx', 'scripts/production/sla-scan.ts', '--now', nowIso],
      { ...process.env, DATABASE_URL: ctx.databaseUrl, NODE_ENV: 'test' },
      logFile,
    );
    child.on('exit', (code) => {
      // O stdio vai para arquivo (fd), então a saída é lida do log do run.
      let stdout = '';
      try { stdout = readFileSync(logFile, 'utf8'); } catch { /* sem log */ }
      let parsed: { ok?: boolean; created?: unknown[]; failed?: unknown[] } = {};
      try {
        const jsonLine = stdout.trim().split('\n').reverse().find((line) => line.trim().startsWith('{')) ?? '{}';
        parsed = JSON.parse(jsonLine);
      } catch { /* saída não-JSON */ }
      const entries = (parsed.created ?? []) as Array<{ deduplicated?: boolean }>;
      resolve({
        ok: code === 0 && parsed.ok === true,
        created: entries.length,
        deduplicated: entries.filter((entry) => entry.deduplicated === true).length,
        failed: parsed.failed?.length ?? 0,
        raw: stdout.slice(-800),
      });
    });
  });
}

function runSchedulerConcurrently(nowIso: string[], logLabel: string): Promise<Array<{ ok: boolean; created: number; deduplicated: number; failed: number; raw: string }>> {
  return Promise.all(nowIso.map((iso, index) => runScheduler(iso, `${logLabel}-${index}`)));
}

async function fetchJson(url: string, init: RequestInit = {}) {
  try {
    const response = await fetch(url, init);
    const text = await response.text();
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status, body: body as Record<string, unknown> };
  } catch (error) {
    return { status: 0, body: String(error) as unknown as Record<string, unknown> };
  }
}

const WINDOW_MS = 15 * 60 * 1000;
let db: pg.Client | null = null;
let api: ChildProcess | null = null;
let worker: ChildProcess | null = null;
let provisioned = false;

async function main() {
  try {
    const env = await provisionIsolatedEnv(ctx);
    provisioned = true;
    report.isolatedEnv = { databaseName: env.databaseName, databasePort: env.databasePort, marker: env.marker };

    const migrate = spawn('pnpm', ['--filter', '@cvg/database', 'db:migrate'], {
      cwd: ctx.repoRoot, env: { ...process.env, DATABASE_URL: ctx.databaseUrl }, encoding: 'utf8',
    });
    await new Promise((resolve) => migrate.on('exit', resolve));
    check('migrations_aplicadas', migrate.exitCode === 0, { exit: migrate.exitCode });

    db = new pg.Client({ connectionString: ctx.databaseUrl });
    db.on('error', () => undefined);
    await db.connect();

    // ---- Fixture congelada dos cenários de alerta -------------------------
    const now = new Date('2026-09-15T12:00:00.000Z');
    const unassignedConv = randomUUID();
    const unansweredConv = randomUUID();
    const overdueTask = randomUUID();
    const healthyConv = randomUUID();
    const user = randomUUID();
    const role = randomUUID();
    await db.query("INSERT INTO roles (id, name) VALUES ($1, $2)", [role, `sa017-role-${ctx.runId}`]);
    for (const permission of ['alerts:read', 'alerts:write']) {
      await db.query('INSERT INTO permissions (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [permission]);
      await db.query(
        'INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE name = $2 ON CONFLICT DO NOTHING',
        [role, permission],
      );
    }
    const bcrypt = (await import('node:module')).createRequire(join(ctx.repoRoot, 'packages/database/package.json'))('bcryptjs') as { hash(data: string, salt: number): Promise<string> };
    await db.query(
      "INSERT INTO users (id, name, email, password_hash, is_active) VALUES ($1,'SA017 Operador',$2,$3,true)",
      [user, `sa017-${ctx.runId}@example.com`, await bcrypt.hash(password, 4)],
    );
    await db.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)', [user, role]);
    await db.query(
      "INSERT INTO conversations (id,status,status_v2,current_handler,is_active,created_at,assigned_user_id) VALUES ($1,'open','novo','bot',true,$2,NULL), ($3,'open','novo','bot',true,$4,$5), ($6,'open','novo','bot',true,$4,$5)",
      [unassignedConv, new Date(now.getTime() - 11 * 60 * 1000), unansweredConv, new Date(now.getTime() - 60_000), user, healthyConv],
    );
    await db.query(
      "INSERT INTO messages (conversation_id,direction,content,created_at) VALUES ($1,'inbound','sem resposta',$2), ($3,'inbound','respondida',$4), ($3,'outbound','ok',$5)",
      [unansweredConv, new Date(now.getTime() - 16 * 60 * 1000), healthyConv, new Date(now.getTime() - 16 * 60 * 1000), new Date(now.getTime() - 60_000)],
    );
    await db.query(
      "INSERT INTO tasks (id,title,status,due_at,created_by) VALUES ($1,'SA017 vencida','pending',$2,$3)",
      [overdueTask, new Date(now.getTime() - 5 * 60 * 1000), user],
    );

    const alertCount = async () => Number((await db!.query("SELECT count(*)::int AS n FROM alerts WHERE title IN ('Conversa sem responsável','Conversa sem resposta','Tarefa vencida')")).rows[0].n);
    const alertIdsForRule = async (rule: string) => (await db!.query(
      "SELECT id FROM alerts WHERE metadata LIKE $1",
      [`%\"slaRule\":\"${rule}\"%`],
    )).rows.map((row) => row.id);
    const alertsForRule = async (rule: string) => Number((await db!.query(
      "SELECT count(*)::int AS n FROM alerts WHERE metadata LIKE $1",
      [`%\"slaRule\":\"${rule}\"%`],
    )).rows[0].n);

    // ---- 1) Agendador REAL: primeira varredura cria os três alertas --------
    const first = await runScheduler(now.toISOString(), 'scheduler-1');
    check('agendador_cria_alertas', first.ok && first.created === 3 && first.failed === 0, first);
    check('alertas_por_regra', (await alertsForRule('conversation.unassigned')) === 1
      && (await alertsForRule('conversation.unanswered')) === 1
      && (await alertsForRule('task.overdue')) === 1,
    { unassigned: await alertsForRule('conversation.unassigned'), unanswered: await alertsForRule('conversation.unanswered'), overdue: await alertsForRule('task.overdue') });
    check('sem_falso_positivo', (await db.query('SELECT count(*)::int AS n FROM alerts WHERE conversation_id = $1', [healthyConv])).rows[0].n === 0);

    // ---- 2) Mesma janela: idempotente (sem novas linhas/eventos) ----------
    const before = await alertCount();
    const eventsBefore = Number((await db.query('SELECT count(*)::int AS n FROM alert_events')).rows[0].n);
    const outboxBefore = Number((await db.query("SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'alert.created'")).rows[0].n);
    const second = await runScheduler(now.toISOString(), 'scheduler-2');
    check('mesma_janela_deduplica',
      second.ok && second.deduplicated === 3 && (await alertCount()) === before,
      { deduplicated: second.deduplicated, before, after: await alertCount() });
    check('replay_nao_gera_eventos',
      Number((await db.query('SELECT count(*)::int AS n FROM alert_events')).rows[0].n) === eventsBefore
      && Number((await db.query("SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'alert.created'")).rows[0].n) === outboxBefore,
      { eventsBefore, outboxBefore });
    const unassignedIds = await alertIdsForRule('conversation.unassigned');
    const windowCounts = Number((await db.query(
      "SELECT count(*)::int AS n FROM alerts WHERE metadata LIKE '%conversation.unassigned%'",
    )).rows[0].n);
    check('uma_linha_por_regra_entidade_janela', unassignedIds.length === 1 && windowCounts === 1, { unassignedIds, windowCounts });

    // ---- 3) Janela seguinte com alerta ATIVO: guarda ativa evita poluição --
    const nextWindow = new Date(now.getTime() + WINDOW_MS + 1000);
    const third = await runScheduler(nextWindow.toISOString(), 'scheduler-3');
    check('janela_seguinte_com_ativo_nao_duplica', third.ok && third.deduplicated === 3 && (await alertCount()) === before, third);

    // Resolve os três alertas ativos: a condição persiste e a próxima janela
    // deve gerar NOVOS alertas (comportamento intencional e documentado).
    await db.query("UPDATE alerts SET status = 'resolved', resolved_at = now() WHERE status = 'active' AND metadata LIKE '%slaRule%'");
    const window4 = new Date(now.getTime() + 2 * (WINDOW_MS + 1000));
    const fourth = await runScheduler(window4.toISOString(), 'scheduler-4');
    check('pos_resolucao_nova_janela_gera_novo_alerta', fourth.ok && fourth.created === 3 && (await alertCount()) === before + 3, fourth);
    const ids = (await db.query("SELECT id FROM alerts WHERE title IN ('Conversa sem responsável','Conversa sem resposta','Tarefa vencida')")).rows.map((row) => row.id);
    check('sem_duplicata_de_id', new Set(ids).size === ids.length, { total: ids.length });

    // ---- 4) Dois agendadores concorrentes na MESMA janela ------------------
    await db.query("UPDATE alerts SET status = 'resolved', resolved_at = now() WHERE status = 'active' AND metadata LIKE '%slaRule%'");
    const window5 = new Date(now.getTime() + 3 * (WINDOW_MS + 1000));
    const beforeConcurrent = await alertCount();
    const concurrent = await runSchedulerConcurrently([window5.toISOString(), window5.toISOString()], 'scheduler-concurrent');
    const createdTotal = concurrent.reduce((total, entry) => total + entry.created, 0);
    const dedupTotal = concurrent.reduce((total, entry) => total + entry.deduplicated, 0);
    check('agendadores_concorrentes_sem_duplicata',
      concurrent.every((entry) => entry.ok) && (await alertCount()) === beforeConcurrent + 3,
      { createdTotal, dedupTotal, beforeConcurrent, after: await alertCount() });

    // ---- 4b) Modo AGENDADOR RESIDENTE (--loop) ----------------------------
    await db.query("UPDATE alerts SET status = 'resolved', resolved_at = now() WHERE status = 'active' AND metadata LIKE '%slaRule%'");
    const loopLog = join(evidenceDir, 'scheduler-loop.log');
    const loopProcess = spawnProcess('pnpm', ['exec', 'tsx', 'scripts/production/sla-scan.ts', '--loop', '--interval-ms', '700'], {
      ...process.env, DATABASE_URL: ctx.databaseUrl, NODE_ENV: 'test',
    }, loopLog);
    const loopRan = await waitFor(async () => {
      const text = (() => { try { return readFileSync(loopLog, 'utf8'); } catch { return ''; } })();
      return (text.match(/"iterationAt"/g) ?? []).length >= 3;
    }, 30_000, 300);
    const loopAlerts = Number((await db.query("SELECT count(*)::int AS n FROM alerts WHERE status = 'active' AND metadata LIKE '%slaRule%'")).rows[0].n);
    stopGroup(loopProcess);
    await delay(1200);
    check('agendador_residente_roda_e_nao_duplica', loopRan && loopAlerts === 3, { loopRan, loopAlerts });

    // ---- 5) WORKER real: alerta criado a partir de evento de outbox --------
    const workerLog = join(evidenceDir, 'message-worker.log');
    worker = spawnProcess('pnpm', ['--filter', '@cvg/message-worker', 'exec', 'tsx', 'src/index.ts'], {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: ctx.databaseUrl,
      REDIS_URL: ctx.redisUrl,
      USE_DATABASE_OUTBOX: 'true',
      WORKER_HEALTH_PORT: String(workerHealthPort),
      GATEWAY_BASE_URL: 'http://127.0.0.1:1',
      WORKER_MAX_RETRIES: '2',
      LOG_LEVEL: 'info',
    }, workerLog);
    const workerAlive = await waitFor(async () => {
      const probe = await fetchJson(`http://127.0.0.1:${workerHealthPort}/health`);
      return probe.status === 200;
    }, 60_000);
    check('worker_vivo', workerAlive);

    const handoffEventId = `sa017-handoff-${ctx.runId}`;
    const handoffConversation = randomUUID();
    await db.query(
      "INSERT INTO conversations (id,status,status_v2,current_handler,is_active) VALUES ($1,'open','em_atendimento','human',true)",
      [handoffConversation],
    );
    await db.query(
      "INSERT INTO outbox_events (event_id,event_type,event_version,aggregate_type,aggregate_id,occurred_at,payload,version) VALUES ($1,'handoff.completed',1,'Conversation',$2,now(),$3,1) ON CONFLICT (event_id) DO NOTHING",
      [handoffEventId, handoffConversation, JSON.stringify({ conversationId: handoffConversation, previousHandler: 'bot', newHandler: 'human', reason: 'sa017-handoff' })],
    );
    const workerCreated = await waitFor(async () => {
      const rows = (await db!.query("SELECT id FROM alerts WHERE conversation_id = $1 AND type = 'handoff'", [handoffConversation])).rows;
      return rows.length === 1;
    }, 60_000, 500);
    check('worker_real_cria_alerta_de_handoff', workerCreated, {
      alerts: (await db.query('SELECT id, type FROM alerts WHERE conversation_id = $1', [handoffConversation])).rows,
    });
    const ack = await waitFor(async () => {
      const rows = (await db!.query("SELECT processed_at FROM outbox_consumer_acks WHERE event_id = $1 AND consumer_id = 'worker'", [handoffEventId])).rows;
      return rows.length === 1 && rows[0].processed_at !== null;
    }, 30_000, 300);
    check('worker_ack_do_evento', ack);
    // Replay REAL: remove o ACK do consumidor mantendo o recibo de efeito e o
    // evento; o worker deve reprocessar, e o recibo durável devolve o MESMO
    // alerta sem duplicar linhas/eventos/auditoria.
    const alertIdHash = (await db.query('SELECT id FROM alerts WHERE conversation_id = $1', [handoffConversation])).rows[0]?.id;
    const alertEventCountBefore = Number((await db.query('SELECT count(*)::int AS n FROM alert_events WHERE alert_id = $1', [alertIdHash])).rows[0].n);
    await db.query("DELETE FROM outbox_consumer_acks WHERE event_id = $1 AND consumer_id = 'worker'", [handoffEventId]);
    const reAck = await waitFor(async () => {
      const rows = (await db!.query("SELECT processed_at FROM outbox_consumer_acks WHERE event_id = $1 AND consumer_id = 'worker'", [handoffEventId])).rows;
      return rows.length === 1 && rows[0].processed_at !== null;
    }, 60_000, 500);
    const alertsAfterReplay = (await db.query('SELECT id FROM alerts WHERE conversation_id = $1', [handoffConversation])).rows;
    const receipts = (await db.query('SELECT result_ref FROM worker_effect_receipts WHERE event_id = $1', [handoffEventId])).rows;
    const alertEventCountAfter = Number((await db.query('SELECT count(*)::int AS n FROM alert_events WHERE alert_id = $1', [alertIdHash])).rows[0].n);
    check('worker_replay_real_nao_duplica',
      reAck && alertsAfterReplay.length === 1 && alertsAfterReplay[0].id === alertIdHash
      && receipts.length === 1 && receipts[0].result_ref === alertIdHash
      && alertEventCountAfter === alertEventCountBefore,
      { reAck, alertsAfterReplay, receipts, alertEventCountBefore, alertEventCountAfter });

    // ---- 6) HTTP real: CAS concorrente ack/resolve com trilha --------------
    const apiLog = join(evidenceDir, 'desk-api.log');
    api = spawnProcess('pnpm', ['--filter', '@cvg/desk-api', 'exec', 'tsx', 'src/index.ts'], {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: ctx.databaseUrl,
      REDIS_URL: ctx.redisUrl,
      PORT: String(apiPort),
      JWT_SECRET: 'sa017-synthetic-jwt-secret',
      INTERNAL_EVENTS_SECRET: internalSecret,
      USE_DATABASE_OUTBOX: 'true',
      RATE_LIMIT_MAX: '100000',
      LOG_LEVEL: 'info',
    }, apiLog);
    const apiUp = await waitFor(async () => (await fetchJson(`http://127.0.0.1:${apiPort}/health`)).status === 200, 90_000);
    check('desk_api_pronta', apiUp);

    const login = await fetchJson(`http://127.0.0.1:${apiPort}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `sa017-${ctx.runId}@example.com`, password }),
    });
    check('login_operador', login.status === 200, { status: login.status });
    const token = String((login.body as { token?: string }).token ?? '');

    const [activeAlert] = (await db.query(
      "SELECT id FROM alerts WHERE title = 'Conversa sem resposta' AND status = 'active' ORDER BY created_at LIMIT 1",
    )).rows;
    const payload = JSON.stringify({ expectedStatus: 'active' });
    const [ackCall, resolveCall] = await Promise.all([
      fetchJson(`http://127.0.0.1:${apiPort}/alerts/${activeAlert.id}/acknowledge`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ expectedStatus: 'active' }) }),
      fetchJson(`http://127.0.0.1:${apiPort}/alerts/${activeAlert.id}/resolve`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: payload }),
    ]);
    const statuses = [ackCall.status, resolveCall.status].sort((a, b) => a - b);
    check('cas_concorrente_um_vence', statuses[0] === 200 && statuses[1] === 409, { statuses });
    const events = (await db.query("SELECT event_type, old_value FROM alert_events WHERE alert_id = $1", [activeAlert.id])).rows
      .filter((row) => row.event_type === 'acknowledged' || row.event_type === 'resolved');
    check('trilha_unica_com_estado_anterior_correto', events.length === 1 && events[0].old_value === 'active', { events });
    const audits = (await db.query("SELECT action, old_value FROM audit_logs WHERE entity_type = 'alert' AND entity_id = $1", [activeAlert.id])).rows
      .filter((row) => row.action === 'alert.acknowledged' || row.action === 'alert.resolved');
    check('auditoria_unica', audits.length === 1 && JSON.parse(audits[0].old_value ?? '{}').status === 'active', { audits });
    // Sequência estrita e determinística: ack (active) → resolve → ack (409).
    // Gera uma janela nova para ter alertas ATIVOS frescos (o teste concorrente
    // consumiu o anterior) e escolhe a conversa atribuída ao operador.
    await db.query("UPDATE alerts SET status = 'resolved', resolved_at = now() WHERE status = 'active' AND metadata LIKE '%slaRule%'");
    const strictWindow = new Date(now.getTime() + 6 * (WINDOW_MS + 1000));
    await runScheduler(strictWindow.toISOString(), 'scheduler-strict');
    const [strictAlert] = (await db.query(
      "SELECT id FROM alerts WHERE status = 'active' AND title = 'Conversa sem resposta' ORDER BY created_at LIMIT 1",
    )).rows;
    if (strictAlert) {
      const strictAck = await fetchJson(`http://127.0.0.1:${apiPort}/alerts/${strictAlert.id}/acknowledge`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ expectedStatus: 'active' }) });
      const strictResolve = await fetchJson(`http://127.0.0.1:${apiPort}/alerts/${strictAlert.id}/resolve`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ expectedStatus: 'acknowledged' }) });
      const ackAfterResolve = await fetchJson(`http://127.0.0.1:${apiPort}/alerts/${strictAlert.id}/acknowledge`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
      const trail = (await db.query("SELECT event_type FROM alert_events WHERE alert_id = $1 AND event_type IN ('acknowledged','resolved') ORDER BY created_at", [strictAlert.id])).rows;
      check('sequencia_estrita_ack_resolve_ack409',
        strictAck.status === 200 && strictResolve.status === 200 && ackAfterResolve.status === 409
        && trail.length === 2,
        { strictAck: strictAck.status, strictResolve: strictResolve.status, ackAfterResolve: ackAfterResolve.status, trail });
    } else {
      check('sequencia_estrita_ack_resolve_ack409', false, { reason: 'sem alerta ativo para a sequencia estrita' });
    }
  } catch (error) {
    (report.failures as string[]).push(`fatal: ${String(error)}`);
    console.error('[sa017] fatal:', error);
  } finally {
    stopGroup(worker);
    stopGroup(api);
    try { await db?.end(); } catch { /* já encerrado */ }
    if (provisioned) report.teardown = teardownIsolatedEnv(ctx, { stopServices: true, dropDatabase: true });
    report.finishedAt = new Date().toISOString();
    report.result = (report.failures as string[]).length === 0 ? 'PASS' : 'FAIL';
    writeFileSync(join(evidenceDir, 'sa-017-alerts-worker.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[sa017] ${report.result}`);
    process.exit(report.result === 'PASS' ? 0 : 1);
  }
}

void main();
