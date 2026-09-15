import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerTaskRoutes } from '../presentation/http/task.controller';

describe('GET /tasks — validação do querystring (regressão AAA-16)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerTaskRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('status fora do enum retorna 400 antes de autenticar/executar o handler', async () => {
    const response = await app.inject({ method: 'GET', url: '/tasks?status=nao-existe' });
    expect(response.statusCode).toBe(400);
  });

  it('priority fora do enum retorna 400', async () => {
    const response = await app.inject({ method: 'GET', url: '/tasks?priority=urgentissimo' });
    expect(response.statusCode).toBe(400);
  });

  it('valores válidos do enum passam a validação e chegam ao preHandler de auth (401 sem token)', async () => {
    const response = await app.inject({ method: 'GET', url: '/tasks?status=pending&priority=low' });
    expect(response.statusCode).toBe(401);
  });
});
