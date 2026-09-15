// SA-012 — lifecycle de sessão provado em HTTP e WS NATIVOS.
//
// Uso: pnpm exec tsx scripts/production/sa-012-session-http-ws.ts
//
// Sobe, no PostgreSQL/Redis isolados do run, a desk-api e o realtime-service
// REAIS e prova:
//   HTTP: login, /auth/me, logout, rotação (token antigo morre), expiração
//         normal/absoluta/idle, conta desativada, troca de credencial revoga
//         sessões, armazenamento só com hash, logs sem token, sem enumeração
//         de contas e rate limit de login (instância dedicada).
//   WS:   autenticação real via /auth/me e encerramento por revogação
//         (logout, rotação, conta desativada, expiração) em ≤5s.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';
import pg from 'pg';
import { getRunContext } from '../../e2e/support/aaa/run-context.ts';
import { provisionIsolatedEnv, teardownIsolatedEnv } from '../../e2e/support/aaa/isolated-env.ts';

const ctx = getRunContext();
const revision = spawn('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
void revision;
const evidenceDir = process.env.CVG_RUNTIME_DIR
  ? join(process.env.CVG_RUNTIME_DIR, 'sa-012')
  : join(ctx.repoRoot, 'docs', 'programa-triplo-aaa-2026-09-14', 'evidencias', 'SA-012');
mkdirSync(evidenceDir, { recursive: true });

const apiPort = ctx.ports.api;
const apiLimitPort = ctx.ports.api + 1;
const realtimePort = ctx.ports.realtime;
const internalSecret = 'sa012-internal-events-secret-synthetic';
const metricsToken = 'sa012-metrics-token-synthetic';
const password = 'Sa012-Senha!Forte';

const report: Record<string, unknown> = {
  runId: ctx.runId,
  candidate: '754f9bad+worktree',
  startedAt: new Date().toISOString(),
  checks: [] as Array<Record<string, unknown>>,
  failures: [] as string[],
};

function check(name: string, ok: boolean, detail: Record<string, unknown> = {}) {
  (report.checks as Array<Record<string, unknown>>).push({ name, ok, ...detail });
  if (!ok) (report.failures as string[]).push(name);
  console.log(`[sa012] ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  try {
    const response = await fetch(url, init);
    const text = await response.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status, body };
  } catch (error) {
    return { status: 0, body: String(error) };
  }
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number, intervalMs = 300): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await delay(intervalMs);
  }
  return false;
}

function spawnServer(command: string, args: string[], env: NodeJS.ProcessEnv, logFile: string): ChildProcess {
  const logFd = openSync(logFile, 'a');
  const child = spawn(command, args, {
    cwd: ctx.repoRoot,
    detached: true,
    env,
    stdio: ['ignore', logFd, logFd],
  });
  return child;
}

function stopGroup(child: ChildProcess | null) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* já encerrado */ }
  setTimeout(() => {
    try { process.kill(-(child.pid as number), 'SIGKILL'); } catch { /* já encerrado */ }
  }, 1500).unref();
}

async function portFree(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port }, () => server.close(() => resolve(true)));
  });
}

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const requireFromDatabase = createRequire(join(ctx.repoRoot, 'packages', 'database', 'package.json'));
const bcrypt = requireFromDatabase('bcryptjs') as { hash(data: string, salt: number): Promise<string> };

const OWNER_ID = randomUUID();
const ADMIN_ID = randomUUID();
const roleId = randomUUID();
const permissionNames = ['chat:read', 'admin:read', 'admin:write'];
let apiMain: ChildProcess | null = null;
let apiLimit: ChildProcess | null = null;
let realtime: ChildProcess | null = null;
let provisioned = false;
let db: pg.Client | null = null;

async function login(email: string, secret: string, port = apiPort) {
  return fetchJson(`http://127.0.0.1:${port}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: secret }),
  });
}

async function me(token: string, port = apiPort) {
  return fetchJson(`http://127.0.0.1:${port}/auth/me`, { headers: { authorization: `Bearer ${token}` } });
}

type SqlValue = string | { raw: string };

