import { err, ok, type Result } from '@cvg/shared';
import { AppError } from '@cvg/shared';
import type { SecretaryInvocationResponse } from '../types';

export interface ParsedSecretaryResponse {
  success: boolean;
  response?: string;
  classification?: {
    category: 'clinical' | 'commercial' | 'urgent' | 'general';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    confidence: number;
  };
  shouldHandoff: boolean;
  handoffReason?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

export function handleSecretaryResponse(
  response: SecretaryInvocationResponse
): Result<ParsedSecretaryResponse, Error> {
  if (!response.success) {
    return err(new AppError(
      response.error || 'Unknown error from Secretary',
      500,
      'SECRETARY_ERROR'
    ));
  }

  const shouldHandoff = response.action === 'handoff' || 
    (response.classification?.priority === 'urgent') ||
    (response.handoffReason !== undefined);

  return ok({
    success: response.success,
    response: response.response,
    classification: response.classification,
    shouldHandoff,
    handoffReason: response.handoffReason,
    metadata: response.metadata,
    error: response.error,
  });
}

export function validateSecretaryResponse(response: unknown): response is SecretaryInvocationResponse {
  if (!response || typeof response !== 'object') {
    return false;
  }

  const obj = response as Record<string, unknown>;
  
  if (typeof obj.success !== 'boolean') {
    return false;
  }

  if (obj.response !== undefined && typeof obj.response !== 'string') {
    return false;
  }

  if (obj.error !== undefined && typeof obj.error !== 'string') {
    return false;
  }

  return true;
}
