export type WebhookSecurityReason =
  | 'missing_secret'
  | 'missing_signature'
  | 'invalid_signature_format'
  | 'invalid_signature'
  | 'signature_valid'
  | 'missing_timestamp'
  | 'invalid_timestamp'
  | 'timestamp_too_old'
  | 'timestamp_too_future'
  | 'missing_event_id'
  | 'duplicate_event_id';

export interface WebhookSecurityDecision {
  reason: WebhookSecurityReason;
  allowed: boolean;
  webhookMode: 'strict-production' | 'development-bypass' | 'hmac';
  hasSecret: boolean;
  signaturePresent?: boolean;
  statusCode?: number;
  timestamp: string;
}

export interface WebhookSecurityStats {
  total: number;
  allowed: number;
  denied: number;
  byReason: Record<WebhookSecurityReason, number>;
  lastDecisionAt: string | null;
  lastDecision: WebhookSecurityDecision | null;
}

const reasonKeys: WebhookSecurityReason[] = [
  'missing_secret',
  'missing_signature',
  'invalid_signature_format',
  'invalid_signature',
  'signature_valid',
  'missing_timestamp',
  'invalid_timestamp',
  'timestamp_too_old',
  'timestamp_too_future',
  'missing_event_id',
  'duplicate_event_id',
];

function createInitialStats(): WebhookSecurityStats {
  return {
    total: 0,
    allowed: 0,
    denied: 0,
    byReason: {
      missing_secret: 0,
      missing_signature: 0,
      invalid_signature_format: 0,
      invalid_signature: 0,
      signature_valid: 0,
      missing_timestamp: 0,
      invalid_timestamp: 0,
      timestamp_too_old: 0,
      timestamp_too_future: 0,
      missing_event_id: 0,
      duplicate_event_id: 0,
    },
    lastDecisionAt: null,
    lastDecision: null,
  };
}

let stats = createInitialStats();

export function recordWebhookSecurityDecision(decision: Omit<WebhookSecurityDecision, 'timestamp'> & { timestamp?: string }): void {
  const recorded: WebhookSecurityDecision = {
    ...decision,
    timestamp: decision.timestamp || new Date().toISOString(),
  };

  stats.total += 1;
  if (recorded.allowed) {
    stats.allowed += 1;
  } else {
    stats.denied += 1;
  }

  stats.byReason[recorded.reason] += 1;
  stats.lastDecisionAt = recorded.timestamp;
  stats.lastDecision = recorded;
}

export function getWebhookSecurityStats(): WebhookSecurityStats {
  return {
    total: stats.total,
    allowed: stats.allowed,
    denied: stats.denied,
    byReason: reasonKeys.reduce((acc, reason) => {
      acc[reason] = stats.byReason[reason];
      return acc;
    }, {} as Record<WebhookSecurityReason, number>),
    lastDecisionAt: stats.lastDecisionAt,
    lastDecision: stats.lastDecision ? { ...stats.lastDecision } : null,
  };
}

export function resetWebhookSecurityStats(): void {
  stats = createInitialStats();
}
