import net from 'node:net';
import tls from 'node:tls';

export function isProduction(): boolean {
  const env = (process.env.NODE_ENV || process.env.DESK_ENV || '').toLowerCase();
  return env === 'production' || env === 'prod';
}

/**
 * Resolve Fastify's proxy trust from an explicit allow-list. In production,
 * accepting `true` would let callers forge the client IP used by rate limits.
 */
export function resolveTrustedProxies(
  configured = process.env.TRUST_PROXY?.trim(),
  production = isProduction(),
): false | string[] | true {
  if (!configured || configured === 'false') return false;
  if (configured === 'true') {
    if (production) throw new Error('TRUST_PROXY must list explicit proxy addresses in production');
    return true;
  }

  const proxies = configured.split(',').map((value) => value.trim()).filter(Boolean);
  if (proxies.length === 0) throw new Error('TRUST_PROXY must contain at least one proxy address');
  return proxies;
}

export interface ReadinessTimeouts {
  databaseMs: number;
  redisMs: number;
  secretaryMs: number;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Timeouts limitados dos probes de readiness — nunca deixam a rota pendurada. */
export function resolveReadinessTimeouts(env: NodeJS.ProcessEnv = process.env): ReadinessTimeouts {
  return {
    databaseMs: positiveNumber(env.READINESS_DB_TIMEOUT_MS, 2000),
    redisMs: positiveNumber(env.READINESS_REDIS_TIMEOUT_MS, 1500),
    secretaryMs: positiveNumber(env.READINESS_SECRETARY_TIMEOUT_MS, 2000),
  };
}

function isTruthy(value: string | undefined): boolean {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

/**
 * Redis é dependência crítica quando REDIS_REQUIRED/REDIS_CRITICAL é ligado.
 * Sem a flag, falha de Redis apenas degrada explicitamente o readiness.
 */
export function isRedisCritical(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthy(env.REDIS_REQUIRED) || isTruthy(env.REDIS_CRITICAL);
}

export function redisTlsRejectUnauthorized(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.REDIS_TLS_REJECT_UNAUTHORIZED ?? 'true').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'no';
}

export interface ProductionConfigIssue {
  variable: string;
  code: string;
}

function present(env: NodeJS.ProcessEnv, name: string): boolean {
  return (env[name] ?? '').trim().length > 0;
}

/**
 * Regras de configuração que precisam estar alinhadas com o boot produtivo.
 * A função só retorna nomes/códigos, nunca valores de secrets ou URLs.
 */
export function validateProductionConfig(
  env: NodeJS.ProcessEnv = process.env,
): ProductionConfigIssue[] {
  const issues: ProductionConfigIssue[] = [];
  const add = (variable: string, code: string): void => {
    issues.push({ variable, code });
  };

  if ((env.NODE_ENV ?? '').trim().toLowerCase() !== 'production') {
    add('NODE_ENV', 'NODE_ENV_MUST_BE_PRODUCTION');
  }

  if (!/^postgres(?:ql)?:\/\//.test((env.DATABASE_URL ?? '').trim())) {
    add('DATABASE_URL', 'DATABASE_URL_INVALID');
  }
  if (!/^rediss?:\/\//.test((env.REDIS_URL ?? '').trim())) {
    add('REDIS_URL', 'REDIS_URL_INVALID');
  }

  const origins = (env.CORS_ORIGIN ?? '').split(',').map((origin) => origin.trim());
  if (origins.length === 0 || origins.some((origin) => !origin || origin === '*')) {
    add('CORS_ORIGIN', 'CORS_ORIGIN_INVALID');
  }

  if (!present(env, 'WEBHOOK_SECRET') || (env.WEBHOOK_SECRET ?? '').trim().length < 16) {
    add('WEBHOOK_SECRET', 'WEBHOOK_SECRET_MISSING_OR_WEAK');
  }

  const internalSecret = ['REALTIME_INTERNAL_SECRET', 'INTERNAL_EVENTS_SECRET', 'EVENTS_API_KEY']
    .some((name) => present(env, name));
  if (!internalSecret) add('INTERNAL_EVENTS_SECRET', 'INTERNAL_EVENTS_SECRET_MISSING');

  if ((env.MEDIA_STORAGE_DRIVER ?? '').trim().toLowerCase() !== 's3') {
    add('MEDIA_STORAGE_DRIVER', 'MEDIA_STORAGE_MUST_BE_S3');
  }
  for (const name of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
    if (!present(env, name)) add(name, 'S3_CONFIGURATION_MISSING');
  }

  if ((env.MALWARE_SCANNER ?? '').trim().toLowerCase() !== 'clamav') {
    add('MALWARE_SCANNER', 'MALWARE_SCANNER_MUST_BE_CLAMAV');
  }
  if (!present(env, 'CLAMAV_HOST')) add('CLAMAV_HOST', 'CLAMAV_HOST_MISSING');
  const clamavPort = Number(env.CLAMAV_PORT);
  if (!Number.isInteger(clamavPort) || clamavPort < 1 || clamavPort > 65535) {
    add('CLAMAV_PORT', 'CLAMAV_PORT_INVALID');
  }

  if (!present(env, 'METRICS_TOKEN') && !present(env, 'METRICS_ALLOWED_CIDRS')) {
    add('METRICS_TOKEN', 'METRICS_ACCESS_MISSING');
  }

  if ((env.OTEL_ENABLED ?? '').trim().toLowerCase() === 'true'
    && !present(env, 'OTEL_EXPORTER_OTLP_ENDPOINT')) {
    add('OTEL_EXPORTER_OTLP_ENDPOINT', 'OTLP_ENDPOINT_MISSING');
  }

  return issues;
}

export type RedisProbeCode =
  | 'REDIS_URL_INVALID'
  | 'REDIS_AUTH_REQUIRED'
  | 'REDIS_AUTH_FAILED'
  | 'REDIS_TIMEOUT'
  | 'REDIS_TLS_FAILED'
  | 'REDIS_UNREACHABLE'
  | 'REDIS_PROTOCOL_ERROR';

export interface RedisProbeResult {
  ok: boolean;
  code?: RedisProbeCode;
  latencyMs: number;
  authAttempted: boolean;
  tls: boolean;
}

class RedisProbeError extends Error {
  constructor(readonly code: RedisProbeCode) {
    super(code);
  }
}

function safeDecode(value: string): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodeCommand(args: string[]): string {
  const parts = args.map((arg) => `$${Buffer.byteLength(arg, 'utf8')}\r\n${arg}\r\n`);
  return `*${args.length}\r\n${parts.join('')}`;
}

function classifySocketError(error: unknown): RedisProbeCode {
  const code = (error as { code?: string } | null)?.code ?? '';
  const message = error instanceof Error ? error.message : '';
  if (code === 'ETIMEDOUT' || /timeout/i.test(message)) return 'REDIS_TIMEOUT';
  if (
    code.startsWith('ERR_TLS')
    || code.startsWith('ERR_SSL')
    || code.startsWith('UNABLE_TO_')
    || code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
    || /certificate|self.signed|wrong version number|tls/i.test(message)
  ) {
    return 'REDIS_TLS_FAILED';
  }
  return 'REDIS_UNREACHABLE';
}

function readReplyLines(socket: net.Socket, expected: number, timeoutMs: number): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    let buffer = '';
    const replies: string[] = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(new RedisProbeError('REDIS_TIMEOUT'));
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      let lineEnd = buffer.indexOf('\r\n');
      while (lineEnd !== -1) {
        replies.push(buffer.slice(0, lineEnd));
        buffer = buffer.slice(lineEnd + 2);
        if (replies.length >= expected) {
          cleanup();
          resolve(replies);
          return;
        }
        lineEnd = buffer.indexOf('\r\n');
      }
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onClose = (): void => {
      cleanup();
      reject(new RedisProbeError('REDIS_UNREACHABLE'));
    };
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

/**
 * Probe Redis com AUTH e TLS reais (sem depender do pacote `redis`):
 * - `redis://` envia AUTH quando há credencial na URL e falha explícita em
 *   NOAUTH/WRONGPASS;
 * - `rediss://` exige handshake TLS (com verificação de certificado por padrão);
 * - respostas/erros viram códigos, nunca a senha ou a URL.
 */
export async function checkRedisDependency(
  redisUrl: string,
  options: { timeoutMs?: number; tlsRejectUnauthorized?: boolean } = {},
): Promise<RedisProbeResult> {
  const started = Date.now();
  const timeoutMs = Math.max(200, options.timeoutMs ?? 1500);

  let parsed: URL;
  try {
    parsed = new URL(redisUrl);
  } catch {
    return { ok: false, code: 'REDIS_URL_INVALID', latencyMs: Date.now() - started, authAttempted: false, tls: false };
  }
  const tlsEnabled = parsed.protocol === 'rediss:';
  if (parsed.protocol !== 'redis:' && !tlsEnabled) {
    return { ok: false, code: 'REDIS_URL_INVALID', latencyMs: Date.now() - started, authAttempted: false, tls: tlsEnabled };
  }

  const host = parsed.hostname || 'localhost';
  const port = Number(parsed.port) || 6379;
  const password = safeDecode(parsed.password);
  const username = safeDecode(parsed.username);
  const authAttempted = password.length > 0;

  let socket: net.Socket;
  try {
    socket = tlsEnabled
      ? tls.connect({
          host,
          port,
          servername: net.isIP(host) ? undefined : host,
          rejectUnauthorized: options.tlsRejectUnauthorized !== false,
        })
      : net.connect({ host, port });
  } catch (error) {
    return {
      ok: false,
      code: classifySocketError(error),
      latencyMs: Date.now() - started,
      authAttempted,
      tls: tlsEnabled,
    };
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new RedisProbeError('REDIS_TIMEOUT')), timeoutMs);
      const readyEvent = tlsEnabled ? 'secureConnect' : 'connect';
      socket.once(readyEvent, () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    const commands: string[][] = [];
    if (authAttempted) commands.push(username ? ['AUTH', username, password] : ['AUTH', password]);
    commands.push(['PING']);
    socket.write(commands.map(encodeCommand).join(''));

    const replies = await readReplyLines(socket, commands.length, timeoutMs);
    let index = 0;

    if (authAttempted) {
      const authReply = replies[index++] ?? '';
      if (!authReply.startsWith('+')) {
        return {
          ok: false,
          code: authReply.startsWith('-NOAUTH') ? 'REDIS_AUTH_REQUIRED' : 'REDIS_AUTH_FAILED',
          latencyMs: Date.now() - started,
          authAttempted,
          tls: tlsEnabled,
        };
      }
    }

    const pingReply = replies[index] ?? '';
    if (pingReply === '+PONG' || pingReply === 'PONG') {
      return { ok: true, latencyMs: Date.now() - started, authAttempted, tls: tlsEnabled };
    }
    if (pingReply.startsWith('-NOAUTH')) {
      return { ok: false, code: 'REDIS_AUTH_REQUIRED', latencyMs: Date.now() - started, authAttempted, tls: tlsEnabled };
    }
    if (pingReply.startsWith('-WRONGPASS') || /invalid password/i.test(pingReply)) {
      return { ok: false, code: 'REDIS_AUTH_FAILED', latencyMs: Date.now() - started, authAttempted, tls: tlsEnabled };
    }
    return { ok: false, code: 'REDIS_PROTOCOL_ERROR', latencyMs: Date.now() - started, authAttempted, tls: tlsEnabled };
  } catch (error) {
    return {
      ok: false,
      code: error instanceof RedisProbeError ? error.code : classifySocketError(error),
      latencyMs: Date.now() - started,
      authAttempted,
      tls: tlsEnabled,
    };
  } finally {
    socket.destroy();
  }
}
