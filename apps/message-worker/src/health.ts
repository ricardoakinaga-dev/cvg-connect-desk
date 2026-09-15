import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { metrics } from '@cvg/shared';

export interface WorkerHealthSnapshot {
  status: 'ok' | 'not_ready' | 'degraded';
  ready: boolean;
  service: 'message-worker';
  uptime: number;
  checks: {
    process: { status: 'ok' };
    loop: {
      status: 'ok' | 'error' | 'not_started';
      lastStartedAt: string | null;
      lastSucceededAt: string | null;
      ageMs: number | null;
      consecutiveFailures: number;
      lastErrorCode?: string;
    };
    queue: {
      status: 'ok' | 'unknown' | 'degraded';
      pendingCount: number | null;
      oldestAgeSeconds: number | null;
      checkedAt: string | null;
    };
  };
}

export interface WorkerHealthTracker {
  markLoopStarted(): void;
  markLoopSucceeded(input: { pendingCount: number; oldestPendingAt: Date | null }): void;
  markLoopFailed(error: unknown): void;
  markStopping(): void;
  snapshot(): WorkerHealthSnapshot;
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return 'POLL_FAILED';
}

export function createWorkerHealthTracker(options: {
  pollIntervalMs: number;
  maxQueueAgeSeconds?: number;
  clock?: () => number;
}): WorkerHealthTracker {
  const clock = options.clock ?? Date.now;
  const staleAfterMs = Math.max(options.pollIntervalMs * 3, 5000);
  const maxQueueAgeSeconds = options.maxQueueAgeSeconds ?? 300;
  let lastStartedAt: number | null = null;
  let lastSucceededAt: number | null = null;
  let lastErrorCode: string | undefined;
  let consecutiveFailures = 0;
  let pendingCount: number | null = null;
  let oldestPendingAt: number | null = null;
  let queueCheckedAt: number | null = null;
  let stopping = false;

  return {
    markLoopStarted(): void {
      lastStartedAt = clock();
    },
    markLoopSucceeded(input): void {
      lastSucceededAt = clock();
      consecutiveFailures = 0;
      lastErrorCode = undefined;
      pendingCount = input.pendingCount;
      oldestPendingAt = input.oldestPendingAt?.getTime() ?? null;
      queueCheckedAt = lastSucceededAt;
    },
    markLoopFailed(error): void {
      consecutiveFailures += 1;
      lastErrorCode = errorCode(error);
      queueCheckedAt = null;
    },
    markStopping(): void {
      stopping = true;
    },
    snapshot(): WorkerHealthSnapshot {
      const now = clock();
      const ageMs = lastSucceededAt === null ? null : Math.max(0, now - lastSucceededAt);
      const oldestAgeSeconds = oldestPendingAt === null
        ? null
        : Math.max(0, Math.floor((now - oldestPendingAt) / 1000));
      const loopReady = !stopping
        && lastSucceededAt !== null
        && ageMs !== null
        && ageMs <= staleAfterMs
        && consecutiveFailures === 0;
      const queueStatus = queueCheckedAt === null
        ? 'unknown'
        : oldestAgeSeconds !== null && oldestAgeSeconds > maxQueueAgeSeconds
          ? 'degraded'
          : 'ok';
      const ready = loopReady && queueStatus !== 'degraded';

      return {
        status: ready ? 'ok' : queueStatus === 'degraded' ? 'degraded' : 'not_ready',
        ready,
        service: 'message-worker',
        uptime: process.uptime(),
        checks: {
          process: { status: 'ok' },
          loop: {
            status: lastSucceededAt === null ? 'not_started' : consecutiveFailures > 0 || !loopReady ? 'error' : 'ok',
            lastStartedAt: lastStartedAt === null ? null : new Date(lastStartedAt).toISOString(),
            lastSucceededAt: lastSucceededAt === null ? null : new Date(lastSucceededAt).toISOString(),
            ageMs,
            consecutiveFailures,
            ...(lastErrorCode ? { lastErrorCode } : {}),
          },
          queue: {
            status: queueStatus,
            pendingCount,
            oldestAgeSeconds,
            checkedAt: queueCheckedAt === null ? null : new Date(queueCheckedAt).toISOString(),
          },
        },
      };
    },
  };
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function safeEqualStrings(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(providedBytes, expectedBytes);
}

function isProduction(): boolean {
  return ['production', 'prod'].includes((process.env.NODE_ENV || process.env.DESK_ENV || '').toLowerCase());
}

export function createWorkerHealthServer(
  getSnapshot: () => WorkerHealthSnapshot | Promise<WorkerHealthSnapshot> = () => ({
    status: 'not_ready',
    ready: false,
    service: 'message-worker',
    uptime: process.uptime(),
    checks: {
      process: { status: 'ok' },
      loop: {
        status: 'not_started',
        lastStartedAt: null,
        lastSucceededAt: null,
        ageMs: null,
        consecutiveFailures: 0,
      },
      queue: { status: 'unknown', pendingCount: null, oldestAgeSeconds: null, checkedAt: null },
    },
  }),
): Server {
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'GET' || !['/health', '/readiness', '/metrics'].includes(request.url ?? '')) {
      sendJson(response, 404, { error: 'NOT_FOUND' });
      return;
    }

    if (request.url === '/metrics') {
      const token = (process.env.METRICS_TOKEN ?? '').trim();
      if (token.length === 0 && isProduction()) {
        sendJson(response, 503, { error: 'METRICS_UNAVAILABLE' });
        return;
      }
      if (token.length > 0 && !safeEqualStrings(request.headers.authorization ?? '', `Bearer ${token}`)) {
        sendJson(response, 401, { error: 'UNAUTHORIZED' });
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
      response.end(metrics.render());
      return;
    }

    if (request.url === '/health') {
      sendJson(response, 200, {
        status: 'ok',
        service: 'message-worker',
        uptime: process.uptime(),
      });
      return;
    }

    Promise.resolve(getSnapshot()).then((snapshot) => {
      sendJson(response, snapshot.ready ? 200 : 503, snapshot);
    }).catch(() => {
      sendJson(response, 503, { status: 'not_ready', ready: false, service: 'message-worker' });
    });
  });
}

export function startWorkerHealthServer(
  port: number,
  getSnapshot?: () => WorkerHealthSnapshot | Promise<WorkerHealthSnapshot>,
): Server {
  const server = createWorkerHealthServer(getSnapshot);
  server.listen(port, '0.0.0.0');
  return server;
}
