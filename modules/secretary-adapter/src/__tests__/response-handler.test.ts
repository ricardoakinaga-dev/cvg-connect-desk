import { describe, expect, it } from 'vitest';
import { AppError } from '@cvg/shared';
import { handleSecretaryResponse } from '../infrastructure/response-handler';

describe('handleSecretaryResponse', () => {
  it('success=false vira Err(AppError SECRETARY_ERROR 500) com a mensagem do secretary', () => {
    const result = handleSecretaryResponse({ success: false, error: 'recusado' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(AppError);
      expect(result.error.statusCode).toBe(500);
      expect(result.error.code).toBe('SECRETARY_ERROR');
      expect(result.error.message).toBe('recusado');
    }
  });

  it('success=false sem mensagem usa fallback Unknown error from Secretary', () => {
    const result = handleSecretaryResponse({ success: false });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Unknown error from Secretary');
    }
  });

  it('action=handoff marca shouldHandoff=true', () => {
    const result = handleSecretaryResponse({ success: true, action: 'handoff', response: 'vou transferir' });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.shouldHandoff).toBe(true);
    }
  });

  it('priority=urgent marca shouldHandoff=true sem action handoff', () => {
    const result = handleSecretaryResponse({
      success: true,
      action: 'respond',
      classification: { category: 'urgent', priority: 'urgent', confidence: 0.97 },
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.shouldHandoff).toBe(true);
    }
  });

  it('handoffReason explícito marca shouldHandoff=true', () => {
    const result = handleSecretaryResponse({ success: true, action: 'respond', handoffReason: 'caso sensível' });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.shouldHandoff).toBe(true);
      expect(result.value.handoffReason).toBe('caso sensível');
    }
  });

  it('resposta normal preserva classification/metadata e shouldHandoff=false', () => {
    const result = handleSecretaryResponse({
      success: true,
      action: 'respond',
      response: 'ok',
      metadata: { model: 'secretary-v1' },
      classification: { category: 'general', priority: 'medium', confidence: 0.8 },
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.shouldHandoff).toBe(false);
      expect(result.value.metadata).toEqual({ model: 'secretary-v1' });
      expect(result.value.classification).toEqual({ category: 'general', priority: 'medium', confidence: 0.8 });
    }
  });
});
