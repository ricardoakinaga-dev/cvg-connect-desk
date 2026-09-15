import { describe, expect, it } from 'vitest';
import { AppError } from '@cvg/shared';
import { invokeSecretary } from '../application/use-cases/invoke-secretary.use-case';

// Arquivo isolado (Vitest isola o module graph por arquivo): nenhum client foi
// inicializado, então exercita o caminho SECRETARY_NOT_CONFIGURED.
describe('invokeSecretary sem client inicializado', () => {
  it('devolve Err(AppError) 500 SECRETARY_NOT_CONFIGURED', async () => {
    const result = await invokeSecretary({
      conversationId: 'conv-no-client',
      action: 'classify',
      content: 'Sem client',
      sender: '+5511222222222',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr() && result.error instanceof AppError) {
      expect(result.error.statusCode).toBe(500);
      expect(result.error.code).toBe('SECRETARY_NOT_CONFIGURED');
    } else {
      throw new Error('esperado Err(AppError) SECRETARY_NOT_CONFIGURED');
    }
  });
});
