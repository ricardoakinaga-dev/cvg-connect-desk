import { describe, it, expect } from 'vitest';
import { ok, err, Ok, Err } from '../result';
import { AppError, NotFoundError, BadRequestError, UnauthorizedError, ForbiddenError, ConflictError } from '../error';

describe('Result Pattern', () => {
  describe('ok()', () => {
    it('deve criar resultado de sucesso', () => {
      const result = ok({ id: '123' });

      expect(result.isOk()).toBe(true);
      expect(result.isErr()).toBe(false);
      if (result.isOk()) {
        expect(result.value).toEqual({ id: '123' });
      }
    });

    it('deve criar resultado de sucesso com valor undefined', () => {
      const result = ok(undefined);

      expect(result.isOk()).toBe(true);
    });
  });

  describe('err()', () => {
    it('deve criar resultado de erro', () => {
      const result = err(new Error('falhou'));

      expect(result.isOk()).toBe(false);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('falhou');
      }
    });
  });

  describe('Ok e Err classes', () => {
    it('Ok deve ser instância de Ok', () => {
      const result = ok(42);

      expect(result).toBeInstanceOf(Ok);
      expect(result.ok).toBe(true);
    });

    it('Err deve ser instância de Err', () => {
      const result = err(new BadRequestError('invalid'));

      expect(result).toBeInstanceOf(Err);
      expect(result.ok).toBe(false);
    });

    it('isOk() e isErr() devem funcionar como guards de tipo', () => {
      const success = ok(42);
      const failure = err(new Error('invalid'));

      if (success.isOk()) {
        expect(success.value).toBe(42);
      }

      if (failure.isErr()) {
        expect(failure.error.message).toBe('invalid');
      }
    });
  });
});

describe('AppError', () => {
  it('deve criar erro com statusCode e code', () => {
    const error = new AppError('Something failed', 500, 'INTERNAL_ERROR');

    expect(error.message).toBe('Something failed');
    expect(error.statusCode).toBe(500);
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error).toBeInstanceOf(Error);
  });

  it('NotFoundError deve ter statusCode 404', () => {
    const error = new NotFoundError('Usuário');

    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toContain('Usuário');
  });

  it('BadRequestError deve ter statusCode 400', () => {
    const error = new BadRequestError('Campo obrigatório');

    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('BAD_REQUEST');
  });

  it('UnauthorizedError deve ter statusCode 401', () => {
    const error = new UnauthorizedError();

    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('UNAUTHORIZED');
  });

  it('ForbiddenError deve ter statusCode 403', () => {
    const error = new ForbiddenError();

    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
  });

  it('ConflictError deve ter statusCode 409', () => {
    const error = new ConflictError('Duplicado');

    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('CONFLICT');
  });
});
