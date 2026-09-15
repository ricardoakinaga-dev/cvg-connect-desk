/**
 * PROD-12 child process for real lease claim/renew/ack/nack operations.
 * The parent test launches several independent instances concurrently.
 */
import {
  CONSUMER_IDS,
  ConsumerAwareOutboxReader,
  type LeaseToken,
} from '@cvg/events';

type Action =
  | {
      cmd: 'claim';
      owner: string;
      leaseSeconds?: number;
      limit?: number;
      eventTypes?: string[];
      startAtEpochMs?: number;
    }
  | { cmd: 'renew'; eventId: string; owner: string; generation: number; leaseSeconds: number }
  | { cmd: 'ack'; eventId: string; owner: string; generation: number }
  | {
      cmd: 'nack';
      eventId: string;
      owner: string;
      generation: number;
      error: string;
      errorCode?: string;
      permanent?: boolean;
    };

function parseAction(): Action {
  const raw = process.env.PROD12_LEASE_ACTION;
  if (!raw) throw new Error('PROD12_LEASE_ACTION ausente');
  const parsed = JSON.parse(raw) as Action;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.cmd !== 'string') {
    throw new Error('PROD12_LEASE_ACTION invalida');
  }
  return parsed;
}

function tokenFrom(action: Extract<Action, { eventId: string }>): LeaseToken {
  return {
    eventId: action.eventId,
    consumerId: CONSUMER_IDS.WORKER,
    owner: action.owner,
    generation: action.generation,
    leaseUntil: new Date(),
  };
}

function serializeLease(lease: LeaseToken): Record<string, unknown> {
  return {
    eventId: lease.eventId,
    consumerId: lease.consumerId,
    owner: lease.owner,
    generation: lease.generation,
    leaseUntil: lease.leaseUntil.toISOString(),
  };
}

async function main(): Promise<void> {
  const action = parseAction();
  const reader = new ConsumerAwareOutboxReader({
    consumerId: CONSUMER_IDS.WORKER,
    batchSize: 100,
    maxRetries: 3,
  });

  switch (action.cmd) {
    case 'claim': {
      if (action.startAtEpochMs && Number.isFinite(action.startAtEpochMs)) {
        const waitMs = action.startAtEpochMs - Date.now();
        if (waitMs > 0) await new Promise((resolveWait) => setTimeout(resolveWait, waitMs));
      }
      const claimed = await reader.claim({
        owner: action.owner,
        leaseSeconds: action.leaseSeconds ?? 60,
        limit: action.limit ?? 50,
        eventTypes: action.eventTypes,
      });
      console.log(JSON.stringify({
        ok: true,
        cmd: 'claim',
        owner: action.owner,
        claimed: claimed.map((entry) => ({
          eventId: entry.event.event_id,
          eventType: entry.event.event_type,
          lease: serializeLease(entry.lease),
        })),
      }));
      break;
    }
    case 'renew': {
      const renewed = await reader.renew(tokenFrom(action), action.leaseSeconds);
      console.log(JSON.stringify({ ok: true, cmd: 'renew', renewed: renewed ? serializeLease(renewed) : null }));
      break;
    }
    case 'ack': {
      const result = await reader.ack({
        eventId: action.eventId,
        owner: action.owner,
        generation: action.generation,
      });
      console.log(JSON.stringify({ ok: true, cmd: 'ack', result }));
      break;
    }
    case 'nack': {
      const result = await reader.nack({
        eventId: action.eventId,
        owner: action.owner,
        generation: action.generation,
        error: action.error,
        errorCode: action.errorCode,
        permanent: action.permanent,
      });
      console.log(JSON.stringify({ ok: true, cmd: 'nack', result }));
      break;
    }
    default: {
      const exhaustive: never = action;
      throw new Error(`comando desconhecido: ${JSON.stringify(exhaustive)}`);
    }
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exit(1);
  },
);
