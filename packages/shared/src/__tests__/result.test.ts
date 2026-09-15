import { describe, it, expect } from 'vitest';
import { ok, err, Result } from '../result';

describe('Result Pattern', () => {
  describe('ok', () => {
    it('cria resultado de sucesso', () => {
      const result = ok('valor');
      expect(result.isOk()).toBe(true);
      expect(result.isErr()).toBe(false);
      expect(result.value).toBe('valor');
    });

    it('aceita undefined como valor', () => {
      const result = ok(undefined);
      expect(result.isOk()).toBe(true);
      expect(result.value).toBeUndefined();
    });
  });

  describe('err', () => {
    it('cria resultado de erro', () => {
      const error = new Error('falhou');
      const result = err(error);
      expect(result.isErr()).toBe(true);
      expect(result.isOk()).toBe(false);
      expect(result.error).toBe(error);
    });
  });

  describe('pattern matching', () => {
    const match = <T, E>(result: Result<T, E>, fallback: T): T =>
      result.isOk() ? result.value : fallback;

    it('executa caminho de sucesso', () => {
      const result: Result<string, Error> = ok('dados');
      const value = match(result, 'fallback');
      expect(value).toBe('dados');
    });

    it('executa caminho de erro', () => {
      const result: Result<string, Error> = err(new Error('erro'));
      const value = match(result, 'fallback');
      expect(value).toBe('fallback');
    });
  });
});
