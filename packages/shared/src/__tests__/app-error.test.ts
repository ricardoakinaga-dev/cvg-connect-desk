import { describe, it, expect } from 'vitest';
import { AppError, NotFoundError, BadRequestError, UnauthorizedError, ForbiddenError, ConflictError } from '../index';

describe('AppError', () => {
  it('creates error with code and statusCode', () => {
    const error = new AppError('Test message', 400, 'TEST_ERROR');
    expect(error.code).toBe('TEST_ERROR');
    expect(error.message).toBe('Test message');
    expect(error.statusCode).toBe(400);
  });

  it('defaults to 500 status code', () => {
    const error = new AppError('Message');
    expect(error.statusCode).toBe(500);
    expect(error.code).toBe('INTERNAL_ERROR');
  });

  it('is instance of Error', () => {
    const error = new AppError('Test');
    expect(error instanceof Error).toBe(true);
    expect(error instanceof AppError).toBe(true);
  });

  it('has isOperational flag', () => {
    const error = new AppError('Test', 500, 'TEST', false);
    expect(error.isOperational).toBe(false);
  });
});

describe('Error subclasses', () => {
  it('NotFoundError has 404 status', () => {
    const error = new NotFoundError('User not found');
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
  });

  it('BadRequestError has 400 status', () => {
    const error = new BadRequestError('Invalid input');
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('BAD_REQUEST');
  });

  it('UnauthorizedError has 401 status', () => {
    const error = new UnauthorizedError();
    expect(error.statusCode).toBe(401);
  });

  it('ForbiddenError has 403 status', () => {
    const error = new ForbiddenError();
    expect(error.statusCode).toBe(403);
  });

  it('ConflictError has 409 status', () => {
    const error = new ConflictError();
    expect(error.statusCode).toBe(409);
  });
});