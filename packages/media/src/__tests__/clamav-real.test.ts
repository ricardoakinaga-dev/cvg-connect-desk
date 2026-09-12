import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { ClamAVScanner, FakeScanner } from '../scanner';

/**
 * ClamAV real (integration; §8). Com STAGING_SMOKE=1 fala com clamd real
 * (127.0.0.1:3310). Local: fake TCP para clean/infected/timeout/unavailable
 * (comportamento idêntico ao protocolo INSTREAM).
 */
const STAGING = process.env.STAGING_SMOKE === '1';
const CLAMAV_HOST = process.env.CLAMAV_HOST || '127.0.0.1';
const CLAMAV_PORT = Number(process.env.CLAMAV_PORT) || 3310;

const EICAR = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');

async function startTcpServer(reply: string, delayMs = 0) {
  const server = net.createServer((socket) => {
    socket.on('data', () => {});
    socket.on('end', () => {
      if (delayMs > 0) {
        setTimeout(() => {
          socket.write(reply);
          socket.end();
        }, delayMs);
      } else {
        socket.write(reply);
        socket.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { port, server };
}

describe('ClamAV scanner (protocolo)', () => {
  it('clean file → CLEAN (mock TCP)', async () => {
    const { port, server } = await startTcpServer('stream: OK\n');
    try {
      const scanner = new ClamAVScanner('127.0.0.1', port);
      const result = await scanner.scan(Buffer.from('clean bytes'));
      expect(result.status).toBe('CLEAN');
    } finally {
      server.close();
    }
  });

  it('EICAR → INFECTED com assinatura (mock TCP)', async () => {
    const infectedName = 'Eicar-Test-Signature';
    const { port, server } = await startTcpServer(`stream: ${infectedName} FOUND\n`);
    try {
      const scanner = new ClamAVScanner('127.0.0.1', port);
      const result = await scanner.scan(Buffer.from('dummy'));
      expect(result.status).toBe('INFECTED');
      expect(result.signature).toBe(infectedName);
    } finally {
      server.close();
    }
  });

  it('timeout → SCAN_FAILED (lenha sem reply)', async () => {
    // Servidor retém a conexão (allowHalfOpen: FIN não é ecoado; sem reply).
    const server = net.createServer({ allowHalfOpen: true }, (socket) => {
      socket.on('data', () => {});
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      process.env.MALWARE_SCAN_TIMEOUT_MS = '1000';
      const scanner = new ClamAVScanner('127.0.0.1', port);
      const result = await scanner.scan(Buffer.from('x'));
      expect(result.status).toBe('SCAN_FAILED');
      expect(result.error).toMatch(/timed out/i);
      delete process.env.MALWARE_SCAN_TIMEOUT_MS;
    } finally {
      server.close();
    }
  }, 30000);

  it('scanner unavailable (porta morta) → SCAN_FAILED, nunca throw', async () => {
    const scanner = new ClamAVScanner('127.0.0.1', 9);
    const result = await scanner.scan(Buffer.from('x'));
    expect(result.status).toBe('SCAN_FAILED');
  }, 30000);

  it.skip(!STAGING, 'requer ClamAV real em staging (STAGING_SMOKE=1) — EICAR em clamd real');
  it.skip(!STAGING, 'requer ClamAV real — clean em clamd real');
  it.skip(!STAGING, 'requer ClamAV real — scanner real indisponível');
});

describe('ClamAV REAL (STAGING_SMOKE=1)', () => {
  const maybe = STAGING ? it : it.skip;

  maybe('EICAR real em clamd → INFECTED', async () => {
    const scanner = new ClamAVScanner(CLAMAV_HOST, CLAMAV_PORT);
    const result = await scanner.scan(EICAR, 'eicar.txt');
    expect(result.status).toBe('INFECTED');
  }, 60000);

  maybe('arquivo limpo real → CLEAN', async () => {
    const scanner = new ClamAVScanner(CLAMAV_HOST, CLAMAV_PORT);
    const result = await scanner.scan(Buffer.from('hello clean world'), null as never);
    expect(result.status).toBe('CLEAN');
  }, 60000);

  maybe('clamd inacessível → SCAN_FAILED (política fail-secure preservada)', async () => {
    const scanner = new ClamAVScanner('127.0.0.1', 1);
    const result = await scanner.scan(EICAR);
    expect(result.status).toBe('SCAN_FAILED');
  });
});

describe('FakeScanner (dev/test explícito)', () => {
  it('FakeScanner CLEAN nunca INFECTED sem EICAR', async () => {
    const scanner = new FakeScanner('CLEAN');
    const r = await scanner.scan(Buffer.from('normal'));
    expect(r.status).toBe('CLEAN');
  });

  it('FakeScanner detecta EICAR embutido', async () => {
    const scanner = new FakeScanner('CLEAN');
    const r = await scanner.scan(Buffer.concat([Buffer.from('lixo'), EICAR]));
    expect(r.status).toBe('INFECTED');
  });
});
