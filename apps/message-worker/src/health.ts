import { createServer, type Server } from 'node:http';

export function createWorkerHealthServer(): Server {
  return createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/health') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'NOT_FOUND' }));
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      status: 'ok',
      service: 'message-worker',
      uptime: process.uptime(),
    }));
  });
}

export function startWorkerHealthServer(port: number): Server {
  const server = createWorkerHealthServer();
  server.listen(port, '0.0.0.0');
  return server;
}
