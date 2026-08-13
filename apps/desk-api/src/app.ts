import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import 'dotenv/config';
import {
  registerInboundWebhook,
  registerOutboundController,
  setOutboundDeliveryService,
  receiveInboundMessage,
  messageRepository,
} from '@cvg/chat';
import { claimGatewayRequestNonce, persistWebhookSecurityDecision } from '@cvg/database';
import { configureWebhookSecurityDecisionSink } from '@cvg/shared';

function isProduction(): boolean {
  const env = (process.env.NODE_ENV || process.env.DESK_ENV || '').toLowerCase();
  return env === 'production' || env === 'prod';
}

function resolveTrustedProxies(): false | string[] | true {
  const configured = process.env.TRUST_PROXY?.trim();
  if (!configured) {
    return false;
  }

  if (configured === 'true' && !isProduction()) {
    return true;
  }

  if (configured === 'true') {
    throw new Error('TRUST_PROXY must list explicit proxy addresses in production');
  }

  const proxies = configured.split(',').map(value => value.trim()).filter(Boolean);
  if (proxies.length === 0) {
    throw new Error('TRUST_PROXY must contain at least one proxy address');
  }

  return proxies;
}

function warnOnProductionWebhookMisconfiguration(): void {
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (isProduction() && !webhookSecret) {

    console.error('[API] FATAL: WEBHOOK_SECRET is not set in production. Webhook endpoint /webhook/inbound will reject all requests with 500. Set WEBHOOK_SECRET before deploying.');
  }
}

function resolveLogLevel(): string {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL;
  }

  return process.env.NODE_ENV === 'test' || process.env.VITEST ? 'fatal' : 'info';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMutableMethod(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

function shouldSkipCsrf(path: string): boolean {
  return path === '/auth/login' || path.startsWith('/webhook/');
}

interface CachedGetResponse {
  expiresAtMs: number;
  statusCode: number;
  contentType: string;
  payload: string;
}

const GET_RESPONSE_CACHE_MAX_ENTRIES = 500;
const getResponseCache = new Map<string, CachedGetResponse>();

function getResponseCacheTtlMs(): number {
  const configured = Number(process.env.GET_RESPONSE_CACHE_TTL_MS || '');
  if (Number.isFinite(configured) && configured >= 0) {
    return configured;
  }
  return process.env.VITEST ? 0 : 1_000;
}

function isCacheableGetPath(path: string): boolean {
  return path === '/health'
    || path === '/metrics/summary'
    || path === '/conversations'
    || path === '/tasks';
}

function getSessionCachePartition(cookieHeader: string | undefined): string {
  const cookies = parseCookieHeader(cookieHeader);
  return cookies[SESSION_COOKIE_NAME] || 'anonymous';
}

function getResponseCacheKey(url: string, cookieHeader: string | undefined): string | null {
  const [path] = url.split('?');
  if (!path || !isCacheableGetPath(path)) {
    return null;
  }

  if (path === '/health') {
    return `GET ${url}`;
  }

  return `GET ${url} session:${getSessionCachePartition(cookieHeader)}`;
}

function setGetResponseCache(key: string, response: CachedGetResponse): void {
  if (getResponseCache.size >= GET_RESPONSE_CACHE_MAX_ENTRIES) {
    getResponseCache.clear();
  }
  getResponseCache.set(key, response);
}
import { registerTaskRoutes } from '@cvg/tasks';
import { registerNoteRoutes } from '@cvg/notes';
import { registerAlertRoutes } from '@cvg/alerts';
import { registerDashboardRoutes } from '@cvg/dashboard';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, SESSION_COOKIE_NAME, parseCookieHeader, registerAuthRoutes } from '@cvg/auth';
import { registerAuditRoutes } from '@cvg/audit';
import { registerAdminRoutes } from '@cvg/admin';
import { initializeSecretaryClient } from '@cvg/integrations';
import { registerLabelRoutes } from '@cvg/labels';
import { registerSectorRoutes } from '@cvg/sectors';
import { registerTransferRoutes } from '@cvg/transfers';
import { registerContactGroupRoutes } from '@cvg/contact-groups';
import { registerKanbanRoutes } from '@cvg/kanban';
import { registerGatewayRoutes, mediaService, setGatewayDeskHandlers, setGatewayReplayStore } from '@cvg/gateway-adapter';
import { registerContactRoutes } from '@cvg/contacts';
import { initializeAlerting, registerAlertingErrorHooks } from './alerting';
import { getMetrics, getContentType } from './metrics';
import { createInternalEventsGuard } from './internal-auth';

