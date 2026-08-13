import 'dotenv/config';
import {
  shouldRetry,
  calculateNextDelay,
  createRetryContext,
  type RetryConfig,
  type EventEnvelope,
  ConsumerAwareOutboxReader,
  CONSUMER_IDS,
} from '@cvg/events';
import { createAlert } from '@cvg/alerts';
import { recordWorkerDeadLetter } from './dead-letter';
import { createLogger } from '@cvg/shared';
import { createNoOverlapPoller } from './polling';
import { startWorkerHealthServer } from './health';

const logger = createLogger({ service: 'worker' });

const RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

const workerReader = new ConsumerAwareOutboxReader({
  consumerId: CONSUMER_IDS.WORKER,
  batchSize: 50,
  maxRetries: 3,
});

async function handleHandoffCompleted(event: EventEnvelope): Promise<void> {
  const payload = event.payload as {
    conversationId: string;
    previousHandler: 'bot' | 'human';
    newHandler: 'bot' | 'human';
    reason: string;
    triggeredBy?: string;
  };

  logger.info('[Worker] Processing handoff.completed', {
    event_type: event.event_type,
    event_id: event.event_id,
    correlation_id: event.correlation_id,
    conversation_id: payload.conversationId,
    previousHandler: payload.previousHandler,
    newHandler: payload.newHandler,
  });

  if (payload.newHandler === 'human' && payload.reason) {
    const alertResult = await createAlert({
      conversationId: payload.conversationId,
      type: 'handoff',
      title: 'Conversa transferida para atendimento humano',
      message: `Motivo: ${payload.reason}`,
      severity: 'info',
      triggeredBy: payload.triggeredBy,
      metadata: {
        previousHandler: payload.previousHandler,
        newHandler: payload.newHandler,
        eventId: event.event_id,
      },
    });

    if (alertResult.isErr()) {
      logger.error('[Worker] Failed to create alert for handoff', {
        conversation_id: payload.conversationId,
        error: alertResult.error.message,
      });
    }
  }
}

async function handleSecretaryInvocation(event: EventEnvelope): Promise<void> {
  const payload = event.payload as {
    conversationId: string;
    status: 'requested' | 'success' | 'failed';
    action: string;
    errorMessage?: string;
  };

  logger.info('[Worker] Processing secretary.invocation', {
    event_type: event.event_type,
    event_id: event.event_id,
    correlation_id: event.correlation_id,
    conversation_id: payload.conversationId,
    action: payload.action,
    status: payload.status,
  });

  if (payload.status === 'failed' && payload.errorMessage) {
    logger.warn('[Worker] Secretary invocation failed', {
      event_type: event.event_type,
      event_id: event.event_id,
      correlation_id: event.correlation_id,
      conversation_id: payload.conversationId,
      action: payload.action,
      status: payload.status,
      error: payload.errorMessage,
    });
    const alertResult = await createAlert({
      conversationId: payload.conversationId,
      type: 'system',
      title: 'Falha na chamada à Secretary',
      message: `Action: ${payload.action}, Erro: ${payload.errorMessage}`,
      severity: 'warning',
      metadata: {
        eventId: event.event_id,
        action: payload.action,
      },
    });

    if (alertResult.isErr()) {
      logger.error('[Worker] Failed to create alert for secretary failure', {
        conversation_id: payload.conversationId,
        error: alertResult.error.message,
      });
    }
  }
}

async function handleMessagePersisted(event: EventEnvelope): Promise<void> {
  const payload = event.payload as {
    conversationId: string;
    direction: 'inbound' | 'outbound';
    content: string;
  };

  logger.debug('[Worker] Processing message.persisted', {
    event_type: event.event_type,
    event_id: event.event_id,
    correlation_id: event.correlation_id,
    conversation_id: payload.conversationId,
    direction: payload.direction,
  });
}

const handlers: Record<string, (event: EventEnvelope) => Promise<void>> = {
  'handoff.completed': handleHandoffCompleted,
  'secretary.invocation': handleSecretaryInvocation,
  'message.persisted': handleMessagePersisted,
};