async function insertSession(
  userId: string,
  overrides: Partial<Record<'last_seen_at' | 'expires_at' | 'absolute_expires_at', SqlValue>> = {},
): Promise<string> {
  const token = `sa012-${randomUUID()}`;
  const hash = sha256(token);
  const columns: Array<[string, SqlValue]> = [
    ['user_id', userId],
    ['token', hash],
    ['token_hash', hash],
    ['last_seen_at', { raw: 'now()' }],
    ['expires_at', { raw: "now() + interval '1 hour'" }],
    ['absolute_expires_at', { raw: "now() + interval '8 hours'" }],
  ];
  for (const [key, value] of Object.entries(overrides)) {
    const index = columns.findIndex(([name]) => name === key);
    if (index >= 0) columns[index] = [key, value as SqlValue];
  }
  const placeholders: string[] = [];
  const params: unknown[] = [];
  for (const [, value] of columns) {
    if (typeof value === 'object' && value !== null && 'raw' in value) {
      placeholders.push(value.raw);
    } else {
      params.push(value);
      placeholders.push(`$${params.length}`);
    }
  }
  await db!.query(
    `INSERT INTO sessions (${columns.map(([name]) => name).join(', ')}) VALUES (${placeholders.join(', ')})`,
    params,
  );
  return token;
}