function configureModuleAdapters(): void {
  configureWebhookSecurityDecisionSink(persistWebhookSecurityDecision);
  setGatewayReplayStore({
    claim: (scope, nonce, expiresAt) => claimGatewayRequestNonce(scope, nonce, expiresAt),
  });

  setOutboundDeliveryService({
    async send(input) {
      const phone = input.recipient.replace(/@.*$/, '').replace(/\D/g, '');

      if (input.mediaUrl && input.mediaType === 'image') {
        return mediaService.sendImage(phone, input.mediaUrl, input.content);
      }
      if (input.mediaUrl && input.mediaType === 'audio') {
        return mediaService.sendAudio(phone, input.mediaUrl);
      }
      if (input.mediaUrl && input.mediaType === 'document') {
        return mediaService.sendDocument(phone, input.mediaUrl, input.mediaFilename);
      }

      return mediaService.sendText(phone, input.content);
    },
  });

  setGatewayDeskHandlers({
    async receiveInboundMessage(input) {
      const result = await receiveInboundMessage(input);
      if (result.isErr()) {
        throw result.error;
      }

      return result.value;
    },

    async findPendingOutbound(limit) {
      return messageRepository.findPendingOutbound(limit);
    },

    async markOutboundSent(id, externalMessageId) {
      await messageRepository.update(id, {
        status: 'sent',
        externalMessageId,
      });
    },

    async updateReceipt(externalMessageId, status, deliveredAt) {
      const message = await messageRepository.findByExternalId(externalMessageId);
      if (!message) {
        return { updated: false, skipped: true, reason: 'message_not_found' };
      }

      await messageRepository.update(message.id, {
        status: status as typeof message.status,
        deliveredAt,
      });

      return { updated: true, messageId: message.id, status };
    },
  });
}

export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    database?: { status: 'ok' | 'error'; latencyMs: number; error?: string };
    redis?: { status: 'ok' | 'error'; latencyMs?: number; error?: string };
    gateway?: { status: 'ok' | 'error'; latencyMs?: number; error?: string };
  };
}

export interface ReadinessResult {
  ready: boolean;
  checks: {
    migrations_applied: { status: 'ok' | 'error'; error?: string };
    db_connectivity: { status: 'ok' | 'error'; latencyMs?: number; error?: string };
    auth_service: { status: 'ok' | 'error'; error?: string };
  };
  timestamp: string;
  retryAfter?: number;
}

async function checkDatabaseHealth(): Promise<{ status: 'ok' | 'error'; latencyMs: number; error?: string }> {
  const dbStart = Date.now();
  try {
    const { db, schema } = await import('@cvg/database');
    await db.select().from(schema.users).limit(1);
    return { status: 'ok', latencyMs: Date.now() - dbStart };
  } catch (err: unknown) {
    return { status: 'error', latencyMs: Date.now() - dbStart, error: errorMessage(err) };
  }
}

async function checkRedisHealth(): Promise<{ status: 'ok' | 'error'; latencyMs?: number; error?: string }> {
  if (!process.env.REDIS_URL) {
    return { status: 'ok' }; // Redis is optional
  }
  const redisStart = Date.now();
  try {
    const url = new URL(process.env.REDIS_URL!);
    const net = await import('node:net');
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({
        host: url.hostname,
        port: Number(url.port || 6379),
      });
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('Connection timeout'));
      }, 5000);

      socket.once('connect', () => {
        clearTimeout(timeout);
        socket.end();
        resolve();
      });
      socket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    return { status: 'ok', latencyMs: Date.now() - redisStart };
  } catch (err: unknown) {
    return { status: 'error', latencyMs: Date.now() - redisStart, error: err instanceof Error ? err.message : String(err) };
  }
}

