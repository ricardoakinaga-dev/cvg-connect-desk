/**
 * Webhook Notifier for Alerting
 * Handles HTTP webhook delivery to Slack/Discord/ops channels
 */

import type { AlertPayload, WebhookConfig } from './types';

export class WebhookNotifier {
  private config: Required<WebhookConfig>;

  constructor(config: WebhookConfig) {
    if (!config.url) {
      throw new Error('Webhook URL is required');
    }
    this.config = {
      url: config.url,
      secret: config.secret ?? '',
      timeout_ms: config.timeout_ms ?? 5000,
      retries: config.retries ?? 3,
    };
  }

  async notify(payload: AlertPayload): Promise<{ success: boolean; attempts: number; error?: string }> {
    let lastError: string | undefined;
    let attempts = 0;

    for (let i = 0; i < this.config.retries!; i++) {
      attempts++;
      try {
        const result = await this.sendWebhook(payload);
        if (result.ok) {
          return { success: true, attempts };
        }
        lastError = result.error;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }

      if (i < this.config.retries! - 1) {
        await this.delay(1000 * (i + 1));
      }
    }

    return { success: false, attempts, error: lastError };
  }

  private async sendWebhook(
    payload: AlertPayload
  ): Promise<{ ok: boolean; error?: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout_ms);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'CVG-AlertingService/1.0',
      };

      if (this.config.secret) {
        const signature = await this.computeSignature(JSON.stringify(payload), this.config.secret);
        headers['X-Webhook-Signature'] = signature;
      }

      const response = await fetch(this.config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal as RequestInit['signal'],
      });

      clearTimeout(timeout);

      if (response.ok) {
        return { ok: true };
      }

      const errorText = await response.text().catch(() => `HTTP ${response.status}`);
      return { ok: false, error: errorText };
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false, error: 'Request timeout' };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async computeSignature(payload: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const hashArray = Array.from(new Uint8Array(signature));
    return `sha256=${hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
