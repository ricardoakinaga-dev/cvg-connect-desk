import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:https';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, resolve } from 'node:path';
import crypto from 'node:crypto';

/**
 * AAA-06 (C08-AAA06) — auto-contido: TLS local + mock WebSocket + stub de API.
 * Prova E1/E2 (origem remota HTTPS → wss://host/ws/, encaminhamento /ws) e
 * E3 (reconexão após queda). Não depende de imagem Docker nem de banco.
 */

const REPO_ROOT = process.cwd();
const DIST = resolve(REPO_ROOT, 'apps', 'desk-web', 'dist');
const WS_PATH = '/ws/';
const FORBIDDEN_LITERAL = 'ws://localhost:8080';

interface DistMeta {
  chunkFile: string;
  chunkSha256: string;
  override: false;
  builtAt: string;
}

function listJsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsFiles(full));
    } else if (entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

interface MockState {
  connections: number;
  upgradePaths: string[];
  authMessages: number;
  destroyAfterAuth: number;
  sockets: import('node:net').Socket[];
}

let server: Server;
let port = 0;
const state: MockState = { connections: 0, upgradePaths: [], authMessages: 0, destroyAfterAuth: 0, sockets: [] };

/**
 * Força um build default limpo (sem VITE_REALTIME_URL; nunca reutiliza dist de
 * override), valida que nenhum chunk contém o literal de loopback e confere o
 * hash do chunk principal contra `AAA06_DIST_CHUNK_SHA256` quando definido.
 */
function ensureDist(): DistMeta {
  rmSync(DIST, { recursive: true, force: true });
  const env = { ...process.env, VITE_API_URL: '/api' };
  delete env.VITE_REALTIME_URL;
  execFileSync('pnpm', ['--filter', '@cvg/desk-web', 'exec', 'vite', 'build'], {
    cwd: REPO_ROOT,
    env,
    stdio: 'inherit',
  });

  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const chunkMatch = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
  if (!chunkMatch) {
    throw new Error('[aaa06-e2e] chunk principal não encontrado em dist/index.html');
  }
  const chunkFile = chunkMatch[0];
  const chunkBytes = readFileSync(join(DIST, chunkFile));
  const chunkSha256 = crypto.createHash('sha256').update(chunkBytes).digest('hex');
  const chunkText = chunkBytes.toString('utf8');

  if (!chunkText.includes(WS_PATH)) {
    throw new Error(`[aaa06-e2e] bundle default não contém o caminho canônico ${WS_PATH} (${chunkFile})`);
  }
  for (const file of listJsFiles(join(DIST, 'assets'))) {
    if (readFileSync(file, 'utf8').includes(FORBIDDEN_LITERAL)) {
      throw new Error(`[aaa06-e2e] bundle default contém ${FORBIDDEN_LITERAL}: ${file}`);
    }
  }

  const expected = process.env.AAA06_DIST_CHUNK_SHA256;
  if (expected && expected !== chunkSha256) {
    throw new Error(`[aaa06-e2e] hash do chunk divergente: esperado ${expected}, obtido ${chunkSha256}`);
  }

  const meta: DistMeta = { chunkFile, chunkSha256, override: false, builtAt: new Date().toISOString() };
  writeFileSync(join(DIST, '.aaa06-build-meta.json'), JSON.stringify(meta, null, 2));
  console.log(`[aaa06-e2e] dist default limpo: ${chunkFile} sha256=${chunkSha256} ${FORBIDDEN_LITERAL}=0`);
  if (expected) {
    console.log('[aaa06-e2e] hash validado contra AAA06_DIST_CHUNK_SHA256');
  }
  return meta;
}

function ensureCert(): { key: Buffer; cert: Buffer } {
  const dir = mkdtempSync(join(tmpdir(), 'aaa06-tls-'));
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'],
    { stdio: 'ignore' },
  );
  return { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) };
}

function wsAccept(key: string): string {
  return crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
}

function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

function decodeFrames(buffer: Buffer): string[] {
  const messages: string[] = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const second = buffer[offset + 1];
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (cursor + 2 > buffer.length) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (cursor + 8 > buffer.length) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    const mask = masked ? buffer.subarray(cursor, cursor + 4) : null;
    if (masked) cursor += 4;
    if (cursor + length > buffer.length) break;
    const data = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (mask) {
      for (let index = 0; index < data.length; index += 1) {
        data[index] ^= mask[index % 4];
      }
    }
    messages.push(data.toString('utf8'));
    offset = cursor + length;
  }
  return messages;
}

