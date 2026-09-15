import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { initTracing, withSpan, correlationAttributes } from '@cvg/tracing';
import {
  ConsumerAwareOutboxReader,
  CONSUMER_IDS,
  type EventEnvelope,
  type RetryConfig,
} from '@cvg/events';
import {
  recoverPendingInboundMedia,
  setGatewayOutboundPort,
  waitForInboundMediaProcessing,
} from '@cvg/chat';
import { gatewayService } from '@cvg/gateway-adapter';
import { initializeSecretaryFromEnv } from '@cvg/secretary-adapter';
import { createEventProcessor, type ProcessEventOutcome } from './processor';
import { createHandlers } from './handlers';
import { redactErrorForLog } from './errors';
import { consoleWorkerLogger, WORKER_EVENT_TYPES, type WorkerLogger } from './contract';
import { recordWorkerDeadLetter } from './dead-letter';
import { createWorkerHealthTracker, startWorkerHealthServer, type WorkerHealthTracker } from './health';
import { createNoOverlapPoller } from './polling';

function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`[Worker] ${name} deve ser inteiro positivo (recebido "${raw}")`);
  }
  return value;
}

function envPositiveNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`[Worker] ${name} deve ser numérico positivo (recebido "${raw}")`);
  }
  return value;
}

// Orçamento de retry do worker: o MESMO valor governa o backoff em processo e
// o teto do consumidor no lease (outbox_consumer_acks.retry_count), de modo
// que "tentativas esgotadas" tem um sentido único para o operador.
const WORKER_MAX_RETRIES = envPositiveInt('WORKER_MAX_RETRIES', 3);
const RETRY_CONFIG: RetryConfig = {
  maxRetries: WORKER_MAX_RETRIES,
  initialDelayMs: envPositiveInt('WORKER_RETRY_INITIAL_DELAY_MS', 1000),
  maxDelayMs: envPositiveInt('WORKER_RETRY_MAX_DELAY_MS', 30000),
  backoffMultiplier: envPositiveNumber('WORKER_RETRY_BACKOFF_MULTIPLIER', 2),
};

const logger: WorkerLogger = consoleWorkerLogger;

// Catálogo explícito do worker: só estes tipos são claimados (BK06).
const workerReader = new ConsumerAwareOutboxReader({
  consumerId: CONSUMER_IDS.WORKER,
  batchSize: 50,
  maxRetries: WORKER_MAX_RETRIES,
  eventTypes: WORKER_EVENT_TYPES,
});