async function processEventFromOutbox(eventId: string, event: EventEnvelope): Promise<void> {
  const handler = handlers[event.event_type];

  if (!handler) {
    logger.warn('[Worker] No handler for event type, acknowledging without processing', {
      event_type: event.event_type,
      event_id: event.event_id,
      correlation_id: event.correlation_id,
    });
    await workerReader.acknowledge(eventId);
    return;
  }

  let attempt = 0;

  while (true) {
    try {
      await handler(event);
      logger.info('[Worker] Successfully processed event', {
        event_type: event.event_type,
        event_id: event.event_id,
        correlation_id: event.correlation_id,
        handler: handler.name || event.event_type,
      });
      await workerReader.acknowledge(eventId);
      break;
    } catch (error) {
      const err = error as Error;
      const failureCount = attempt + 1;
      const updatedContext = createRetryContext(event, event.event_type, failureCount, err);

      if (!shouldRetry(updatedContext, RETRY_CONFIG)) {
        logger.error('[Worker] Non-retryable error — sending to dead-letter', {
          event_type: event.event_type,
          event_id: event.event_id,
          correlation_id: event.correlation_id,
          handler: handler.name || event.event_type,
          error: err.message,
          retry_count: failureCount,
          retry_decision: 'dead-letter',
          failure_stage: 'worker-terminal',
        });
        await workerReader.acknowledgeWithError(eventId, err.message);
        await recordWorkerDeadLetter({
          event,
          error: err.message,
          retryCount: failureCount,
          handlerName: handler.name || event.event_type,
        });
        break;
      }

      attempt = failureCount;
      const delay = calculateNextDelay(RETRY_CONFIG, attempt);

      logger.warn('[Worker] Retrying event after error', {
        event_type: event.event_type,
        event_id: event.event_id,
        correlation_id: event.correlation_id,
        handler: handler.name || event.event_type,
        attempt,
        max_retries: RETRY_CONFIG.maxRetries,
        delay_ms: delay,
        error: err.message,
      });

      if (attempt >= RETRY_CONFIG.maxRetries) {
        logger.error('[Worker] Max retries exceeded — sending to dead-letter', {
          event_type: event.event_type,
          event_id: event.event_id,
          correlation_id: event.correlation_id,
          handler: handler.name || event.event_type,
          error: err.message,
          attempt,
          max_retries: RETRY_CONFIG.maxRetries,
          retry_decision: 'dead-letter',
          failure_stage: 'worker-terminal',
        });
        await workerReader.acknowledgeWithError(eventId, err.message);
        await recordWorkerDeadLetter({
          event,
          error: err.message,
          retryCount: attempt,
          handlerName: handler.name || event.event_type,
        });
        break;
      }

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function startWorker(): Promise<void> {
  const outboxPollInterval = Number(process.env.OUTBOX_POLL_INTERVAL_MS) || 500;
  const healthPort = Number(process.env.WORKER_HEALTH_PORT) || 9090;

  const healthServer = startWorkerHealthServer(healthPort);
  healthServer.on('error', (error) => {
    logger.fatal('[Worker] Health server failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });

  logger.info('[Worker] Starting message worker', {
    consumer_id: CONSUMER_IDS.WORKER,
    handlers: ['handoff.completed', 'secretary.invocation', 'message.persisted'],
    poll_interval_ms: outboxPollInterval,
    health_port: healthPort,
  });

  createNoOverlapPoller(async () => {
    try {
      const pendingEvents = await workerReader.fetchPendingEvents();

      if (pendingEvents.length > 0) {
        logger.info('[Worker] Fetched pending events from outbox', {
          count: pendingEvents.length,
        });

        for (const outboxEvent of pendingEvents) {
          const eventEnvelope = workerReader.toEventEnvelope(outboxEvent);
          await processEventFromOutbox(outboxEvent.eventId, eventEnvelope);
        }
      }
    } catch (error) {
      logger.error('[Worker] Error polling outbox', {
        error: (error as Error).message,
      });
    }
  }, outboxPollInterval);

  logger.info('[Worker] Worker started successfully');
}

startWorker().catch(error => {
  logger.fatal('[Worker] Failed to start worker', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});

process.on('SIGTERM', () => {
  logger.info('[Worker] Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('[Worker] Received SIGINT, shutting down gracefully');
  process.exit(0);
});

export { startWorker };