async function connectWs(token: string, timeoutMs = 8000): Promise<{ ws: WebSocket; messages: string[]; closeInfo: { code: number | null; at: number } }> {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${realtimePort}`);
    const messages: string[] = [];
    const closeInfo: { code: number | null; at: number } = { code: null, at: 0 };
    const timer = setTimeout(() => reject(new Error('timeout aguardando auth.success')), timeoutMs);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'auth', token })));
    socket.addEventListener('message', (event: MessageEvent) => {
      const payload = typeof event.data === 'string' ? event.data : '';
      messages.push(payload.slice(0, 200));
      if (payload.includes('auth.success')) {
        clearTimeout(timer);
        resolve({ ws: socket, messages, closeInfo });
      }
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      closeInfo.code = event.code;
      closeInfo.at = Date.now();
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('ws error antes de autenticar'));
    });
  });
}

async function waitClose(
  ws: WebSocket,
  timeoutMs: number,
  closeInfo?: { code: number | null; at: number },
): Promise<{ closed: boolean; code: number | null; elapsedMs: number }> {
  const started = Date.now();
  for (let i = 0; i < Math.ceil(timeoutMs / 250); i += 1) {
    if (ws.readyState === WebSocket.CLOSED) {
      return {
        closed: true,
        code: closeInfo?.code ?? null,
        elapsedMs: closeInfo?.at ? Math.max(0, closeInfo.at - started) : Date.now() - started,
      };
    }
    await delay(250);
  }
  return { closed: false, code: closeInfo?.code ?? null, elapsedMs: Date.now() - started };
}

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

    // Fixture de RBAC + usuários + sessões.
    await db.query("INSERT INTO roles (id, name) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING", [roleId, `sa012-role-${ctx.runId}`]);
    const [role] = (await db.query('SELECT id FROM roles WHERE name = $1', [`sa012-role-${ctx.runId}`])).rows;
    for (const name of permissionNames) {
      await db.query('INSERT INTO permissions (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
      await db.query(
        'INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE name = $2 ON CONFLICT DO NOTHING',
        [role.id, name],
      );
    }
    const ownerHash = await bcrypt.hash(password, 4);
    await db.query(
      "INSERT INTO users (id, name, email, password_hash, is_active) VALUES ($1,'SA012 Owner',$2,$3,true), ($4,'SA012 Admin',$5,$3,true)",
      [OWNER_ID, `sa012-owner-${ctx.runId}@example.com`, ownerHash, ADMIN_ID, `sa012-admin-${ctx.runId}@example.com`],
    );
    await db.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2), ($3,$2)', [OWNER_ID, role.id, ADMIN_ID]);

    const apiLog = join(evidenceDir, 'desk-api.log');
    const limitLog = join(evidenceDir, 'desk-api-limit.log');
    const realtimeLog = join(evidenceDir, 'realtime.log');
    const baseEnv = {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: ctx.databaseUrl,
      REDIS_URL: ctx.redisUrl,
      JWT_SECRET: 'sa012-synthetic-jwt-secret',
      INTERNAL_EVENTS_SECRET: internalSecret,
      METRICS_TOKEN: metricsToken,
      USE_DATABASE_OUTBOX: 'true',
      LOG_LEVEL: 'info',
      RATE_LIMIT_MAX: '100000',
    };
    apiMain = spawnServer('pnpm', ['--filter', '@cvg/desk-api', 'exec', 'tsx', 'src/index.ts'],
      { ...baseEnv, PORT: String(apiPort), RATE_LIMIT_LOGIN_MAX: '100' }, apiLog);
    const apiUp = await waitFor(async () => (await fetchJson(`http://127.0.0.1:${apiPort}/health`)).status === 200, 90_000);
    check('desk_api_pronta', apiUp);

    // O realtime NÃO auto-inicia com NODE_ENV=test (guard do próprio serviço);
    // usamos development para exercitar o servidor real fora de produção.
    realtime = spawnServer('pnpm', ['--filter', '@cvg/realtime-service', 'exec', 'tsx', 'src/index.ts'],
      {
        ...baseEnv,
        NODE_ENV: 'development',
        REALTIME_PORT: String(realtimePort),
        DESK_API_URL: `http://127.0.0.1:${apiPort}`,
        REALTIME_AUTH_REVALIDATE_MS: '1000',
        REALTIME_POLL_INTERVAL_MS: '500',
      }, realtimeLog);
    realtime.on('error', (error) => console.error('[sa012] realtime spawn error:', error));
    realtime.on('exit', (code, signal) => console.error(`[sa012] realtime exit code=${code} signal=${signal}`));
    const realtimeUp = await waitFor(async () => (await fetchJson(`http://127.0.0.1:${realtimePort}/health`)).status === 200, 90_000);
    const realtimeLogText = readFileSync(realtimeLog, 'utf8').slice(-1500);
    check('realtime_pronto', realtimeUp, { port: realtimePort, log: realtimeLogText });

    // ---------- HTTP ----------
    const ownerEmail = `sa012-owner-${ctx.runId}@example.com`;
    const loginOk = await login(ownerEmail, password);
    check('login_valido_200', loginOk.status === 200 && Boolean(loginOk.body?.token));
    const token = String(loginOk.body?.token ?? '');
    check('login_emite_token', token.length > 20);
    const meOk = await me(token);
    check('auth_me_200', token.length > 20 && meOk.status === 200 && meOk.body?.user?.id === OWNER_ID);

    const stored = await db.query('SELECT token, token_hash FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [OWNER_ID]);
    check('armazenamento_apenas_hash',
      stored.rows.length === 1 && stored.rows[0].token === sha256(token) && stored.rows[0].token !== token,
      { tokenEqualsRaw: stored.rows[0]?.token === token });
    const apiLogText = readFileSync(apiLog, 'utf8');
    check('logs_sem_token', token.length > 20 && !apiLogText.includes(token), { tokenLeaked: apiLogText.includes(token) });

    await fetchJson(`http://127.0.0.1:${apiPort}/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    const afterLogout = await me(token);
    check('logout_invalida_token', token.length > 20 && afterLogout.status === 401);

    // Rotação.
    const rotateLogin = await login(ownerEmail, password);
    const rotateToken = String(rotateLogin.body?.token ?? '');
    const rotated = await fetchJson(`http://127.0.0.1:${apiPort}/auth/rotate`, { method: 'POST', headers: { authorization: `Bearer ${rotateToken}` } });
    const newToken = String(rotated.body?.token ?? '');
    check('rotacao_emite_novo_token', rotated.status === 200 && newToken.length > 20);
    check('token_antigo_morre_apos_rotacao', (await me(rotateToken)).status === 401);
    check('token_novo_funciona', (await me(newToken)).status === 200);

    // Expirações (sessões plantadas).
    const normalExpired = await insertSession(OWNER_ID, { expires_at: { raw: "now() - interval '1 minute'" } });
    const absoluteExpired = await insertSession(OWNER_ID, { absolute_expires_at: { raw: "now() - interval '1 minute'" } });
    const idleExpired = await insertSession(OWNER_ID, { last_seen_at: { raw: "now() - interval '25 hours'" } });
    const normalResult = await me(normalExpired);
    const absoluteResult = await me(absoluteExpired);
    const idleResult = await me(idleExpired);
    check('expiracao_normal_401', normalResult.status === 401 && normalResult.body?.message === 'Token expired', normalResult.body);
    check('expiracao_absoluta_401', absoluteResult.status === 401 && absoluteResult.body?.message === 'Session expired', absoluteResult.body);
    check('expiracao_idle_401', idleResult.status === 401 && idleResult.body?.message === 'Session idle timeout', idleResult.body);

    // Conta desativada.
    const deactivatedToken = await insertSession(OWNER_ID);
    await db.query('UPDATE users SET is_active = false WHERE id = $1', [OWNER_ID]);
    const deactivated = await me(deactivatedToken);
    check('conta_desativada_401', deactivated.status === 401, deactivated.body);
    await db.query('UPDATE users SET is_active = true WHERE id = $1', [OWNER_ID]);

    // Troca de credencial revoga sessões (HTTP) e invalida senha antiga.
    const credentialToken = await insertSession(OWNER_ID);
    const adminLogin = await login(`sa012-admin-${ctx.runId}@example.com`, password);
    const change = await fetchJson(`http://127.0.0.1:${apiPort}/admin/users/${OWNER_ID}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${adminLogin.body?.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'Sa012-NovaSenha!42' }),
    });
    check('troca_de_credencial_200', change.status === 200, { status: change.status, body: change.body });
    check('troca_de_credencial_revoga_sessoes', (await me(credentialToken)).status === 401);
    check('senha_antiga_falha', (await login(ownerEmail, password)).status === 401);
    const newPasswordLogin = await login(ownerEmail, 'Sa012-NovaSenha!42');
    check('senha_nova_funciona', newPasswordLogin.status === 200);

    // Sem enumeração: inexistente, inativo e senha errada têm a MESMA resposta.
    const unknown = await login(`sa012-unknown-${ctx.runId}@example.com`, 'qualquer-coisa');
    const wrongPassword = await login(ownerEmail, 'senha-errada');
    const inactiveUser = randomUUID();
    await db.query(
      "INSERT INTO users (id, name, email, password_hash, is_active) VALUES ($1,'SA012 Inativo',$2,$3,false)",
      [inactiveUser, `sa012-inactive-${ctx.runId}@example.com`, ownerHash],
    );
    const inactive = await login(`sa012-inactive-${ctx.runId}@example.com`, password);
    check('sem_enumeracao_respostas_identicas',
      unknown.status === 401 && wrongPassword.status === 401 && inactive.status === 401
      && unknown.body?.message === wrongPassword.body?.message && wrongPassword.body?.message === inactive.body?.message,
      { unknown: unknown.body, wrong: wrongPassword.body, inactive: inactive.body });

    // ---------- WS nativo ----------
    const wsLogoutToken = await insertSession(OWNER_ID);
    const wsLogout = await connectWs(wsLogoutToken);
    await fetchJson(`http://127.0.0.1:${apiPort}/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${wsLogoutToken}` } });
    const logoutClose = await waitClose(wsLogout.ws, 6000, wsLogout.closeInfo);
    check('ws_fecha_por_logout_ate_5s', logoutClose.closed && logoutClose.code === 4002 && logoutClose.elapsedMs <= 5000, logoutClose);

    const wsRotateToken = await insertSession(OWNER_ID);
    const wsRotate = await connectWs(wsRotateToken);
    await fetchJson(`http://127.0.0.1:${apiPort}/auth/rotate`, { method: 'POST', headers: { authorization: `Bearer ${wsRotateToken}` } });
    const rotateClose = await waitClose(wsRotate.ws, 6000, wsRotate.closeInfo);
    check('ws_fecha_por_rotacao_ate_5s', rotateClose.closed && rotateClose.code === 4002 && rotateClose.elapsedMs <= 5000, rotateClose);

    const wsDeactivateToken = await insertSession(OWNER_ID);
    const wsDeactivate = await connectWs(wsDeactivateToken);
    await db.query('UPDATE users SET is_active = false WHERE id = $1', [OWNER_ID]);
    const deactivateClose = await waitClose(wsDeactivate.ws, 6000, wsDeactivate.closeInfo);
    check('ws_fecha_por_conta_desativada_ate_5s', deactivateClose.closed && deactivateClose.code === 4002 && deactivateClose.elapsedMs <= 5000, deactivateClose);
    await db.query('UPDATE users SET is_active = true WHERE id = $1', [OWNER_ID]);

    // Expiração DURANTE a conexão WS: sessão válida por ~3s e o servidor deve
    // encerrar a conexão assim que a revalidação detectar a expiração (≤5s).
    const wsExpiringToken = await insertSession(OWNER_ID, { expires_at: { raw: "now() + interval '3 seconds'" } });
    const wsExpiring = await connectWs(wsExpiringToken);
    const expiresAt = Date.now() + 3_000;
    const expiryClose = await waitClose(wsExpiring.ws, 10_000, wsExpiring.closeInfo);
    const closingAfterExpiry = expiryClose.closed ? Math.max(0, (wsExpiring.closeInfo.at || Date.now()) - expiresAt) : Infinity;
    check('ws_fecha_por_expiracao_ate_5s',
      expiryClose.closed && expiryClose.code === 4002 && closingAfterExpiry <= 5000,
      { ...expiryClose, closingAfterExpiry });

    // Concorrência entre abas: rotações simultâneas do MESMO token — só uma vence.
    const tabToken = await insertSession(OWNER_ID);
    const [rotateA, rotateB] = await Promise.all([
      fetchJson(`http://127.0.0.1:${apiPort}/auth/rotate`, { method: 'POST', headers: { authorization: `Bearer ${tabToken}` } }),
      fetchJson(`http://127.0.0.1:${apiPort}/auth/rotate`, { method: 'POST', headers: { authorization: `Bearer ${tabToken}` } }),
    ]);
    const rotateStatuses = [rotateA.status, rotateB.status].sort((a, b) => a - b);
    check('rotacao_concorrente_apenas_uma_vence',
      rotateStatuses[0] === 200 && rotateStatuses[1] === 401 && (await me(tabToken)).status === 401,
      { rotateStatuses });

    // Duas abas com token expirado não "reanimam" a sessão: ambas 401.
    const expiredTabToken = await insertSession(OWNER_ID, { expires_at: { raw: "now() - interval '1 second'" } });
    const [tabExpiredA, tabExpiredB] = await Promise.all([me(expiredTabToken), me(expiredTabToken)]);
    check('abas_com_token_expirado_nao_reanimam',
      tabExpiredA.status === 401 && tabExpiredB.status === 401,
      { a: tabExpiredA.status, b: tabExpiredB.status });

    // Bootstrap: sem token e token malformado não consultam dado protegido.
    const noToken = await fetchJson(`http://127.0.0.1:${apiPort}/auth/me`);
    const malformed = await fetchJson(`http://127.0.0.1:${apiPort}/auth/me`, { headers: { authorization: 'Bearer nao-e-token-valido' } });
    check('bootstrap_auth_me_sem_token_401', noToken.status === 401, { status: noToken.status });
    check('bootstrap_auth_me_token_malformado_401', malformed.status === 401, { status: malformed.status });

    // Falha injetada na troca de credencial: papel inválido aborta o MESMO
    // commit — a senha NÃO muda e as sessões NÃO são revogadas.
    const atomicToken = await insertSession(OWNER_ID);
    const atomicAttempt = await fetchJson(`http://127.0.0.1:${apiPort}/admin/users/${OWNER_ID}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${(await login(`sa012-admin-${ctx.runId}@example.com`, password)).body?.token ?? ''}`, 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'Sa012-OutraSenha!99', roleIds: [randomUUID()] }),
    });
    const atomicSession = await me(atomicToken);
    const oldPasswordStillWorks = await login(ownerEmail, 'Sa012-NovaSenha!42');
    check('falha_na_troca_de_credencial_aborta_commit',
      atomicAttempt.status >= 400 && atomicAttempt.status < 500 && atomicSession.status === 200 && oldPasswordStillWorks.status === 200,
      { attempt: atomicAttempt.status, session: atomicSession.status, oldPassword: oldPasswordStillWorks.status });

    // ---------- Rate limit (instância dedicada) ----------
    if (await portFree(apiLimitPort)) {
      apiLimit = spawnServer('pnpm', ['--filter', '@cvg/desk-api', 'exec', 'tsx', 'src/index.ts'],
        { ...baseEnv, PORT: String(apiLimitPort), RATE_LIMIT_LOGIN_MAX: '3' }, limitLog);
      const limitUp = await waitFor(async () => (await fetchJson(`http://127.0.0.1:${apiLimitPort}/health`)).status === 200, 90_000);
      check('api_rate_limit_pronta', limitUp);
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        statuses.push((await login(ownerEmail, 'senha-errada', apiLimitPort)).status);
      }
      check('rate_limit_login_429', statuses.slice(0, 3).every((status) => status === 401) && statuses.at(-1) === 429, { statuses });
    } else {
      check('api_rate_limit_pronta', false, { reason: `porta ${apiLimitPort} ocupada` });
    }
  } catch (error) {
    (report.failures as string[]).push(`fatal: ${String(error)}`);
    console.error('[sa012] fatal:', error);
  } finally {
    stopGroup(apiLimit);
    stopGroup(apiMain);
    stopGroup(realtime);
    try { await db?.end(); } catch { /* já encerrado */ }
    if (provisioned) report.teardown = teardownIsolatedEnv(ctx, { stopServices: true, dropDatabase: true });
    report.finishedAt = new Date().toISOString();
    report.result = (report.failures as string[]).length === 0 ? 'PASS' : 'FAIL';
    writeFileSync(join(evidenceDir, 'sa-012-session.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[sa012] ${report.result}`);
    process.exit(report.result === 'PASS' ? 0 : 1);
  }
}

void main();