// Owner único do processo: fence de lease por (event_id, worker). Duas
// instâncias nunca processam o mesmo lease (claim atômico C03 D-C03-4).
const WORKER_OWNER = process.env.WORKER_OWNER || `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
const WORKER_LEASE_SECONDS = envPositiveInt('WORKER_LEASE_SECONDS', 120);
const MEDIA_RECOVERY_BATCH_SIZE = envPositiveInt('MEDIA_RECOVERY_BATCH_SIZE', 50);
const MEDIA_RECOVERY_LEASE_SECONDS = envPositiveInt('MEDIA_RECOVERY_LEASE_SECONDS', WORKER_LEASE_SECONDS);
const MEDIA_RECOVERY_MAX_ATTEMPTS = envPositiveInt('MEDIA_RECOVERY_MAX_ATTEMPTS', 8);
const MEDIA_RECOVERY_BACKOFF_BASE_MS = envPositiveInt('MEDIA_RECOVERY_BACKOFF_BASE_MS', 1000);
const MEDIA_RECOVERY_BACKOFF_MAX_MS = envPositiveInt('MEDIA_RECOVERY_BACKOFF_MAX_MS', 300_000);
const MEDIA_RECOVERY_OWNER = `${WORKER_OWNER}:media`;

// Injeção de falha para PROVA de crash/retomada: `crash` encerra o processo
// ANTES do efeito (entre o commit/claim do inbound e a invocação da Secretary).
// Nunca configurar em produção.
const FAULT_BEFORE_EFFECT = process.env.WORKER_FAULT_BEFORE_EFFECT;
if (FAULT_BEFORE_EFFECT && FAULT_BEFORE_EFFECT !== 'crash') {
  throw new Error(`[Worker] WORKER_FAULT_BEFORE_EFFECT inválido: "${FAULT_BEFORE_EFFECT}"`);
}

// Injeção de falha para PROVA de crash/retomada: `crash` encerra o processo
// DEPOIS do efeito commitado e ANTES do ACK. Nunca configurar em produção.
const FAULT_AFTER_EFFECT = process.env.WORKER_FAULT_AFTER_EFFECT;
if (FAULT_AFTER_EFFECT && FAULT_AFTER_EFFECT !== 'crash') {
  throw new Error(`[Worker] WORKER_FAULT_AFTER_EFFECT inválido: "${FAULT_AFTER_EFFECT}"`);
}

const handlers = createHandlers(logger);

function faultBeforeEffect(event: EventEnvelope): void {
  if (FAULT_BEFORE_EFFECT !== 'crash') return;
  logger.error({
    msg: '[Worker] fault injection: crashing before effect',
    event_id: event.event_id,
    event_type: event.event_type,
    correlation_id: event.correlation_id,
  });
  process.exit(86);
}

function faultAfterEffect(event: EventEnvelope): void {
  if (FAULT_AFTER_EFFECT !== 'crash') return;
  logger.error({
    msg: '[Worker] fault injection: crashing after effect before ACK',
    event_id: event.event_id,
    event_type: event.event_type,
    correlation_id: event.correlation_id,
  });
  process.exit(86);
}

const processEvent = createEventProcessor({
  handlers,
  retryConfig: RETRY_CONFIG,
  logger,
  ports: {
    // ACK cercado pelo token do lease (owner+generation): resultado observado
    // pelo processador — `stale`/`not_found` nunca é relatado como concluído.
    ack: (input) =>
      workerReader.acknowledge(input.eventId, { owner: input.owner, generation: input.generation }),
    nack: (input) => workerReader.nack(input),
  },
  onAfterEffect: faultAfterEffect,
  onBeforeEffect: faultBeforeEffect,
  onDeadLetter: ({ event, error, attempts, errorCode, handlerName }) => {
    recordWorkerDeadLetter({ event, error, retryCount: attempts, handlerName, errorCode });
  },
});

let workerPoller: ReturnType<typeof createNoOverlapPoller> | null = null;
let workerHealthServer: ReturnType<typeof startWorkerHealthServer> | null = null;
let workerHealthTracker: WorkerHealthTracker | null = null;

async function processClaimedEvent(event: EventEnvelope, lease: Parameters<typeof processEvent>[1]): Promise<ProcessEventOutcome | null> {
  try {
    return await withSpan(
      'worker.process',
      async () => processEvent(event, lease),
      correlationAttributes({
        event_id: event.event_id,
        event_type: event.event_type,
        correlation_id: event.correlation_id,
        causation_id: event.causation_id,
      }),
    );
  } catch (error) {
    // Falha de infraestrutura (ex.: banco indisponível no ACK/NACK): o lease
    // expira e o evento é reclamado. Nenhum `catch` marca sucesso.
    logger.error({
      msg: '[Worker] Unexpected error processing event; lease will be recovered',
      event_type: event.event_type,
      event_id: event.event_id,
      correlation_id: event.correlation_id,
      error: redactErrorForLog(error instanceof Error ? error.message : String(error)),
    });
    return null;
  }
}

async function startWorker(): Promise<void> {
  await initTracing();

  // Composição explícita (C02 §5): o worker que envia a resposta da IA usa o
  // MESMO provedor outbound da API (sem transporte paralelo) e inicializa o
  // cliente da Secretary a partir do ambiente; ausência vira falha observável.
  setGatewayOutboundPort(gatewayService);
  const secretary = initializeSecretaryFromEnv();
  if (secretary.configured) {
    logger.info({ msg: '[Worker] Secretary client initialized' });
  } else {
    logger.warn({ msg: '[Worker] Secretary client NOT configured — invocations will fail observably', reason: secretary.reason });
  }

  const outboxPollInterval = Number(process.env.OUTBOX_POLL_INTERVAL_MS || process.env.WORKER_POLL_INTERVAL_MS) || 500;
  const healthPort = Number(process.env.WORKER_HEALTH_PORT) || 9090;
  workerHealthTracker = createWorkerHealthTracker({
    pollIntervalMs: outboxPollInterval,
    maxQueueAgeSeconds: Number(process.env.WORKER_MAX_QUEUE_AGE_SECONDS) || 300,
  });

  workerHealthServer = startWorkerHealthServer(healthPort, () => workerHealthTracker!.snapshot());
  workerHealthServer.on('error', (error) => {
    logger.error({
      msg: '[Worker] Health server error',
      error: error instanceof Error ? error.message : String(error),
      port: healthPort,
    });
  });

  logger.info({
    msg: '[Worker] Starting message worker',
    consumer_id: CONSUMER_IDS.WORKER,
    handlers: [...WORKER_EVENT_TYPES],
    poll_interval_ms: outboxPollInterval,
    max_retries: WORKER_MAX_RETRIES,
  });

  workerPoller = createNoOverlapPoller(async () => {
    workerHealthTracker?.markLoopStarted();
    try {
      const pending = await workerReader.fetchPendingEvents();
      const oldestPendingAt = pending[0]?.createdAt ?? null;
      const claimed = await workerReader.claim({
        owner: WORKER_OWNER,
        leaseSeconds: WORKER_LEASE_SECONDS,
        limit: 50,
      });

      if (claimed.length > 0) {
        logger.info({
          msg: '[Worker] Claimed events from outbox with lease',
          count: claimed.length,
          owner: WORKER_OWNER,
          lease_seconds: WORKER_LEASE_SECONDS,
        });

        for (const { event, lease } of claimed) {
          await processClaimedEvent(event, lease);
        }
      }

      const recoveredMedia = await recoverPendingInboundMedia(MEDIA_RECOVERY_BATCH_SIZE, {
        owner: MEDIA_RECOVERY_OWNER,
        leaseSeconds: MEDIA_RECOVERY_LEASE_SECONDS,
        maxAttempts: MEDIA_RECOVERY_MAX_ATTEMPTS,
        backoffBaseMs: MEDIA_RECOVERY_BACKOFF_BASE_MS,
        backoffMaxMs: MEDIA_RECOVERY_BACKOFF_MAX_MS,
      });
      if (recoveredMedia > 0) {
        logger.info({
          msg: '[Worker] Recovered inbound media intake',
          count: recoveredMedia,
          owner: MEDIA_RECOVERY_OWNER,
        });
      }
      workerHealthTracker?.markLoopSucceeded({
        pendingCount: pending.length,
        oldestPendingAt,
      });
    } catch (error) {
      workerHealthTracker?.markLoopFailed(error);
      logger.error({
        msg: '[Worker] Error polling outbox',
        error: (error as Error).message,
      });
    }
  }, outboxPollInterval);

  logger.info({ msg: '[Worker] Worker started successfully' });
}

async function stopWorker(): Promise<void> {
  workerHealthTracker?.markStopping();
  const poller = workerPoller;
  poller?.stop();
  workerPoller = null;
  await poller?.waitForIdle();
  await waitForInboundMediaProcessing(undefined, WORKER_LEASE_SECONDS * 1000);
  const healthServer = workerHealthServer;
  workerHealthServer = null;
  await new Promise<void>((resolve) => {
    if (!healthServer) {
      resolve();
      return;
    }
    healthServer.close(() => resolve());
  });
  workerHealthTracker = null;
}

startWorker().catch(error => {
  logger.error({
    msg: '[Worker] Failed to start worker',
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});

let shutdownPromise: Promise<void> | null = null;

function requestShutdown(signal: NodeJS.Signals): void {
  logger.info({ msg: `[Worker] Received ${signal}, shutting down gracefully` });
  shutdownPromise ??= stopWorker();
  void shutdownPromise.then(() => process.exit(0));
}

process.on('SIGTERM', () => requestShutdown('SIGTERM'));
process.on('SIGINT', () => requestShutdown('SIGINT'));

export { startWorker, processEvent };
