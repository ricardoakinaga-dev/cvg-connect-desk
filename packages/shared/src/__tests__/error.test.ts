import { describe, it, expect } from 'vitest';
import { AppError, NotFoundError, BadRequestError, UnauthorizedError, ForbiddenError, ConflictError } from '../error';

describe('AppError', () => {
  it('cria erro com statusCode e code corretos', () => {
    const error = new AppError('Teste', 400, 'TEST_ERROR');
    expect(error.message).toBe('Teste');
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('TEST_ERROR');
    expect(error).toBeInstanceOf(Error);
  });

  it('NotFoundError retorna 404', () => {
    const error = new NotFoundError('Usuário');
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toContain('Usuário');
  });

  it('BadRequestError retorna 400', () => {
    const error = new BadRequestError('Campo inválido');
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('BAD_REQUEST');
  });

  it('UnauthorizedError retorna 401', () => {
    const error = new UnauthorizedError();
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('UNAUTHORIZED');
  });

  it('ForbiddenError retorna 403', () => {
    const error = new ForbiddenError();
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
  });

  it('ConflictError retorna 409', () => {
    const error = new ConflictError('Email já existe');
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('CONFLICT');
  });
});