async function checkGatewayHealth(): Promise<{ status: 'ok' | 'error'; latencyMs?: number; error?: string }> {
  if (!process.env.GATEWAY_URL) {
    return { status: 'ok' }; // Gateway is optional
  }
  const gatewayStart = Date.now();
  try {
    const response = await fetch(`${process.env.GATEWAY_URL}/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      return { status: 'ok', latencyMs: Date.now() - gatewayStart };
    }
    return { status: 'error', latencyMs: Date.now() - gatewayStart, error: `Gateway returned ${response.status}` };
  } catch (err: unknown) {
    return { status: 'error', latencyMs: Date.now() - gatewayStart, error: errorMessage(err) };
  }
}

type DependencyHealthChecks = Pick<HealthCheckResult['checks'], 'database' | 'redis' | 'gateway'>;

let healthCache: { expiresAtMs: number; checks: DependencyHealthChecks } | null = null;
let healthInFlight: Promise<DependencyHealthChecks> | null = null;

function getHealthCacheTtlMs(): number {
  const configured = Number(process.env.HEALTH_CACHE_TTL_MS || '');
  if (Number.isFinite(configured) && configured >= 0) {
    return configured;
  }
  return process.env.VITEST ? 0 : 1_000;
}

async function getDependencyHealthChecks(): Promise<DependencyHealthChecks> {
  const ttlMs = getHealthCacheTtlMs();
  const now = Date.now();
  if (ttlMs > 0 && healthCache && healthCache.expiresAtMs > now) {
    return healthCache.checks;
  }

  if (healthInFlight) {
    return healthInFlight;
  }

  healthInFlight = Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
    checkGatewayHealth(),
  ]).then(([database, redis, gateway]) => {
    const checks = { database, redis, gateway };
    if (ttlMs > 0) {
      healthCache = {
        checks,
        expiresAtMs: Date.now() + ttlMs,
      };
    }
    return checks;
  }).finally(() => {
    healthInFlight = null;
  });

  return healthInFlight;
}

export async function buildDeskApiApp(): Promise<FastifyInstance> {
  warnOnProductionWebhookMisconfiguration();
  configureModuleAdapters();

  const app = Fastify({
    logger: {
      level: resolveLogLevel(),
      transport: process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
        : undefined,
    },
    trustProxy: resolveTrustedProxies(),
    bodyLimit: 1048576,
  }).withTypeProvider<ZodTypeProvider>();

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode || 500;
    const correlationId = request.id;

    if (statusCode >= 500) {
      request.log.error({
        err: error,
        path: request.url,
        method: request.method,
        correlation_id: correlationId,
        service: 'desk-api',
      }, 'Erro interno');
    } else {
      request.log.warn({
        err: error,
        path: request.url,
        method: request.method,
        correlation_id: correlationId,
        service: 'desk-api',
      }, 'Erro de requisição');
    }

    reply.status(statusCode).send({
      error: error.code || 'INTERNAL_ERROR',
      message: statusCode >= 500 ? 'Internal server error' : error.message,
      statusCode,
      timestamp: new Date().toISOString(),
      correlation_id: correlationId,
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
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  const isProduction = process.env.NODE_ENV === 'production';
  const corsOrigin = process.env.CORS_ORIGIN;

  // CORS hardening: reject * in production
  if (isProduction && (!corsOrigin || corsOrigin === '*')) {
    throw new Error('CORS_ORIGIN must be set to specific origins in production. Got: ' + corsOrigin);
  }
  if (corsOrigin && corsOrigin.includes('*')) {
    if (isProduction) {
      throw new Error('Wildcard * is not allowed in CORS_ORIGIN in production');
    }
    app.log.warn('[CORS] Wildcard * detected in CORS_ORIGIN. This is insecure for production.');
  }

  await app.register(cors, {
    origin: corsOrigin ? corsOrigin.split(',').map(origin => origin.trim()).filter(Boolean) : isProduction ? false : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-CSRF-Token'],
    credentials: true,
    maxAge: 86400,
  });

  app.addHook('onRequest', async (request, reply) => {
    if (request.method.toUpperCase() !== 'GET') {
      return;
    }

    const ttlMs = getResponseCacheTtlMs();
    if (ttlMs <= 0) {
      return;
    }

    const cacheKey = getResponseCacheKey(request.url, request.headers.cookie);
    if (!cacheKey) {
      return;
    }

    const cached = getResponseCache.get(cacheKey);
    if (!cached) {
      return;
    }

    if (cached.expiresAtMs <= Date.now()) {
      getResponseCache.delete(cacheKey);
      return;
    }

    reply
      .status(cached.statusCode)
      .header('Content-Type', cached.contentType)
      .header('X-Cache', 'HIT')
      .send(cached.payload);
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (request.method.toUpperCase() !== 'GET' || reply.statusCode !== 200 || typeof payload !== 'string') {
      return payload;
    }

    const ttlMs = getResponseCacheTtlMs();
    if (ttlMs <= 0) {
      return payload;
    }

    const cacheKey = getResponseCacheKey(request.url, request.headers.cookie);
    if (!cacheKey || reply.getHeader('X-Cache') === 'HIT') {
      return payload;
    }

    const contentType = String(reply.getHeader('content-type') || 'application/json; charset=utf-8');
    setGetResponseCache(cacheKey, {
      statusCode: reply.statusCode,
      contentType,
      payload,
      expiresAtMs: Date.now() + ttlMs,
    });

    return payload;
  });

  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0] || request.url;
    if (!isMutableMethod(request.method) || shouldSkipCsrf(path)) {
      return;
    }

    const cookies = parseCookieHeader(request.headers.cookie);
    const sessionCookie = cookies[SESSION_COOKIE_NAME];
    if (!sessionCookie) {
      return;
    }

    const csrfCookie = cookies[CSRF_COOKIE_NAME];
    const csrfHeader = request.headers[CSRF_HEADER_NAME];
    const csrfHeaderValue = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;

    if (!csrfCookie || !csrfHeaderValue || csrfHeaderValue !== csrfCookie) {
      return reply.status(403).send({
        error: 'CSRF_TOKEN_INVALID',
        message: 'Invalid CSRF token',
      });
    }
  });

  await app.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX) || 100,
    timeWindow: process.env.RATE_LIMIT_WINDOW || '1 minute',
    keyGenerator: (req) => {
      const path = req.url;
      // Apply stricter limits for auth endpoints
      if (path.includes('/auth/')) {
        return `auth:${(req.user?.id as string) || req.ip}`;
      }
      // Webhook endpoints have their own rate limit via WEBHOOK_SECRET
      if (path.includes('/webhook/')) {
        return `webhook:${req.ip}`;
      }
      return (req.user?.id as string) || req.ip;
    },
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
        { name: 'Health', description: 'Health checks' },
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

  // R1: Enhanced Health Check with sub-checks
  app.get('/health', {
    schema: {
      description: 'Liveness check with dependency status — R1',
      tags: ['Health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok', 'degraded', 'error'] },
            timestamp: { type: 'string' },
            uptime: { type: 'number' },
            version: { type: 'string' },
            checks: {
              type: 'object',
              properties: {
                database: { type: 'object', properties: { status: { type: 'string' }, latencyMs: { type: 'number' }, error: { type: 'string' } } },
                redis: { type: 'object', properties: { status: { type: 'string' }, latencyMs: { type: 'number' }, error: { type: 'string' } } },
                gateway: { type: 'object', properties: { status: { type: 'string' }, latencyMs: { type: 'number' }, error: { type: 'string' } } },
              },
            },
          },
        },
      },
    },
  }, async (): Promise<HealthCheckResult> => {
    const { database: dbCheck, redis: redisCheck, gateway: gatewayCheck } = await getDependencyHealthChecks();

    const allOk = dbCheck?.status === 'ok'
      && (!process.env.REDIS_URL || redisCheck?.status === 'ok')
      && (!process.env.GATEWAY_URL || gatewayCheck?.status === 'ok');
    const anyError = dbCheck?.status === 'error'
      || redisCheck?.status === 'error'
      || gatewayCheck?.status === 'error';

    return {
      status: anyError ? 'error' : allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      checks: {
        database: dbCheck,
        ...(process.env.REDIS_URL && { redis: redisCheck }),
        ...(process.env.GATEWAY_URL && { gateway: gatewayCheck }),
      },
    };
  });

  // O1: Prometheus Metrics endpoint
  app.get('/metrics', {
    schema: {
      description: 'Prometheus metrics endpoint — O1',
      tags: ['Health'],
      response: {
        200: { type: 'string' },
      },
    },
  }, async (request, reply) => {
    reply.header('Content-Type', getContentType());
    return getMetrics();
  });

  // R2: Enhanced Readiness with migrations check
  app.get('/readiness', {
    schema: {
      description: 'Readiness check with full dependency validation — R2',
      tags: ['Health'],
      response: {
        200: { type: 'object' },
        503: { type: 'object' },
      },
    },
  }, async (request, reply) => {
    const checks: ReadinessResult['checks'] = {
      migrations_applied: { status: 'ok' },
      db_connectivity: { status: 'ok' },
      auth_service: { status: 'ok' },
    };

    // Check DB connectivity
    try {
      const dbModule = await import('@cvg/database');
      const { db, schema } = dbModule;
      const dbStart = Date.now();
      await db.select().from(schema.users).limit(1);
      checks.db_connectivity = { status: 'ok', latencyMs: Date.now() - dbStart };
    } catch (err: unknown) {
      checks.db_connectivity = { status: 'error', error: err instanceof Error ? err.message : String(err) };
    }

    // Check migrations (simplified: just verify tables exist)
    try {
      const dbModule = await import('@cvg/database');
      const { db, schema } = dbModule;
      // Check that critical tables exist
      await db.select().from(schema.conversations).limit(0);
      await db.select().from(schema.messages).limit(0);
      await db.select().from(schema.tasks).limit(0);
      checks.migrations_applied = { status: 'ok' };
    } catch (err: unknown) {
      checks.migrations_applied = { status: 'error', error: err instanceof Error ? err.message : String(err) };
    }

    // Auth service check (basic: auth module loaded)
    try {
      const authModule = await import('@cvg/auth');
      if (!authModule.authenticate) {
        throw new Error('Auth module not properly loaded');
      }
      checks.auth_service = { status: 'ok' };
    } catch (err: unknown) {
      checks.auth_service = { status: 'error', error: err instanceof Error ? err.message : String(err) };
    }

    const allReady = Object.values(checks).every((c) => c.status === 'ok');

    if (!allReady) {
      reply.header('Retry-After', '30');
      return reply.status(503).send({
        ready: false,
        checks,
        timestamp: new Date().toISOString(),
        retryAfter: 30,
      } satisfies ReadinessResult);
    }

    return {
      ready: true,
      checks,
      timestamp: new Date().toISOString(),
    } satisfies ReadinessResult;
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
            serverTime: { type: 'string' },
          },
        },
      },
    },
  }, async (request) => {
    const { ConsumerAwareOutboxReader, CONSUMER_IDS } = await import('@cvg/events');
    const query = request.query as { since?: string; limit?: number };

    const reader = new ConsumerAwareOutboxReader({
      consumerId: CONSUMER_IDS.HTTP_POLL,
      batchSize: query.limit || 50,
      maxRetries: 3,
    });
    let events = await reader.fetchPendingEvents();

    if (query.since) {
      const sinceDate = new Date(query.since);
      events = events.filter((e) => e.occurredAt > sinceDate);
    }

    for (const event of events) {
      await reader.acknowledge(event.eventId);
    }

    const envelopes = events.map((e) => reader.toEventEnvelope(e));

    return {
      events: envelopes,
      serverTime: new Date().toISOString(),
    };
  });

  await registerInboundWebhook(app);
  await registerOutboundController(app);
  await registerTaskRoutes(app);
  await registerNoteRoutes(app);
  await registerAlertRoutes(app);
  await registerDashboardRoutes(app);
  await registerAuthRoutes(app);
  await registerAuditRoutes(app);
  await registerAdminRoutes(app);
  await registerLabelRoutes(app);
  await registerSectorRoutes(app);
  await registerTransferRoutes(app);
  await registerContactGroupRoutes(app);
  await registerKanbanRoutes(app);
  await registerGatewayRoutes(app);
  await registerContactRoutes(app);

  initializeAlerting(app);
  registerAlertingErrorHooks(app);

  return app;
}
