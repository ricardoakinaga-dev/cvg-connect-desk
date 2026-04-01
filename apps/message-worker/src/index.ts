import 'dotenv/config';
import { eventPublisher, eventConsumer, type EventEnvelope } from '@cvg/events';
import { 
  shouldRetry, 
  calculateNextDelay, 
  createRetryContext, 
  defaultRetryConfig,
  type RetryConfig 
} from '@cvg/events';
import { deadLetterStore } from '@cvg/events';
import { createAlert } from '@cvg/alerts';
import { db, schema } from '@cvg/database';
import { eq } from 'drizzle-orm';

const RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

async function handleHandoffCompleted(event: EventEnvelope): Promise<void> {
  const payload = event.payload as {
    conversationId: string;
    previousHandler: 'bot' | 'human';
    newHandler: 'bot' | 'human';
    reason: string;
    triggeredBy?: string;
  };

  console.log(`[Worker] Processing handoff.completed for conversation ${payload.conversationId}`);

  if (payload.newHandler === 'human' && payload.reason) {
    const alertResult = await createAlert({
      conversationId: payload.conversationId,
      type: 'system',
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
      console.error(`[Worker] Failed to create alert for handoff:`, alertResult.error);
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

  console.log(`[Worker] Processing secretary.invocation (${payload.status}) for conversation ${payload.conversationId}`);

  if (payload.status === 'failed' && payload.errorMessage) {
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
      console.error(`[Worker] Failed to create alert for secretary failure:`, alertResult.error);
    }
  }
}

async function handleMessagePersisted(event: EventEnvelope): Promise<void> {
  const payload = event.payload as {
    conversationId: string;
    direction: 'inbound' | 'outbound';
    content: string;
  };

  console.log(`[Worker] Processing message.persisted for conversation ${payload.conversationId}`);
}

async function processEventWithRetry(event: EventEnvelope): Promise<void> {
  const handlers = eventConsumer['handlers'].get(event.event_type) || [];
  
  for (const handler of handlers) {
    const handlerName = handler.name || 'anonymous';
    let attempt = 0;
    let lastError: Error | unknown = null;

    while (true) {
      try {
        await handler(event);
        console.log(`[Worker] Successfully processed ${event.event_type} (${event.event_id})`);
        break;
      } catch (error) {
        lastError = error;
        const context = createRetryContext(event, handlerName, attempt + 1, error);
        
        if (!shouldRetry(context, RETRY_CONFIG)) {
          console.error(`[Worker] Non-retryable error in ${handlerName}:`, error);
          deadLetterStore.add({
            eventType: event.event_type,
            eventId: event.event_id,
            payload: event.payload,
            error: error instanceof Error ? error.message : String(error),
            retryCount: attempt,
            handlerName,
            correlationId: event.correlation_id,
          });
          break;
        }

        attempt++;
        const delay = calculateNextDelay(RETRY_CONFIG, attempt);
        
        console.log(`[Worker] Retry ${attempt}/${RETRY_CONFIG.maxRetries} for ${handlerName} after ${delay}ms`);
        
        if (attempt >= RETRY_CONFIG.maxRetries) {
          console.error(`[Worker] Max retries exceeded for ${handlerName}:`, error);
          deadLetterStore.add({
            eventType: event.event_type,
            eventId: event.event_id,
            payload: event.payload,
            error: error instanceof Error ? error.message : String(error),
            retryCount: attempt,
            handlerName,
            correlationId: event.correlation_id,
          });
          break;
        }

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
}

async function startWorker(): Promise<void> {
  console.log('[Worker] Starting message worker...');

  eventConsumer.subscribe('handoff.completed', handleHandoffCompleted);
  eventConsumer.subscribe('secretary.invocation', handleSecretaryInvocation);
  eventConsumer.subscribe('message.persisted', handleMessagePersisted);

  console.log('[Worker] Registered handlers for: handoff.completed, secretary.invocation, message.persisted');

  const pollInterval = Number(process.env.WORKER_POLL_INTERVAL_MS) || 1000;
  
  console.log(`[Worker] Starting event polling every ${pollInterval}ms`);

  setInterval(() => {
    const events = eventPublisher.getEvents();
    
    if (events.length > 0) {
      console.log(`[Worker] Processing ${events.length} events`);
      
      events.forEach(event => {
        processEventWithRetry(event).catch(error => {
          console.error('[Worker] Error processing event:', error);
        });
      });
      
      eventPublisher.clear();
    }
  }, pollInterval);

  console.log('[Worker] Worker started successfully');
}

startWorker().catch(error => {
  console.error('[Worker] Failed to start worker:', error);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('[Worker] Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Worker] Received SIGINT, shutting down gracefully');
  process.exit(0);
});

export { startWorker };
