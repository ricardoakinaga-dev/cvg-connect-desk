// SA-009/AC2/AC3 — boot da IMAGEM realtime contra PostgreSQL/Redis isolados.
//
// Uso: pnpm exec tsx scripts/production/sa-009-realtime-boot.ts [--skip-build]
//
// Fluxo:
//  1. build da imagem por identidade (id sha256 do docker);
//  2. provisiona PG/Redis exclusivos do run (SA-003) e migra;
//  3. sobe o container com --network host apontando para as portas exclusivas;
//  4. prove /health e /readiness (poller database com sucesso);
//  5. insere evento de outbox e prova consumo/ack (exatamente uma geração);
//  6. derruba o PG: readiness degrada para 503 (fail-closed);
//  7. religa o PG: readiness recupera sem perda nem duplicação;
//  8. nega subscrição WS sem autenticação;
//  9. encerra APENAS o container e o ambiente do próprio run.
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, openSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { getRunContext } from '../../e2e/support/aaa/run-context.ts';
import { provisionIsolatedEnv, teardownIsolatedEnv } from '../../e2e/support/aaa/isolated-env.ts';
import { startPostgres, stopPostgres } from '../../e2e/support/aaa/pg.ts';

const skipBuild = process.argv.includes('--skip-build');
const ctx = getRunContext();
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const evidenceDir = process.env.CVG_RUNTIME_DIR
  ? join(process.env.CVG_RUNTIME_DIR, 'sa-009')
  : join(ctx.repoRoot, 'docs', 'programa-triplo-aaa-2026-09-14', 'evidencias', 'SA-009');
mkdirSync(evidenceDir, { recursive: true });

const imageTag = `cvg-aaa-sa009-realtime:${ctx.runId}`;
const containerName = `cvg-aaa-sa009-${ctx.runId}`;
const realtimePort = ctx.ports.realtime;
const internalSecret = 'sa009-internal-events-secret-synthetic';
const metricsToken = 'sa009-metrics-token-synthetic';

const report: Record<string, unknown> = {
  runId: ctx.runId,
  revision,
  imageTag,
  containerName,
  realtimePort,
  startedAt: new Date().toISOString(),
  checks: [] as Array<Record<string, unknown>>,
  failures: [] as string[],
};

function check(name: string, ok: boolean, detail: Record<string, unknown> = {}) {
  report.checks.push({ name, ok, ...detail });
  if (!ok) (report.failures as string[]).push(name);
  console.log(`[sa009] ${ok ? 'PASS' : 'FAIL'} ${name}`);
}

function run(command: string, args: string[], options: Record<string, unknown> = {}) {
  return spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
}

async function fetchJson(url: string, timeoutMs = 3000): Promise<{ status: number; body: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body: body as Record<string, unknown> };
  } catch {
    return { status: 0, body: {} };
  } finally {
    clearTimeout(timer);
  }
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number, intervalMs = 500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await delay(intervalMs);
  }
  return false;
}

