import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export type GatewayScope =
  | 'inbound'
  | 'receipt'
  | 'instance-status'
  | 'outbound:read'
  | 'outbound:write'
  | 'health';

const DEFAULT_SIGNATURE_TTL_SECONDS = 300;
const DEFAULT_RATE_LIMIT_MAX = 300;
const replayedNonces = new Map<string, number>();
const acceptedRequests = new Map<string, number[]>();

export interface GatewayReplayStore {
  claim(scope: GatewayScope, nonce: string, expiresAt: Date): Promise<boolean>;
}

let configuredReplayStore: GatewayReplayStore | null = null;

export function setGatewayReplayStore(store: GatewayReplayStore | null): void {
  configuredReplayStore = store;
}

function getHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function getConfiguredSecret(): string | undefined {
  const secret = process.env.GATEWAY_WEBHOOK_SECRET || process.env.GATEWAY_SECRET;
  return secret?.trim() || undefined;
}

function getSignatureTtlSeconds(): number {
  const configured = Number(process.env.GATEWAY_SIGNATURE_TTL_SECONDS || '');
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_SIGNATURE_TTL_SECONDS;
}

function getRateLimitMax(): number {
  const configured = Number(process.env.GATEWAY_RATE_LIMIT_MAX || '');
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_RATE_LIMIT_MAX;
}

function bodyToString(body: unknown): string {
  if (body === undefined || body === null) {
    return '';
  }

  return JSON.stringify(body) ?? '';
}

export function buildGatewaySignature(
  secret: string,
  timestamp: number,
  nonce: string,
  scope: string,
  body: string,
): string {
  return `sha256=${crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${nonce}.${scope}.${body}`)
    .digest('hex')}`;
}

function reject(reply: FastifyReply, statusCode: number, error: string, message: string) {
  return reply.status(statusCode).send({ error, message });
}

function pruneState(now: number, ttlSeconds: number): void {
  const expiresBefore = now - ttlSeconds * 1000;
  for (const [key, expiresAt] of replayedNonces) {
    if (expiresAt <= now) {
      replayedNonces.delete(key);
    }
  }

  for (const [key, timestamps] of acceptedRequests) {
    const recent = timestamps.filter(timestamp => timestamp > expiresBefore);
    if (recent.length === 0) {
      acceptedRequests.delete(key);
    } else {
      acceptedRequests.set(key, recent);
    }
  }
}

function isRateLimited(request: FastifyRequest, scope: GatewayScope, now: number, ttlSeconds: number): boolean {
  const key = `${scope}:${request.ip}`;
  const cutoff = now - ttlSeconds * 1000;
  const recent = (acceptedRequests.get(key) || []).filter(timestamp => timestamp > cutoff);
  if (recent.length >= getRateLimitMax()) {
    acceptedRequests.set(key, recent);
    return true;
  }

  acceptedRequests.set(key, [...recent, now]);
  return false;
}

export function resetGatewayAuthState(): void {
  replayedNonces.clear();
  acceptedRequests.clear();
}

export function createGatewayAuthGuard(scope: GatewayScope) {
  return async function gatewayAuthGuard(request: FastifyRequest, reply: FastifyReply) {
    const secret = getConfiguredSecret();
    if (!secret) {
      request.log.error({ scope }, '[GatewayAuth] gateway secret is not configured');
      return reject(reply, 500, 'CONFIGURATION_ERROR', 'Gateway security is not configured');
    }

    const timestampHeader = getHeader(request, 'x-gateway-timestamp');
    const nonce = getHeader(request, 'x-gateway-nonce');
    const requestedScope = getHeader(request, 'x-gateway-scope');
    const signature = getHeader(request, 'x-gateway-signature');
    if (!timestampHeader || !nonce || !requestedScope || !signature) {
      return reject(reply, 401, 'UNAUTHORIZED', 'Missing gateway credentials');
    }

    const timestamp = Number(timestampHeader);
    const ttlSeconds = getSignatureTtlSeconds();
    const now = Date.now();
    if (!Number.isInteger(timestamp) || Math.abs(Math.floor(now / 1000) - timestamp) > ttlSeconds) {
      return reject(reply, 401, 'SIGNATURE_EXPIRED', 'Gateway signature expired');
    }

    if (requestedScope !== scope) {
      return reject(reply, 403, 'FORBIDDEN', 'Gateway credential is not authorized for this operation');
    }

    if (!/^sha256=[0-9a-f]{64}$/i.test(signature)) {
      return reject(reply, 401, 'UNAUTHORIZED', 'Invalid gateway signature');
    }

    const receivedDigest = signature.slice('sha256='.length);
    const expectedDigest = buildGatewaySignature(
      secret,
      timestamp,
      nonce,
      scope,
      bodyToString(request.body),
    ).slice('sha256='.length);
    const receivedBuffer = Buffer.from(receivedDigest, 'hex');
    const expectedBuffer = Buffer.from(expectedDigest, 'hex');
    if (receivedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) {
      return reject(reply, 401, 'UNAUTHORIZED', 'Invalid gateway signature');
    }

    pruneState(now, ttlSeconds);
    if (isRateLimited(request, scope, now, ttlSeconds)) {
      return reject(reply, 429, 'RATE_LIMITED', 'Gateway rate limit exceeded');
    }

    const replayKey = `${scope}:${nonce}`;
    const claimed = configuredReplayStore
      ? await configuredReplayStore.claim(scope, nonce, new Date(now + ttlSeconds * 1000))
      : !replayedNonces.has(replayKey);

    if (!claimed) {
      return reject(reply, 409, 'REPLAY_DETECTED', 'Gateway request has already been processed');
    }

    if (!configuredReplayStore) {
      replayedNonces.set(replayKey, now + ttlSeconds * 1000);
    }
  };
}
