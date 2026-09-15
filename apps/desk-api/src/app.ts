import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import 'dotenv/config';
import { getMediaMaxBytes } from '@cvg/shared';
import { registerInboundWebhook, registerOutboundController, registerMediaUploadController, registerMediaReadController, createChatPorts, setGatewayOutboundPort } from '@cvg/chat';

import {
  checkRedisDependency,
  isProduction,
  isRedisCritical,
  redisTlsRejectUnauthorized,
  resolveReadinessTimeouts,
  resolveTrustedProxies,
  validateProductionConfig,
} from './runtime-config';

const checkMigrationsModuleUrl = new URL('../../../packages/database/src/check-migrations.ts', import.meta.url).href;

/**
 * Label de rota para requests sem rota registrada (A15): a URL/PII do cliente
 * nunca vira label; tudo colapsa numa série única e previsível.
 */
export const UNMATCHED_ROUTE_LABEL = 'unmatched';

function resolveRouteLabel(request: { routeOptions?: { url?: string } }): string {
  const registeredRoute = request.routeOptions?.url;
  return typeof registeredRoute === 'string' && registeredRoute.length > 0
    ? registeredRoute
    : UNMATCHED_ROUTE_LABEL;
}

interface ParsedNetwork {
  base: bigint;
  bits: 32 | 128;
  prefix: number;
}

function parseIpv4(address: string): bigint | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

function parseIpv6(address: string): bigint | null {
  const zoneIndex = address.indexOf('%');
  const literal = zoneIndex === -1 ? address : address.slice(0, zoneIndex);
  const doubleColon = literal.indexOf('::');
  const headText = doubleColon === -1 ? literal : literal.slice(0, doubleColon);
  const tailText = doubleColon === -1 ? '' : literal.slice(doubleColon + 2);
  const head = headText.length > 0 ? headText.split(':') : [];
  const tail = tailText.length > 0 ? tailText.split(':') : [];

  let groups: string[];
  if (doubleColon === -1) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    if (head.length + tail.length > 8) return null;
    groups = [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail];
  }

  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return value;
}

function parseIp(address: string): { value: bigint; bits: 32 | 128 } | null {
  // IPv4 mapeado em IPv6 (::ffff:127.0.0.1) compara como IPv4.
  const normalized = address.startsWith('::ffff:') && address.includes('.') ? address.slice(7) : address;
  if (normalized.includes(':')) {
    const value = parseIpv6(normalized);
    return value === null ? null : { value, bits: 128 };
  }
  const value = parseIpv4(normalized);
  return value === null ? null : { value, bits: 32 };
}

function parseNetwork(cidr: string): ParsedNetwork | null {
  const [address, prefixText] = cidr.split('/');
  if (!address) return null;
  const parsed = parseIp(address);
  if (!parsed) return null;
  const prefix = prefixText === undefined || prefixText === '' ? parsed.bits : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > parsed.bits) return null;
  const shift = BigInt(parsed.bits - prefix);
  return { base: shift === 0n ? parsed.value : (parsed.value >> shift) << shift, bits: parsed.bits, prefix };
}

function ipInNetwork(ip: string, network: ParsedNetwork): boolean {
  const parsed = parseIp(ip);
  if (!parsed || parsed.bits !== network.bits) return false;
  const shift = BigInt(parsed.bits - network.prefix);
  return (parsed.value >> shift) === (network.base >> shift);
}

