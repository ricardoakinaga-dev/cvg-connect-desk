import { beforeEach, describe, expect, it } from 'vitest';
import {
  getWebhookSecurityStats,
  recordWebhookSecurityDecision,
  resetWebhookSecurityStats,
} from '../webhook-security-stats';

describe('webhook security stats', () => {
  beforeEach(() => {
    resetWebhookSecurityStats();
  });

  it('tracks allowed and denied decisions by reason', () => {
    recordWebhookSecurityDecision({
      reason: 'missing_signature',
      allowed: false,
      webhookMode: 'hmac',
      hasSecret: true,
      signaturePresent: false,
      statusCode: 401,
    });
    recordWebhookSecurityDecision({
      reason: 'invalid_signature',
      allowed: false,
      webhookMode: 'hmac',
      hasSecret: true,
      signaturePresent: true,
      statusCode: 401,
    });
    recordWebhookSecurityDecision({
      reason: 'signature_valid',
      allowed: true,
      webhookMode: 'hmac',
      hasSecret: true,
      signaturePresent: true,
      statusCode: 200,
    });

    const stats = getWebhookSecurityStats();
    expect(stats.total).toBe(3);
    expect(stats.allowed).toBe(1);
    expect(stats.denied).toBe(2);
    expect(stats.byReason.missing_signature).toBe(1);
    expect(stats.byReason.invalid_signature).toBe(1);
    expect(stats.byReason.signature_valid).toBe(1);
    expect(stats.lastDecision?.reason).toBe('signature_valid');
  });
});
