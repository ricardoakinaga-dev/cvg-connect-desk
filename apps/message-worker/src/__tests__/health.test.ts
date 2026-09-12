import { describe, expect, it } from 'vitest';
import { createWorkerHealthServer } from '../health';

describe('message worker health endpoint', () => {
  it('returns a real liveness response and rejects unknown paths', async () => {
    const server = createWorkerHealthServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Health server did not expose a TCP address');
    }

    const health = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', service: 'message-worker' });

    const missing = await fetch(`http://127.0.0.1:${address.port}/missing`);
    expect(missing.status).toBe(404);

    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
});