function json(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function serveStatic(urlPath: string, response: import('node:http').ServerResponse): void {
  const clean = urlPath.split('?')[0];
  const candidate = clean === '/' ? join(DIST, 'index.html') : join(DIST, clean);
  const file = existsSync(candidate) && extname(candidate) ? candidate : join(DIST, 'index.html');
  response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  response.end(readFileSync(file));
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  ensureDist();
  const { key, cert } = ensureCert();

  server = createServer({ key, cert }, (request, response) => {
    const url = request.url ?? '/';
    if (url.startsWith('/api/')) {
      if (url.startsWith('/api/sectors')) return json(response, 200, []);
      if (url.startsWith('/api/contacts')) return json(response, 200, []);
      if (url.startsWith('/api/conversations')) return json(response, 200, { conversations: [] });
      return json(response, 200, {});
    }
    serveStatic(url, response);
  });

  server.on('upgrade', (request, socket) => {
    const url = request.url ?? '';
    if (!url.startsWith(WS_PATH)) {
      socket.destroy();
      return;
    }
    state.connections += 1;
    state.upgradePaths.push(url);
    state.sockets.push(socket);

    const keyHeader = request.headers['sec-websocket-key'];
    if (typeof keyHeader !== 'string') {
      socket.destroy();
      return;
    }
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${wsAccept(keyHeader)}`,
        '',
        '',
      ].join('\r\n'),
    );

    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (const message of decodeFrames(buffer)) {
        try {
          const parsed = JSON.parse(message) as { type?: string };
          if (parsed.type === 'auth') {
            state.authMessages += 1;
            socket.write(encodeTextFrame(JSON.stringify({ event: 'auth.success', data: { type: 'auth.success' } })));
            if (state.destroyAfterAuth > 0) {
              state.destroyAfterAuth -= 1;
              setTimeout(() => socket.destroy(), 50);
            }
          } else if (parsed.type === 'ping') {
            socket.write(encodeTextFrame(JSON.stringify({ event: 'pong', data: { type: 'pong' } })));
          }
        } catch {
          // Frame não-JSON: ignorado no mock.
        }
      }
      buffer = Buffer.alloc(0);
    });
    socket.on('error', () => undefined);
  });

  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', () => ready()));
  port = (server.address() as { port: number }).port;
});

test.afterAll(async () => {
  for (const socket of state.sockets) socket.destroy();
  await new Promise<void>((done) => server.close(() => done()));
});

async function preparePage(page: Page, token: string): Promise<void> {
  await page.addInitScript((authToken) => {
    localStorage.setItem(
      'auth-storage',
      JSON.stringify({
        state: {
          token: authToken,
          user: { id: 'e2e-aaa06', name: 'AAA-06 E2E', email: 'aaa06@example.com', roles: ['Admin'] },
          isAuthenticated: true,
        },
        version: 0,
      }),
    );
    const globalWindow = window as unknown as { __wsUrls: string[]; WebSocket: typeof WebSocket };
    globalWindow.__wsUrls = [];
    const OriginalWebSocket = globalWindow.WebSocket;
    const CapturingWebSocket = function (url: string | URL, protocols?: string | string[]) {
      globalWindow.__wsUrls.push(String(url));
      return new OriginalWebSocket(url, protocols);
    } as unknown as typeof WebSocket;
    CapturingWebSocket.prototype = OriginalWebSocket.prototype;
    Object.assign(CapturingWebSocket, OriginalWebSocket);
    globalWindow.WebSocket = CapturingWebSocket;
  }, token);
}

test('E1/E2: origem remota HTTPS conecta em wss://<host>/ws/ sem localhost e o proxy encaminha /ws', async ({ browser }) => {
  state.connections = 0;
  state.authMessages = 0;
  state.upgradePaths = [];

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await preparePage(page, 'e2e-token-aaa06');

  await page.goto(`https://127.0.0.1:${port}/inbox`, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => state.connections, { timeout: 20000 }).toBeGreaterThan(0);
  await expect.poll(() => state.authMessages, { timeout: 20000 }).toBeGreaterThan(0);

  const urls = await page.evaluate(() => (window as unknown as { __wsUrls: string[] }).__wsUrls);
  expect(urls.length).toBeGreaterThan(0);
  expect(urls[0]).toBe(`wss://127.0.0.1:${port}/ws/`);
  expect(urls[0]).not.toContain('localhost');
  expect(urls[0]).not.toContain('token');
  expect(state.upgradePaths[0]).toBe('/ws/');

  await context.close();
});

test('E3: reconexão após queda mantém o fluxo de auth', async ({ browser }) => {
  state.connections = 0;
  state.authMessages = 0;
  state.upgradePaths = [];
  state.destroyAfterAuth = 1;

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await preparePage(page, 'e2e-token-aaa06');

  await page.goto(`https://127.0.0.1:${port}/inbox`, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => state.connections, { timeout: 30000 }).toBeGreaterThanOrEqual(2);
  await expect.poll(() => state.authMessages, { timeout: 30000 }).toBeGreaterThanOrEqual(2);
  expect(state.upgradePaths.every((path) => path === '/ws/')).toBe(true);

  await context.close();
});
