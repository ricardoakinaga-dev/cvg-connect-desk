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
    origin: corsOrigin ? corsOrigin.split(',') : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
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
    skipOnError: true,
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
    const checks: Record<string, { status: 'ok' | 'error'; latencyMs?: number; error?: string }> = {};

    const dbStart = Date.now();
    try {
      const dbModule = await import('@cvg/database');
      const { db, schema: dbSchema } = dbModule;
      await db.select().from(dbSchema.users).limit(1);
      checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
    } catch (err: any) {
      checks.database = { status: 'error', latencyMs: Date.now() - dbStart, error: err.message };
    }

    if (process.env.REDIS_URL) {
      checks.redis = { status: 'ok' };
    }

    const allReady = Object.values(checks).every((c) => c.status === 'ok');
    return {
      ready: allReady,
      checks,
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

  return app;
}