function resolveAllowedNetworks(raw: string | undefined): { networks: ParsedNetwork[]; invalid: string[] } {
  const entries = (raw ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
  const networks: ParsedNetwork[] = [];
  const invalid: string[] = [];
  for (const entry of entries) {
    const network = parseNetwork(entry);
    if (network) networks.push(network);
    else invalid.push(entry);
  }
  return { networks, invalid };
}

function safeEqualStrings(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function warnOnProductionWebhookMisconfiguration(): void {
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (isProduction() && !webhookSecret) {
    // eslint-disable-next-line no-console
    console.error('[API] FATAL: WEBHOOK_SECRET is not set in production. Webhook endpoint /webhook/inbound will reject all requests with 500. Set WEBHOOK_SECRET before deploying.');
  }
}

function assertProductionEnv(): void {
  if (!isProduction()) return;
  // Testes usam DESK_ENV=production para exercitar o guard; não derrubar o boot em NODE_ENV=test.
  if (process.env.NODE_ENV === 'test') return;
  const corsOrigin = (process.env.CORS_ORIGIN || '').trim();
  if (!corsOrigin || corsOrigin === '*') {
    throw new Error('[API] FATAL: CORS_ORIGIN ausente ou "*" em produção (fail-secure). Defina origens explícitas.');
  }
}

import { registerTaskRoutes } from '@cvg/tasks';
import { registerNoteRoutes } from '@cvg/notes';
import { registerAlertRoutes } from '@cvg/alerts';
import { registerDashboardRoutes } from '@cvg/dashboard';
import { registerAuthRoutes } from '@cvg/auth';
import { registerAuditRoutes } from '@cvg/audit';
import { registerAdminRoutes } from '@cvg/admin';
import { registerPersistentDeadLetterRoutes } from '@cvg/admin';
import { initializeSecretaryClient } from '@cvg/integrations';
import { registerLabelRoutes } from '@cvg/labels';
import { registerSectorRoutes } from '@cvg/sectors';
import { registerTransferRoutes } from '@cvg/transfers';
import { registerContactGroupRoutes } from '@cvg/contact-groups';
import { registerKanbanRoutes } from '@cvg/kanban';
import { registerGatewayRoutes, gatewayService } from '@cvg/gateway-adapter';
import { registerContactRoutes } from '@cvg/contacts';
import { registerPrivacyRoutes } from '@cvg/privacy';
import { registerPatientRoutes } from '@cvg/patients';
import { registerTutorRoutes } from '@cvg/tutors';
import { createInternalEventsGuard } from './internal-auth';

export interface DeskApiAppOptions {
  /** Destino de log injetável (testes de vazamento); padrão = stdout/pino. */
  loggerStream?: NodeJS.WritableStream;
}

export async function buildDeskApiApp(options: DeskApiAppOptions = {}): Promise<FastifyInstance> {
  warnOnProductionWebhookMisconfiguration();
  assertProductionEnv();

  const loggerBase = {
    level: process.env.LOG_LEVEL || 'info',
    redact: (await import('@cvg/shared').then((m) => m.PINO_REDACT_PATHS).catch(() => [])) as string[],
  };
  const app = Fastify({
    logger: options.loggerStream
      ? { ...loggerBase, stream: options.loggerStream }
      : {
          ...loggerBase,
          transport: process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
            : undefined,
        },
    trustProxy: resolveTrustedProxies(),
    bodyLimit: 1048576,
    // SA-011/AC2: payload excedente deve ser REJEITADO com 400. O default do
    // Ajv no Fastify é `removeAdditional: true`, que descarta campos extras
    // silenciosamente; com `false`, `additionalProperties` é contrato real.
    ajv: { customOptions: { removeAdditional: false } },
  }).withTypeProvider<ZodTypeProvider>();

  const { metrics, httpRequestsTotal, httpRequestDuration, rateLimitHitsTotal } = await import('@cvg/shared');

  app.addHook('onRequest', async (request) => {
    (request as unknown as { metricsStartMs: number }).metricsStartMs = Date.now();
  });

  // SA-011/AC2: validação central de parâmetros UUID. Rotas com `:id`/`:xId`
  // (exceto identificadores textuais como eventId e entityType) respondem 400
  // previsível ANTES de qualquer acesso ao banco, em vez de 500 por cast uuid.
  const UUID_PARAM_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const UUID_PARAM_EXEMPTIONS = new Set(['eventId', 'entityType']);
  // `:id` textual legítimo: identificadores da DLQ são strings (dlq_*), não UUID.
  const NON_UUID_ID_ROUTE_PATTERNS = [/^\/admin\/dead-letters\//];
  app.addHook('preValidation', async (request, reply) => {
    const params = request.params as Record<string, unknown> | undefined;
    if (!params || typeof params !== 'object') return;
    const routeUrl = (request.routeOptions?.url ?? request.raw.url ?? '').split('?')[0];
    const idRouteIsTextual = NON_UUID_ID_ROUTE_PATTERNS.some((pattern) => pattern.test(routeUrl));
    for (const [key, value] of Object.entries(params)) {
      if (typeof value !== 'string' || UUID_PARAM_EXEMPTIONS.has(key)) continue;
      if (!/^(id|[a-z]+Id)$/.test(key)) continue;
      if (key === 'id' && idRouteIsTextual) continue;
      if (!UUID_PARAM_PATTERN.test(value)) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: `Parâmetro ${key} inválido` });
      }
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    try {
      const route = resolveRouteLabel(request);
      const method = request.method;
      const status = reply.statusCode;
      const started = (request as unknown as { metricsStartMs?: number }).metricsStartMs;
      const durationS = started ? (Date.now() - started) / 1000 : 0;
      httpRequestsTotal.inc({ method, route, status });
      httpRequestDuration.observe(durationS, { method, route });
      if (status === 429) {
        rateLimitHitsTotal.inc({ route });
      }
    } catch {
      // Métricas nunca quebram requests.
    }
  });

  app.get('/metrics', {
    // Sem schema de resposta: corpo é texto Prometheus puro (serialização
    // JSON corromperia a exposição com aspas).
    schema: {
      description: 'Exposição Prometheus (Phase 6). Exige METRICS_TOKEN (Bearer) e/ou METRICS_ALLOWED_CIDRS; em produção sem configuração explícita responde 503 (fail-closed).',
      tags: ['Observability'],
    },
  }, async (request, reply) => {
    const token = (process.env.METRICS_TOKEN ?? '').trim();
    const { networks, invalid } = resolveAllowedNetworks(process.env.METRICS_ALLOWED_CIDRS);
    const production = isProduction();

    if (invalid.length > 0) {
      request.log.error(
        { invalidEntries: invalid.length },
        '[Metrics] METRICS_ALLOWED_CIDRS inválido — exposição negada (fail-closed)',
      );
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Metrics endpoint is not available' });
    }

    if (token.length > 0) {
      const header = request.headers.authorization ?? '';
      if (!safeEqualStrings(header, `Bearer ${token}`)) {
        return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid metrics token' });
      }
    } else if (production && networks.length === 0) {
      request.log.error(
        '[Metrics] METRICS_TOKEN e METRICS_ALLOWED_CIDRS ausentes em produção — exposição negada (fail-closed)',
      );
      return reply.status(503).send({ error: 'METRICS_UNAVAILABLE', message: 'Metrics endpoint is not available' });
    }

    if (networks.length > 0 && !networks.some((network) => ipInNetwork(request.ip, network))) {
      request.log.warn('[Metrics] acesso negado pela allowlist de rede');
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Metrics endpoint is not available' });
    }

    return reply.type('text/plain; version=0.0.4').send(metrics.render());
  });

  // Captura rawBody para HMAC sem consumir o stream antes do parse:
  // parser customizado preserva bytes exatos e entrega objeto parseado ao Fastify.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      (req as unknown as { rawBody: string }).rawBody = typeof body === 'string' ? body : '';
      done(null, body === '' ? undefined : JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const statusCode = error.statusCode || 500;

    // C05: contrato recuperável e explícito para excesso de payload
    // (o parser JSON/DTO legado e o limite duro do parser binário caem aqui).
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      request.log.warn({ code: error.code, path: request.url }, 'payload excede o limite do parser');
      const maxBytes = getMediaMaxBytes();
      return reply.status(413).send({
        error: 'PAYLOAD_TOO_LARGE',
        message: `Request body exceeds the allowed limit (${maxBytes} bytes for media; base64/JSON transport no longer accepted)`,
        statusCode: 413,
        maxBytes,
        recoverable: true,
        retryable: false,
        timestamp: new Date().toISOString(),
      });
    }

    if (error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || statusCode === 415) {
      const isUpload = request.url.includes('/media');
      return reply.status(415).send({
        error: 'UNSUPPORTED_MEDIA_TYPE',
        message: isUpload
          ? 'Upload de anexo usa Content-Type: application/octet-stream com X-Media-Mimetype/X-Media-Type'
          : error.message,
        statusCode: 415,
        recoverable: false,
        timestamp: new Date().toISOString(),
      });
    }

    if (statusCode >= 500) {
      request.log.error({ err: error, path: request.url, method: request.method }, 'Erro interno');
    } else {
      request.log.warn({ err: error, path: request.url }, 'Erro de requisição');
    }

    if (statusCode >= 500) {
      // SA-011/AC2: erro interno não vaza código/mensagem/stack de banco; o
      // detalhe fica apenas no log do servidor.
      reply.status(statusCode).send({
        error: 'INTERNAL_ERROR',
        message: 'Erro interno',
      });
      return;
    }

    reply.status(statusCode).send({
      error: error.code || 'BAD_REQUEST',
      message: error.message,
      statusCode,
      timestamp: new Date().toISOString(),
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
    });
  });

  const secretaryUrl = process.env.SECRETARY_URL;
  const secretaryApiKey = process.env.SECRETARY_API_KEY;

  if (secretaryUrl && secretaryApiKey) {
    try {
      initializeSecretaryClient({
        baseUrl: secretaryUrl,
        apiKey: secretaryApiKey,
        timeout: Number(process.env.SECRETARY_TIMEOUT_MS) || 30000,
      });
      app.log.info('[API] Secretary client initialized');
    } catch (error) {
      app.log.error(error, '[API] Failed to initialize Secretary client');
    }
  } else {
    app.log.warn('[API] SECRETARY_URL or SECRETARY_API_KEY not set — Secretary integration disabled');
  }

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  const corsOrigin = process.env.CORS_ORIGIN;
  await app.register(cors, {
    origin: corsOrigin ? corsOrigin.split(',').map((o) => o.trim()).filter(Boolean) : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Webhook-Signature', 'X-Webhook-Timestamp', 'X-Webhook-Event-Id', 'Idempotency-Key', 'X-Media-Type', 'X-Media-Mimetype', 'X-Media-Filename'],
    credentials: true,
    maxAge: 86400,
  });

  await app.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX) || 100,
    timeWindow: process.env.RATE_LIMIT_WINDOW || '1 minute',
    keyGenerator: (req) => (req.user?.id as string) || req.ip,
    allowList: (req) => {
      const path = req.url;
      return path === '/health' || path === '/readiness';
    },
    skipOnError: false,
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'CVG Connect Desk API',
        version: '1.0.0',
        description: 'API operacional do CVG Connect Desk — Sistema de atendimento digital para hospital veterinário',
        contact: {
          name: 'CVG Connect Desk',
        },
      },
      servers: [
        { url: `http://localhost:${process.env.PORT || 3000}`, description: 'Desenvolvimento' },
      ],
      tags: [
        { name: 'Auth', description: 'Autenticação e sessões' },
        { name: 'Chat', description: 'Conversas e mensagens' },
        { name: 'Tasks', description: 'Tarefas operacionais' },
        { name: 'Notes', description: 'Notas internas' },
        { name: 'Alerts', description: 'Alertas operacionais' },
        { name: 'Dashboard', description: 'Métricas e KPIs' },
        { name: 'Admin', description: 'Administração (usuários, filas, times)' },
        { name: 'Audit', description: 'Trilha de auditoria' },
        { name: 'Webhook', description: 'Webhook inbound do Gateway' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  app.get('/health', {
    schema: {
      description: 'Liveness check — verifica se o processo está vivo (não depende de DB/Redis)',
      tags: ['Health'],
      response: { 200: { type: 'object', properties: { status: { type: 'string' }, timestamp: { type: 'string' }, uptime: { type: 'number' }, version: { type: 'string' } } } },
    },
  }, async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
  }));

  const readinessResponseSchema = {
    type: 'object',
    properties: {
      ready: { type: 'boolean' },
      degraded: { type: 'boolean' },
      checks: { type: 'object', additionalProperties: true },
      version: { type: 'string' },
      timestamp: { type: 'string' },
    },
  };

  app.get('/readiness', {
    schema: {
      description: 'Readiness check — 503 quando dependência crítica (DB, schema atrasado ou Redis crítico) está indisponível',
      tags: ['Health'],
      response: {
        200: readinessResponseSchema,
        503: readinessResponseSchema,
      },
    },
  }, async (request, reply) => {
    const timeouts = resolveReadinessTimeouts();
    const checks: Record<string, {
      status: 'ok' | 'error' | 'degraded';
      latencyMs?: number;
      code?: string;
      applied?: number;
      expected?: number;
      missing?: string[];
      mismatched?: string[];
    }> = {};

    if (isProduction() && process.env.NODE_ENV !== 'test') {
      const configuration = validateProductionConfig(process.env);
      if (configuration.length > 0) {
        checks.configuration = {
          status: 'error',
          code: 'PRODUCTION_CONFIG_INVALID',
          missing: configuration.map((issue) => issue.variable),
        };
      }
    }

    const { checkDatabaseReadiness } = await import(/* @vite-ignore */ checkMigrationsModuleUrl);
    const database = await checkDatabaseReadiness({ timeoutMs: timeouts.databaseMs });
    checks.database = database.database.status === 'ok'
      ? { status: 'ok', latencyMs: database.database.latencyMs }
      : { status: 'error', latencyMs: database.database.latencyMs, code: database.database.code };
    checks.migrations = database.migrations.status === 'ok'
      ? {
          status: 'ok',
          latencyMs: database.migrations.latencyMs,
          applied: database.migrations.applied,
          expected: database.migrations.expected,
        }
      : {
          status: 'error',
          latencyMs: database.migrations.latencyMs,
          code: database.migrations.code,
          applied: database.migrations.applied,
          expected: database.migrations.expected,
          ...(database.migrations.missing.length > 0 ? { missing: database.migrations.missing } : {}),
          ...(database.migrations.mismatched.length > 0 ? { mismatched: database.migrations.mismatched } : {}),
        };

    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      const redis = await checkRedisDependency(redisUrl, {
        timeoutMs: timeouts.redisMs,
        tlsRejectUnauthorized: redisTlsRejectUnauthorized(),
      });
      checks.redis = redis.ok
        ? { status: 'ok', latencyMs: redis.latencyMs }
        : { status: isRedisCritical() ? 'error' : 'degraded', latencyMs: redis.latencyMs, code: redis.code };
    }

    const secretaryUrl = process.env.SECRETARY_URL;
    if (secretaryUrl) {
      const secretaryStarted = Date.now();
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeouts.secretaryMs);
        const res = await fetch(`${secretaryUrl.replace(/\/$/, '')}/health`, { signal: controller.signal });
        clearTimeout(timer);
        checks.secretary = res.ok
          ? { status: 'ok', latencyMs: Date.now() - secretaryStarted }
          : { status: 'degraded', latencyMs: Date.now() - secretaryStarted, code: `SECRETARY_HTTP_${res.status}` };
      } catch {
        checks.secretary = { status: 'degraded', latencyMs: Date.now() - secretaryStarted, code: 'SECRETARY_UNREACHABLE' };
      }
    }

    const criticalFailed = ['configuration', 'database', 'migrations', 'redis']
      .some((key) => checks[key]?.status === 'error');
    const degraded = !criticalFailed && Object.values(checks).some((check) => check.status !== 'ok');
    const body = {
      ready: !criticalFailed,
      degraded,
      checks,
      version: process.env.npm_package_version || '1.0.0',
      timestamp: new Date().toISOString(),
    };

    if (criticalFailed) {
      request.log.warn(
        {
          database: checks.database?.code,
          migrations: checks.migrations?.code,
          redis: checks.redis?.code,
        },
        'readiness: dependência crítica indisponível (503)',
      );
      return reply.status(503).send(body);
    }
    return body;
  });

  app.get('/events', {
    preHandler: createInternalEventsGuard(),
    schema: {
      description: 'Polling endpoint for events - reads from database outbox',
      tags: ['Internal'],
      querystring: {
        type: 'object',
        properties: {
          since: { type: 'string', description: 'ISO timestamp - return events after this time' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            events: { type: 'array' },
            leases: { type: 'array' },
            leaseSeconds: { type: 'integer' },
            ackEndpoint: { type: 'string' },
            serverTime: { type: 'string' },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { ConsumerAwareOutboxReader, CONSUMER_IDS, DEFAULT_LEASE_SECONDS } = await import('@cvg/events');
    const query = request.query as { since?: string; limit?: number };

    // Validar `since` ANTES de reservar (C03 §4, MEDIUM-03): claim recebe o
    // predicado OU o evento descartado ficaria preso até o lease expirar.
    let since: Date | undefined;
    if (query.since !== undefined) {
      since = new Date(query.since);
      if (Number.isNaN(since.getTime())) {
        return reply.status(400).send({
          error: 'INVALID_SINCE',
          message: 'since deve ser um timestamp ISO válido',
        });
      }
    }

    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
    const leaseSeconds = DEFAULT_LEASE_SECONDS;
    const reader = new ConsumerAwareOutboxReader({
      consumerId: CONSUMER_IDS.HTTP_POLL,
      batchSize: limit,
      maxRetries: 3,
    });
    // Semântica de lease: GET apenas aluga (claim); o ACK é explícito via POST /events/:id/ack.
    const owner = `http-poll:${randomUUID().slice(0, 8)}`;
    const claimed = await reader.claim({ owner, leaseSeconds, limit, since });

    return {
      events: claimed.map((entry) => entry.event),
      leases: claimed.map((entry) => entry.lease),
      leaseSeconds,
      ackEndpoint: '/events/:eventId/ack',
      serverTime: new Date().toISOString(),
    };
  });

  app.post('/events/:eventId/ack', {
    preHandler: createInternalEventsGuard(),
    schema: {
      description: 'Explicit ACK for a leased outbox event (http-poll consumer)',
      tags: ['Internal'],
      params: {
        type: 'object',
        properties: { eventId: { type: 'string', minLength: 1 } },
        required: ['eventId'],
      },
    },
  }, async (request, reply) => {
    const { ConsumerAwareOutboxReader, CONSUMER_IDS } = await import('@cvg/events');
    const { eventId } = request.params as { eventId: string };
    const body = (request.body ?? {}) as { owner?: unknown; generation?: unknown };
    const reader = new ConsumerAwareOutboxReader({
      consumerId: CONSUMER_IDS.HTTP_POLL,
      batchSize: 1,
      maxRetries: 3,
    });

    // Com token no corpo → fencing estrito. Sem token (compatibilidade),
    // resolve o lease vigente do consumidor; reclaim acontecido antes da
    // leitura faz o ACK recair sobre o lease novo e o fencing rejeita stale.
    const hasToken = typeof body.owner === 'string' && Number.isInteger(body.generation);
    const result = hasToken
      ? await reader.acknowledge(eventId, {
          owner: body.owner as string,
          generation: body.generation as number,
        })
      : await reader.acknowledgeCurrentLease(eventId);

    if (result === 'stale') {
      return reply.status(409).send({ acknowledged: false, eventId, reason: 'stale' });
    }
    if (result === 'not_found') {
      return reply.status(404).send({ acknowledged: false, eventId, reason: 'not_found' });
    }
    return { acknowledged: true, eventId };
  });

  // Composição explícita Chat↔Gateway (C02 §5): injeta o provedor outbound no
  // chat e as implementações do chat nos handlers do gateway, sem imports
  // cruzados entre os dois pacotes.
  setGatewayOutboundPort(gatewayService);
  const chatPorts = createChatPorts();

  await registerInboundWebhook(app);
  await registerOutboundController(app);
  await registerMediaUploadController(app);
  await registerMediaReadController(app);
  await registerTaskRoutes(app);
  await registerNoteRoutes(app);
  await registerAlertRoutes(app);
  await registerDashboardRoutes(app);
  await registerAuthRoutes(app);
  await registerAuditRoutes(app);
  await registerAdminRoutes(app);
  await registerPersistentDeadLetterRoutes(app);
  await registerLabelRoutes(app);
  await registerSectorRoutes(app);
  await registerTransferRoutes(app);
  await registerContactGroupRoutes(app);
  await registerKanbanRoutes(app);
  await registerGatewayRoutes(app, chatPorts);
  await registerContactRoutes(app);
  await registerTutorRoutes(app);
  await registerPatientRoutes(app);
  await registerPrivacyRoutes(app);

  return app;
}
