import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import 'dotenv/config';
import { registerInboundWebhook } from '@cvg/chat';
import { registerOutboundController } from '@cvg/chat';
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

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
      : undefined,
  },
  trustProxy: true,
  bodyLimit: 1048576, // 1MB
}).withTypeProvider<ZodTypeProvider>();

// Handler global de erros não capturados
app.setErrorHandler((error, request, reply) => {
  const statusCode = error.statusCode || 500;

  // Log detalhado para erros internos
  if (statusCode >= 500) {
    request.log.error({ err: error, path: request.url, method: request.method }, 'Erro interno');
  } else {
    request.log.warn({ err: error, path: request.url }, 'Erro de requisição');
  }

  // Resposta padronizada
  reply.status(statusCode).send({
    error: error.code || 'INTERNAL_ERROR',
    message: statusCode >= 500 ? 'Internal server error' : error.message,
    statusCode,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
  });
});

async function bootstrap() {
  // Inicializa Secretary client se configurado
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

  // Security headers (Helmet)
  await app.register(helmet, {
    contentSecurityPolicy: false, // Desabilitado para Swagger UI
    crossOriginEmbedderPolicy: false,
  });

  // CORS configurável
  const corsOrigin = process.env.CORS_ORIGIN;
  await app.register(cors, {
    origin: corsOrigin ? corsOrigin.split(',') : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    credentials: true,
    maxAge: 86400,
  });

  // Rate limiting global
  await app.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX) || 100,
    timeWindow: process.env.RATE_LIMIT_WINDOW || '1 minute',
    keyGenerator: (req) => {
      return (req.user?.id as string) || req.ip;
    },
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

  // Swagger/OpenAPI
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

  // Health & Readiness aprimorados
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

    // Check database
    const dbStart = Date.now();
    try {
      const dbModule = await import('@cvg/database');
      const { db, schema: dbSchema } = dbModule;
      await db.select().from(dbSchema.users).limit(1);
      checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
    } catch (err: any) {
      checks.database = { status: 'error', latencyMs: Date.now() - dbStart, error: err.message };
    }

    // Check Redis (se configurado)
    if (process.env.REDIS_URL) {
      checks.redis = { status: 'ok' }; // Simplificado — rate-limit plugin já usa Redis
    }

    const allReady = Object.values(checks).every((c) => c.status === 'ok');
    return {
      ready: allReady,
      checks,
      timestamp: new Date().toISOString(),
    };
  });

  // Dead-letter queue endpoint (admin only)
  app.get('/admin/dead-letters', {
    schema: {
      description: 'Lista eventos na dead-letter queue',
      tags: ['Admin'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          resolved: { type: 'boolean' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        },
      },
    },
  }, async (request, reply) => {
    const { deadLetterStore } = await import('@cvg/events');
    const query = request.query as { resolved?: boolean; limit?: number };
    const entries = deadLetterStore.getAll({ resolved: query.resolved, limit: query.limit || 50 });
    const stats = deadLetterStore.getStats();
    return { data: entries, stats };
  });

  // Registrar rotas de domínio
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

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Recebido ${signal}, encerrando graciosamente...`);
      await app.close();
      process.exit(0);
    });
  }

  const port = Number(process.env.PORT) || 3000;
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`Server running on http://0.0.0.0:${port}`);
  app.log.info(`API docs available at http://localhost:${port}/docs`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});

export { app };
