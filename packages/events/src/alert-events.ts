/**
 * Alert Events
 * Events published when alerts are created, acknowledged, or resolved
 */

import type { EventEnvelope } from './envelope';
import { createEvent } from './envelope';

export type AlertEventType = 'alert.created' | 'alert.acknowledged' | 'alert.resolved';

export interface AlertCreatedPayload {
  alertId: string;
  conversationId?: string;
  taskId?: string;
  type: string;
  title: string;
  severity: string;
  triggeredBy?: string;
}

export interface AlertAcknowledgedPayload {
  alertId: string;
  acknowledgedBy?: string;
  reason?: string;
}

export interface AlertResolvedPayload {
  alertId: string;
  resolvedBy?: string;
  resolution?: string;
}

export function createAlertCreatedEvent(payload: AlertCreatedPayload): EventEnvelope {
  return createEvent('alert.created', 'Alert', payload.alertId, payload);
}

export function createAlertAcknowledgedEvent(payload: AlertAcknowledgedPayload): EventEnvelope {
  return createEvent('alert.acknowledged', 'Alert', payload.alertId, payload);
}

export function createAlertResolvedEvent(payload: AlertResolvedPayload): EventEnvelope {
  return createEvent('alert.resolved', 'Alert', payload.alertId, payload);
}
