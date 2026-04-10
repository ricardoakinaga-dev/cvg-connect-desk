import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = Number(process.env.EVOLUTION_MOCK_PORT || '8082');

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(body));
}

function mockMessageId(instance: string, kind: string) {
  return `mock-${kind}-${instance}-${Date.now()}`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const instance = decodeURIComponent(url.pathname.split('/').pop() || 'default');

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/message/sendText/')) {
    await delay(25);
    sendJson(res, 200, {
      key: {
        id: mockMessageId(instance, 'text'),
      },
    });
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/message/sendMedia/')) {
    await delay(25);
    sendJson(res, 200, {
      key: {
        id: mockMessageId(instance, 'media'),
      },
    });
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/message/sendWhatsAppAudio/')) {
    await delay(25);
    sendJson(res, 200, {
      key: {
        id: mockMessageId(instance, 'audio'),
      },
    });
    return;
  }

  sendJson(res, 404, { error: 'NOT_FOUND' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[e2e-mock-evolution] listening on :${PORT}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
