import net from 'node:net';

/**
 * Malware scanning (Final-4).
 * Estados: PENDING_SCAN → CLEAN | INFECTED | SCAN_FAILED (+ QUARANTINED via storage).
 * Nenhum arquivo INFECTED chega ao prefixo público `media/`.
 */

export type ScanStatus = 'PENDING_SCAN' | 'CLEAN' | 'INFECTED' | 'SCAN_FAILED';

export interface ScanResult {
  status: 'CLEAN' | 'INFECTED' | 'SCAN_FAILED';
  signature?: string;
  durationMs: number;
  error?: string;
}

export interface MalwareScanner {
  readonly name: string;
  scan(bytes: Buffer, filename?: string): Promise<ScanResult>;
}

function getTimeoutMs(): number {
  return Number(process.env.MALWARE_SCAN_TIMEOUT_MS) || 15000;
}

/**
 * FakeScanner — dev/test EXPLÍCITO. Nunca habilitado silenciosamente em produção.
 */
export class FakeScanner implements MalwareScanner {
  readonly name = 'fake';
  private verdict: 'CLEAN' | 'INFECTED';

  constructor(verdict: 'CLEAN' | 'INFECTED' = 'CLEAN') {
    const env = (process.env.NODE_ENV || process.env.DESK_ENV || '').toLowerCase();
    const isProd = env === 'production' || env === 'prod';
    if (isProd && process.env.MEDIA_ALLOW_FAKE_SCANNER !== 'true') {
      throw new Error('[Media] FakeScanner proibido em produção (configure MALWARE_SCANNER=clamav)');
    }
    this.verdict = verdict;
  }

  async scan(bytes: Buffer): Promise<ScanResult> {
    const started = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 1));
    if (this.verdict === 'INFECTED' || bytes.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'))) {
      return { status: 'INFECTED', signature: 'EICAR-Test-File', durationMs: Date.now() - started };
    }
    return { status: 'CLEAN', durationMs: Date.now() - started };
  }
}

function readClamdReply(socket: net.Socket, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('ClamAV scan timed out'));
    }, timeoutMs);
    socket.on('data', (chunk: Buffer) => {
      data += chunk.toString('utf8');
    });
    socket.on('end', () => {
      clearTimeout(timer);
      resolve(data.replace(/\0+$/u, '').trim());
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * ClamAVScanner — fala INSTREAM com clamd via TCP.
 * `clamd.conf` precisa de `TCPSocket` habilitado.
 */
export class ClamAVScanner implements MalwareScanner {
  readonly name = 'clamav';
  private readonly host: string;
  private readonly port: number;

  constructor(host = process.env.CLAMAV_HOST || '127.0.0.1', port = Number(process.env.CLAMAV_PORT) || 3310) {
    this.host = host;
    this.port = port;
  }

  async scan(bytes: Buffer): Promise<ScanResult> {
    const started = Date.now();
    const timeoutMs = getTimeoutMs();
    const socket = net.connect(this.port, this.host);
    const reply = readClamdReply(socket, timeoutMs);
    // Evita unhandled rejection: o mesmo 'error' rejeita o connect abaixo;
    // o consumo real acontece no await mais adiante.
    reply.catch(() => {});

    try {
      await new Promise<void>((resolve, reject) => {
        socket.on('connect', () => resolve());
        socket.on('error', reject);
        setTimeout(() => reject(new Error('ClamAV connect timed out')), Math.min(timeoutMs, 5000));
      });

      socket.write('zINSTREAM\0');
      const CHUNK = 1024 * 128;
      for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        const slice = bytes.subarray(offset, offset + CHUNK);
        const header = Buffer.alloc(4);
        header.writeUInt32BE(slice.length, 0);
        socket.write(Buffer.concat([header, slice]));
      }
      const terminator = Buffer.alloc(4);
      socket.write(terminator);
      socket.end();

      const response = await reply;
      // clamd responde em modo `zINSTREAM` com NUL terminador; sem normalizar,
      // "stream: OK\0" nunca casaria e todo scan real viraria SCAN_FAILED.
      const normalized = response.replace(/\0/g, '').trim();
      if (/(^|\n)\s*stream: OK\s*$/.test(normalized)) {
        return { status: 'CLEAN', durationMs: Date.now() - started };
      }
      const infected = /stream: (.+?)\s+FOUND/.exec(normalized);
      if (infected) {
        return { status: 'INFECTED', signature: infected[1], durationMs: Date.now() - started };
      }
      return { status: 'SCAN_FAILED', error: `unexpected clamd reply: ${normalized.slice(0, 120)}`, durationMs: Date.now() - started };
    } catch (error) {
      socket.destroy();
      return {
        status: 'SCAN_FAILED',
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      };
    }
  }
}

export function getMalwareScanner(): MalwareScanner | null {
  const kind = (process.env.MALWARE_SCANNER || '').toLowerCase();
  if (kind === 'clamav') return new ClamAVScanner();
  if (kind === 'fake') return new FakeScanner();
  return null;
}

/**
 * Política de scan (Final-4): documentos SEMPRE exigem CLEAN;
 * demais tipos exigem CLEAN quando há scanner, senão fail-secure
 * configurável via MEDIA_REQUIRE_SCAN=all|documents|none (default documents).
 */
export function requiresCleanScan(mediaType: string | undefined): boolean {
  const policy = (process.env.MEDIA_REQUIRE_SCAN || 'documents').toLowerCase();
  if (policy === 'all') return true;
  if (policy === 'none') return false;
  return mediaType === 'document';
}