async function main() {
  let provisioned = false;
  let containerStarted = false;
  try {
    if (!skipBuild) {
      const build = run('docker', ['build', '-f', 'apps/realtime-service/Dockerfile', '-t', imageTag, '.'], { cwd: ctx.repoRoot });
      check('build_imagem', build.status === 0, { exit: build.status, stderr: (build.stderr ?? '').slice(-400) });
      if (build.status !== 0) throw new Error('build falhou');
    }
    const imageId = run('docker', ['inspect', '--format', '{{.Id}}', imageTag]).stdout?.trim();
    report.imageId = imageId;
    check('imagem_identificada', Boolean(imageId && imageId.startsWith('sha256:')));

    const env = await provisionIsolatedEnv(ctx);
    provisioned = true;
    report.databaseUrl = ctx.databaseUrl;
    report.redisUrl = ctx.redisUrl;

    const migrate = run('pnpm', ['--filter', '@cvg/database', 'db:types'], {
      cwd: ctx.repoRoot, env: { ...process.env, DATABASE_URL: ctx.databaseUrl },
    });
    check('db_types', migrate.status === 0, { exit: migrate.status });
    const migration = run('pnpm', ['--filter', '@cvg/database', 'db:migrate'], {
      cwd: ctx.repoRoot, env: { ...process.env, DATABASE_URL: ctx.databaseUrl },
    });
    check('db_migrate', migration.status === 0, { exit: migration.status, tail: (migration.stdout ?? '').slice(-200) });
    if (migration.status !== 0) throw new Error('migrate falhou');

    // 1) Config ausente falha cedo: container sem DATABASE_URL deve morrer.
    const missing = run('docker', ['run', '--rm', '--network', 'host', '-e', 'NODE_ENV=production',
      '-e', `REALTIME_PORT=${realtimePort}`, '-e', `REDIS_URL=${ctx.redisUrl}`,
      '-e', `INTERNAL_EVENTS_SECRET=${internalSecret}`, '-e', `METRICS_TOKEN=${metricsToken}`, imageTag]);
    const missingOutput = `${missing.stdout ?? ''}${missing.stderr ?? ''}`;
    check('config_ausente_falha_cedo', missing.status !== 0 && missingOutput.includes('DATABASE_URL ausente'), {
      exit: missing.status,
      noSecret: !/postgresql:\/\/[^:]+:[^@]+@/.test(missingOutput),
    });

    // 1b) Desk API real no banco isolado: o realtime valida tokens via
    // `/auth/me`, então a subscrição POSITIVA depende deste serviço.
    const apiPort = ctx.ports.api;
    const apiLog = openSync(join(evidenceDir, 'sa-009-desk-api.log'), 'a');
    const apiProcess = spawn('pnpm', ['--filter', '@cvg/desk-api', 'exec', 'tsx', 'src/index.ts'], {
      cwd: ctx.repoRoot,
      detached: true,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: ctx.databaseUrl,
        REDIS_URL: ctx.redisUrl,
        PORT: String(apiPort),
        JWT_SECRET: 'sa009-synthetic-jwt-secret',
        INTERNAL_EVENTS_SECRET: internalSecret,
        USE_DATABASE_OUTBOX: 'true',
        LOG_LEVEL: 'warn',
      },
      stdio: ['ignore', apiLog, apiLog],
    });
    report.apiPid = apiProcess.pid ?? null;
    const apiUp = await waitFor(async () => (await fetchJson(`http://127.0.0.1:${apiPort}/health`)).status === 200, 90_000);
    check('desk_api_real_pronta', apiUp, { apiPort });

    // 2) Boot com configuração completa. Remove apenas um container homônimo
    // DO PRÓPRIO RUN (execução anterior interrompida), nunca outro nome.
    run('docker', ['rm', '-f', containerName]);
    const start = run('docker', ['run', '-d', '--name', containerName, '--network', 'host',
      '-e', 'NODE_ENV=production',
      '-e', `DATABASE_URL=${ctx.databaseUrl}`,
      '-e', `REDIS_URL=${ctx.redisUrl}`,
      '-e', `REALTIME_PORT=${realtimePort}`,
      '-e', 'USE_DATABASE_OUTBOX=true',
      '-e', `DESK_API_URL=http://127.0.0.1:${apiPort}`,
      '-e', 'REALTIME_POLL_INTERVAL_MS=300',
      '-e', `INTERNAL_EVENTS_SECRET=${internalSecret}`,
      '-e', `METRICS_TOKEN=${metricsToken}`,
      '-e', `OTEL_ENABLED=false`,
      imageTag]);
    check('container_iniciado', start.status === 0, { exit: start.status, stderr: (start.stderr ?? '').slice(-300) });
    if (start.status !== 0) throw new Error('container não iniciou');
    containerStarted = true;

    const health = await waitFor(async () => (await fetchJson(`http://127.0.0.1:${realtimePort}/health`)).status === 200, 60_000);
    check('health_ok', health, { last: await fetchJson(`http://127.0.0.1:${realtimePort}/health`) });
    if (!health) {
      const logs = run('docker', ['logs', '--tail', '60', containerName]);
      report.containerLogs = `${logs.stdout ?? ''}${logs.stderr ?? ''}`.slice(-4000);
    }

    const ready = await waitFor(async () => {
      const result = await fetchJson(`http://127.0.0.1:${realtimePort}/readiness`);
      return result.status === 200 && result.body.ready === true;
    }, 60_000);
    const readySnapshot = await fetchJson(`http://127.0.0.1:${realtimePort}/readiness`);
    check('readiness_ok_com_banco', ready, { body: readySnapshot.body });
    const pollerMode = (readySnapshot.body.checks as Record<string, any> | undefined)?.poller?.mode;
    check('poller_modo_database', pollerMode === 'database', { pollerMode });

    // 3) Evento de outbox consumido e ackado uma única vez.
    const client = new pg.Client({ connectionString: ctx.databaseUrl });
    // O desligamento proposital do PG emite 57P01; tratamos como transição
    // esperada do ensaio, não como falha do processo.
    client.on('error', (error) => {
      console.warn(`[sa009] pg client error esperado durante o ensaio: ${String(error).slice(0, 120)}`);
    });
    await client.connect();
    const eventId = `sa009-${ctx.runId}-evt`;
    await client.query(
      `INSERT INTO outbox_events (event_id, event_type, event_version, aggregate_type, aggregate_id, occurred_at, payload, version)
       VALUES ($1, 'conversation.status.changed', 1, 'Conversation', $2, now(), $3, 1)
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, `sa009-${ctx.runId}-agg`, JSON.stringify({ conversationId: `sa009-${ctx.runId}-agg`, previousStatus: 'novo', newStatus: 'em_atendimento' })],
    );

    const consumed = await waitFor(async () => {
      const { rows } = await client.query(
        `SELECT processed_at, generation, retry_count FROM outbox_consumer_acks WHERE event_id = $1 AND consumer_id = 'realtime'`,
        [eventId],
      );
      return rows.length === 1 && rows[0].processed_at !== null;
    }, 60_000, 300);
    const ackRows = await client.query(
      `SELECT processed_at, generation, retry_count FROM outbox_consumer_acks WHERE event_id = $1 AND consumer_id = 'realtime'`,
      [eventId],
    );
    check('evento_consumido_e_ackado', consumed, { rows: ackRows.rows });
    check('ack_unico', ackRows.rows.length === 1 && Number(ackRows.rows[0].generation) === 1, { rows: ackRows.rows });

    // 3b) Autenticação POSITIVA e autorização por entrega na imagem entregue.
    const wsUserId = randomUUID();
    const roleId = randomUUID();
    const sectorAId = randomUUID();
    const sectorBId = randomUUID();
    const conversationAId = randomUUID();
    const conversationBId = randomUUID();
    const wsToken = `sa009-ws-${ctx.runId}-${randomUUID()}`;
    const tokenHash = createHash('sha256').update(wsToken, 'utf8').digest('hex');
    await client.query("INSERT INTO roles(id,name) VALUES($1,$2)", [roleId, `sa009-role-${ctx.runId}`]);
    await client.query(
      'INSERT INTO permissions(name) VALUES($1) ON CONFLICT (name) DO NOTHING',
      ['chat:read'],
    );
    await client.query(
      "INSERT INTO role_permissions(role_id,permission_id) SELECT $1, id FROM permissions WHERE name='chat:read' ON CONFLICT DO NOTHING",
      [roleId],
    );
    await client.query(
      "INSERT INTO users(id,name,email,password_hash,is_active) VALUES($1,'SA009 WS',$2,'x',true)",
      [wsUserId, `sa009-ws-${ctx.runId}@example.com`],
    );
    await client.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [wsUserId, roleId]);
    await client.query(
      "INSERT INTO sectors(id,name,code,is_active) VALUES($1,$2,$3,true)",
      [sectorAId, `SA009 A ${ctx.runId}`, `sa009a-${ctx.runId}`],
    );
    await client.query(
      "INSERT INTO sectors(id,name,code,is_active) VALUES($1,$2,$3,true)",
      [sectorBId, `SA009 B ${ctx.runId}`, `sa009b-${ctx.runId}`],
    );
    await client.query(
      "INSERT INTO user_sectors(user_id,sector_id,access_level) VALUES($1,$2,'write')",
      [wsUserId, sectorAId],
    );
    await client.query(
      "INSERT INTO conversations(id,status,status_v2,current_handler,is_active,sector_id,assigned_user_id) VALUES($1,'open','novo','bot',true,$2,$3)",
      [conversationAId, sectorAId, wsUserId],
    );
    await client.query(
      "INSERT INTO conversations(id,status,status_v2,current_handler,is_active,sector_id) VALUES($1,'open','novo','bot',true,$2)",
      [conversationBId, sectorBId],
    );
    await client.query(
      'INSERT INTO sessions(user_id,token,token_hash,expires_at,last_seen_at,absolute_expires_at) VALUES($1,$2,$2,now() + interval \'1 hour\', now(), now() + interval \'8 hours\')',
      [wsUserId, tokenHash],
    );

    const wsTranscript: string[] = [];
    const wsOutcome = await new Promise<{ subscribedA: boolean; deniedB: boolean; delivered: boolean; detail: string }>(async (resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${realtimePort}`);
      const result = { subscribedA: false, deniedB: false, delivered: false, detail: '' };
      const finish = (detail: string) => {
        try { socket.close(); } catch { /* já fechado */ }
        resolve({ ...result, detail });
      };
      const timer = setTimeout(() => finish('timeout'), 30_000);
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'auth', token: wsToken }));
      });
      socket.addEventListener('message', (event: MessageEvent) => {
        const payload = typeof event.data === 'string' ? event.data : '';
        wsTranscript.push(payload.slice(0, 300));
        if (wsTranscript.length > 40) wsTranscript.shift();
        try {
          const parsed = JSON.parse(payload) as { event?: string; data?: { payload?: { channel?: string } } };
          if (parsed.event === 'auth.success') {
            socket.send(JSON.stringify({ type: 'subscribe', channel: `conversation:${conversationAId}` }));
            socket.send(JSON.stringify({ type: 'subscribe', channel: `conversation:${conversationBId}` }));
          }
          if (parsed.event === 'subscribed' && parsed.data?.payload?.channel === `conversation:${conversationAId}`) {
            result.subscribedA = true;
            // Evento de entrega para a conversa autorizada.
            void client.query(
              `INSERT INTO outbox_events (event_id, event_type, event_version, aggregate_type, aggregate_id, occurred_at, payload, version)
               VALUES ($1, 'conversation.status.changed', 1, 'Conversation', $2, now(), $3, 1) ON CONFLICT (event_id) DO NOTHING`,
              [`sa009-ws-${ctx.runId}-deliver`, conversationAId, JSON.stringify({ conversationId: conversationAId, previousStatus: 'novo', newStatus: 'em_atendimento' })],
            );
          }
          const innerType = (parsed.data as { type?: string } | undefined)?.type;
          const innerPayload = (parsed.data as { payload?: Record<string, unknown> } | undefined)?.payload;
          const isSubscribeError = parsed.event === 'error' || innerType === 'subscribe.error';
          const errorChannel = typeof innerPayload?.channel === 'string' ? innerPayload.channel : payload;
          if (isSubscribeError && errorChannel.includes(conversationBId)) {
            result.deniedB = true;
            result.detail = `negado: ${String(innerPayload?.error ?? 'erro')}`;
          }
          if (parsed.event === 'conversation.status.changed' || payload.includes('conversation.status.changed')) {
            result.delivered = true;
          }
          if (result.subscribedA && result.deniedB && result.delivered) {
            clearTimeout(timer);
            finish('ok');
          }
        } catch {
          // mensagem não-JSON: ignora para os guards abaixo
          if (payload.includes('Not authenticated')) result.detail = payload.slice(0, 120);
        }
      });
      socket.addEventListener('error', () => { clearTimeout(timer); finish(`socket error: ${result.detail}`); });
    });
    check('ws_auth_positiva_subscribe_autorizado', wsOutcome.subscribedA, { detail: wsOutcome.detail, transcript: wsTranscript.slice(-12) });
    check('ws_acesso_cruzado_recusado', wsOutcome.deniedB, { detail: wsOutcome.detail, transcript: wsTranscript.slice(-12) });
    check('ws_delivery_autorizada_recebida', wsOutcome.delivered, { detail: wsOutcome.detail, transcript: wsTranscript.slice(-12) });

    // 4) Banco indisponível: readiness degrada (fail-closed) e /health segue vivo.
    const pgStopped = stopPostgres(ctx, { dropDatabase: false });
    report.pgStopped = pgStopped;
    const degraded = await waitFor(async () => {
      const result = await fetchJson(`http://127.0.0.1:${realtimePort}/readiness`);
      return result.status === 503 && result.body.ready === false;
    }, 60_000, 500);
    const degradedSnapshot = await fetchJson(`http://127.0.0.1:${realtimePort}/readiness`);
    check('readiness_degrada_sem_banco', degraded, { body: degradedSnapshot.body });
    const stillAlive = (await fetchJson(`http://127.0.0.1:${realtimePort}/health`)).status === 200;
    check('health_continua_vivo', stillAlive);

    // 5) Recuperação: religa o banco e o poller volta sem perder/duplicar.
    startPostgres(ctx, revision);
    const recovered = await waitFor(async () => {
      const result = await fetchJson(`http://127.0.0.1:${realtimePort}/readiness`);
      return result.status === 200 && result.body.ready === true;
    }, 90_000, 500);
    check('readiness_recupera', recovered);
    let ackAfterRows: Array<Record<string, unknown>> = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const reader = new pg.Client({ connectionString: ctx.databaseUrl });
      reader.on('error', () => { /* conexão de leitura efêmera do ensaio */ });
      try {
        await reader.connect();
        const ackAfter = await reader.query(
          `SELECT processed_at, generation, retry_count FROM outbox_consumer_acks WHERE event_id = $1 AND consumer_id = 'realtime'`,
          [eventId],
        );
        ackAfterRows = ackAfter.rows;
        if (ackAfterRows.length === 1 && ackAfterRows[0].processed_at !== null) break;
      } catch {
        // banco ainda religando: tenta de novo com conexão nova
      } finally {
        try { await reader.end(); } catch { /* já encerrado */ }
      }
      await delay(500);
    }
    check('sem_duplicacao_apos_recuperacao', ackAfterRows.length === 1 && Number(ackAfterRows[0].generation) === 1, { rows: ackAfterRows });
    try { await client.end(); } catch { /* já encerrado */ }

    // 6) WS sem autenticação é recusado explicitamente.
    const wsResult = await new Promise<{ ok: boolean; detail: string }>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${realtimePort}`);
      const finish = (ok: boolean, detail: string) => {
        try { socket.close(); } catch { /* já fechado */ }
        resolve({ ok, detail });
      };
      const timer = setTimeout(() => finish(false, 'timeout'), 10_000);
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'subscribe', channel: 'conversation:sa009-nao-autenticado' }));
      });
      socket.addEventListener('message', (event: MessageEvent) => {
        const payload = typeof event.data === 'string' ? event.data : '';
        if (payload.includes('Not authenticated') || payload.includes('auth.error')) {
          clearTimeout(timer);
          finish(true, payload.slice(0, 200));
        }
      });
      socket.addEventListener('error', () => { clearTimeout(timer); finish(false, 'socket error'); });
    });
    check('ws_sem_auth_recusado', wsResult.ok, { detail: wsResult.detail });
  } catch (error) {
    report.fatal = String(error);
    (report.failures as string[]).push(`fatal: ${String(error)}`);
  } finally {
    if (containerStarted) {
      const rm = run('docker', ['rm', '-f', containerName]);
      report.containerRemoved = rm.status === 0;
    }
    if (report.apiPid) {
      try { process.kill(-(report.apiPid as number), 'SIGTERM'); } catch { /* já encerrado */ }
      report.apiStopped = true;
    }
    if (provisioned) {
      report.teardown = teardownIsolatedEnv(ctx, { stopServices: true, dropDatabase: true });
    }
    report.finishedAt = new Date().toISOString();
    report.result = (report.failures as string[]).length === 0 ? 'PASS' : 'FAIL';
    writeFileSync(join(evidenceDir, 'sa-009-boot.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[sa009] ${report.result}`);
    process.exit(report.result === 'PASS' ? 0 : 1);
  }
}

void main();
