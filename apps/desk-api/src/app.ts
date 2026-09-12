import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import 'dotenv/config';
import { registerInboundWebhook, registerOutboundController } from '@cvg/chat';

function isProduction(): boolean {
  const env = (process.env.NODE_ENV || process.env.DESK_ENV || '').toLowerCase();
  return env === 'production' || env === 'prod';
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
import { initializeSecretaryClient } from '@cvg/integrations';
import { registerLabelRoutes } from '@cvg/labels';
import { registerSectorRoutes } from '@cvg/sectors';
import { registerTransferRoutes } from '@cvg/transfers';
import { registerContactGroupRoutes } from '@cvg/contact-groups';
import { registerKanbanRoutes } from '@cvg/kanban';
import { registerGatewayRoutes } from '@cvg/gateway-adapter';
import { registerContactRoutes } from '@cvg/contacts';

export async function buildDeskApiApp(): Promise<FastifyInstance> {
  warnOnProductionWebhookMisconfiguration();
  assertProductionEnv();

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
        : undefined,
    },
    trustProxy: true,
    bodyLimit: 1048576,
  }).withTypeProvider<ZodTypeProvider>();

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

  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode || 500;

    if (statusCode >= 500) {
      request.log.error({ err: error, path: request.url, method: request.method }, 'Erro interno');
    } else {
      request.log.warn({ err: error, path: request.url }, 'Erro de requisição');
    }

    reply.status(statusCode).send({
      error: error.code || 'INTERNAL_ERROR',
      message: statusCode >= 500 ? 'Internal server error' : error.message,
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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Webhook-Signature', 'X-Webhook-Timestamp', 'X-Webhook-Event-Id'],
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
      description: 'Liveness check — verifica se o processo está vivo',
      tags: ['Health'],
      response: { 200: { type: 'object', properties: { status: { type: 'string' }, timestamp: { type: 'string' }, uptime: { type: 'number' }, version: { type: 'string' } } } },
    },
  }, async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
  }));

  app.get('/readiness', {
    schema: {
      description: 'Readiness check — verifica se o serviço está apto a operar',
      tags: ['Health'],
      response: { 200: { type: 'object' } },
    },
  }, async () => {
    const checks: Record<string, { status: 'ok' | 'error' | 'degraded'; latencyMs?: number; error?: string }> = {};

    const dbStart = Date.now();
    try {
      const dbModule = await import('@cvg/database');
      const { db, schema: dbSchema } = dbModule;
      await db.select().from(dbSchema.users).limit(1);
      checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
    } catch (err: any) {
      checks.database = { status: 'error', latencyMs: Date.now() - dbStart, error: err?.message || 'db failed' };
    }

    if (process.env.REDIS_URL) {
      const redisStart = Date.now();
      try {
        // PING real via TCP sem depender do pacote `redis` (evita dep nova no hot path).
        const redisUrl = new URL(process.env.REDIS_URL);
        const host = redisUrl.hostname || 'localhost';
        const port = Number(redisUrl.port) || 6379;
        const pong = await new Promise<string>((resolve, reject) => {
          import('net').then(({ default: net }) => {
            const socket = net.connect(port, host);
            const timer = setTimeout(() => {
              socket.destroy();
              reject(new Error('redis ping timeout'));
            }, 3000);
            socket.on('connect', () => socket.write('PING\r\n'));
            socket.on('data', (data: Buffer) => {
              clearTimeout(timer);
              socket.end();
              resolve(data.toString());
            });
            socket.on('error', (err: Error) => {
              clearTimeout(timer);
              reject(err);
            });
          }).catch(reject);
        });
        checks.redis = pong.includes('PONG')
          ? { status: 'ok', latencyMs: Date.now() - redisStart }
          : { status: 'degraded', error: `unexpected redis reply: ${pong.slice(0, 32)}` };
      } catch (err: any) {
        checks.redis = { status: 'error', latencyMs: Date.now() - redisStart, error: err?.message || 'redis failed' };
      }
    }

    try {
      const dbModule = await import('@cvg/database');
      await (dbModule.db as unknown as { execute: (q: unknown) => Promise<unknown> }).execute('SELECT 1');
      checks.migrations = { status: 'ok' };
    } catch (err: any) {
      checks.migrations = { status: 'error', error: err?.message || 'migration check failed' };
    }

    const secretaryUrl = process.env.SECRETARY_URL;
    if (secretaryUrl) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`${secretaryUrl.replace(/\/$/, '')}/health`, { signal: controller.signal });
        clearTimeout(timer);
        checks.secretary = res.ok ? { status: 'ok' } : { status: 'degraded', error: `http ${res.status}` };
      } catch (err: any) {
        checks.secretary = { status: 'degraded', error: err?.message || 'secretary unreachable' };
      }
    }

    const fatalFailed = ['database', 'migrations'].some((k) => checks[k]?.status === 'error');
    const degraded = Object.values(checks).some((c) => c.status === 'degraded' || c.status === 'error') && !fatalFailed;
    return {
      ready: !fatalFailed,
      degraded,
      checks,
      version: process.env.npm_package_version || '1.0.0',
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/events', {
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
            leaseSeconds: { type: 'integer' },
            ackEndpoint: { type: 'string' },
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
    // Semântica de lease: GET apenas aluga (claim); o ACK é explícito via POST /events/:id/ack.
    let events = await reader.claimPendingEvents({ leaseOwner: 'http-poll', leaseSeconds: 120 });

    if (query.since) {
      const sinceDate = new Date(query.since);
      events = events.filter((e) => e.occurredAt > sinceDate);
    }

    const envelopes = events.map((e) => reader.toEventEnvelope(e));

    return {
      events: envelopes,
      leaseSeconds: 120,
      ackEndpoint: '/events/:eventId/ack',
      serverTime: new Date().toISOString(),
    };
  });

  app.post('/events/:eventId/ack', {
    schema: {
      description: 'Explicit ACK for a leased outbox event (http-poll consumer)',
      tags: ['Internal'],
      params: {
        type: 'object',
        properties: { eventId: { type: 'string', minLength: 1 } },
        required: ['eventId'],
      },
    },
  }, async (request) => {
    const { ConsumerAwareOutboxReader, CONSUMER_IDS } = await import('@cvg/events');
    const { eventId } = request.params as { eventId: string };
    const reader = new ConsumerAwareOutboxReader({
      consumerId: CONSUMER_IDS.HTTP_POLL,
      batchSize: 1,
      maxRetries: 3,
    });
    await reader.acknowledge(eventId);
    return { acknowledged: true, eventId };
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

  return app;
}
