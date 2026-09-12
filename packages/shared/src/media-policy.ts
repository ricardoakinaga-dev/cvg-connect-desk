import { createHash } from 'crypto';

/**
 * Media security policy (Phase 3 — §6, fatia 1: validação + SSRF + hash).
 * Object storage (S3/MinIO) e malware scan são próximos passos documentados;
 * esta camada já impede: MIME não permitido, estouro de tamanho, base64 gigante
 * no banco e URLs internas (SSRF) encaminhadas ao provider.
 */

export type MediaKind = 'image' | 'audio' | 'video' | 'document';

const ALLOWED_MIME: Record<MediaKind, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  audio: ['audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/aac'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
  document: ['application/pdf', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
};

export function getMediaMaxBytes(): number {
  return Number(process.env.MEDIA_MAX_BYTES) || 16 * 1024 * 1024;
}

export type MediaRejectReason =
  | 'mime_not_allowed'
  | 'media_too_large'
  | 'unsafe_url'
  | 'invalid_data_url';

export interface MediaValidation {
  ok: boolean;
  reason?: MediaRejectReason;
  message?: string;
  sha256?: string;
}

/** SHA-256 de string/buffer (identidade de mídia, dedup, auditoria). */
export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host === '::ffff:127.0.0.1') return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^0\.0\.0\.0$/.test(host)) return true;
  return false;
}

/**
 * Guard SSRF para URLs que serão buscadas/encaminhadas.
 * Permite: https/http públicos e data: (com checagem de tamanho à parte).
 * Bloqueia: file://, ftp://, hosts privados/loopback/link-local e redirects
 * não se aplicam aqui — callers devem desabilitar redirects para destinos
 * privados quando seguirem redirects.
 */
export function assertSafeMediaUrl(url: string): MediaValidation {
  const trimmed = url.trim();
  if (trimmed.startsWith('data:')) {
    return { ok: true };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'unsafe_url', message: 'Invalid media URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'unsafe_url', message: `Blocked media URL scheme: ${parsed.protocol}` };
  }
  if (isPrivateHostname(parsed.hostname)) {
    return { ok: false, reason: 'unsafe_url', message: 'Blocked private/internal media host (SSRF)' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'unsafe_url', message: 'Media URL must not contain credentials' };
  }
  return { ok: true };
}

/** Tamanho aproximado em bytes de um data-URL base64. */
export function dataUrlSizeBytes(dataUrl: string): number | undefined {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return undefined;
  const [, , base64, data] = match;
  if (!base64) return Buffer.byteLength(data, 'utf8');
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

export interface ValidateMediaInput {
  mediaType?: string;
  mimetype?: string;
  url?: string;
  sizeBytes?: number;
}

export function validateMedia(input: ValidateMediaInput): MediaValidation {
  const maxBytes = getMediaMaxBytes();

  if (input.url) {
    const safe = assertSafeMediaUrl(input.url);
    if (!safe.ok) return safe;

    if (input.url.startsWith('data:')) {
      const size = dataUrlSizeBytes(input.url);
      if (size !== undefined && size > maxBytes) {
        return { ok: false, reason: 'media_too_large', message: `Embedded media exceeds ${maxBytes} bytes` };
      }
      if (size === undefined) {
        return { ok: false, reason: 'invalid_data_url', message: 'Malformed data URL' };
      }
    }
  }

  if (input.sizeBytes !== undefined && input.sizeBytes > maxBytes) {
    return { ok: false, reason: 'media_too_large', message: `Media exceeds ${maxBytes} bytes` };
  }

  if (input.mediaType && input.mimetype) {
    const kind = input.mediaType as MediaKind;
    const allowed = ALLOWED_MIME[kind];
    if (!allowed) {
      return { ok: false, reason: 'mime_not_allowed', message: `Unknown media type: ${input.mediaType}` };
    }
    const mime = input.mimetype.split(';')[0].trim().toLowerCase();
    if (!allowed.includes(mime)) {
      return { ok: false, reason: 'mime_not_allowed', message: `MIME ${input.mimetype} not allowed for ${input.mediaType}` };
    }
  }

  return { ok: true };
}

/** Nome de arquivo seguro (sem path traversal, chars de controle ou excesso). */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() || 'file';
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, '').replace(/^\.+/, '').trim();
  return (cleaned || 'file').slice(0, 128);
}

// ============================================
// MIME sniffing por magic bytes (§18) — nunca confiar só em extensão/header.
// ============================================

const MAGIC_BYTES: Array<{ kind: MediaKind; mimes: string[]; prefix: (b: Buffer) => boolean }> = [
  { kind: 'image', mimes: ['image/jpeg'], prefix: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { kind: 'image', mimes: ['image/png'], prefix: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { kind: 'image', mimes: ['image/gif'], prefix: (b) => b.length >= 6 && (b.subarray(0, 3).toString('latin1') === 'GIF' || b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a') },
  { kind: 'image', mimes: ['image/webp'], prefix: (b) => b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { kind: 'audio', mimes: ['audio/mpeg', 'audio/mp3'], prefix: (b) => b.length >= 3 && (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) }, // ID3
  { kind: 'audio', mimes: ['audio/ogg'], prefix: (b) => b.length >= 4 && b.subarray(0, 4).toString('latin1') === 'OggS' },
  { kind: 'audio', mimes: ['audio/wav'], prefix: (b) => b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WAVE' },
  { kind: 'video', mimes: ['video/mp4'], prefix: (b) => b.length >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp' },
  { kind: 'video', mimes: ['video/webm'], prefix: (b) => b.length >= 4 && b.subarray(0, 4).toString('latin1') === '\x1aE\xdf\xa3' },
  { kind: 'document', mimes: ['application/pdf'], prefix: (b) => b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { kind: 'document', mimes: ['application/zip', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'], prefix: (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07) }, // ZIP/OOXML
];

/** Detecta MIME real pelos primeiros bytes (independente de extension/header). */
export function sniffMimeType(bytes: Buffer): string | undefined {
  for (const entry of MAGIC_BYTES) {
    if (entry.prefix(bytes)) {
      return entry.mimes[0];
    }
  }
  return undefined;
}

/** MIME declarado casa com bytes? (polyglot/mismatch detection mínimo). */
export function mimeMatchesBytes(declaredMime: string, bytes: Buffer): { matches: boolean; detected?: string } {
  const normalized = (declaredMime || '').split(';')[0].trim().toLowerCase();
  const detected = sniffMimeType(bytes);
  if (!detected) {
    // Sem magic reconhecível (text/plain, JSON): não ambíguo — aceita.
    return { matches: true, detected };
  }
  const allowed = MAGIC_BYTES.find((e) => e.mimes.includes(normalized));
  if (!allowed) {
    // MIME declarado fora da allowlist: validateMedia() barra antes.
    return { matches: false, detected };
  }
  return { matches: allowed.prefix(bytes), detected };
}

// ============================================
// DNS rebinding defense (§18): revalida IP PRIVADO após resolução DNS,
// não confiar no hostname validado antes da conexão.
// ============================================

export function isPrivateIp(ip: string): boolean {
  const host = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (host === '::1' || host === '::ffff:127.0.0.1') return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^0\.0\.0\.0$/.test(host) || host === '::') return true;
  if (/^fe80:/i.test(host) || /^f[cd][0-9a-f]{2}:/i.test(host)) return true; // link-local + ULA
  return false;
}

/** Resolve todos os IPs de um hostname e rejeita qualquer IP privado. */
export async function dnsRebindingCheck(hostname: string): Promise<{ ok: boolean; ips: string[]; reason?: string }> {
  const dns = await import('node:dns');
  const ips = await new Promise<string[]>((resolve) => {
    dns.promises.lookup(hostname, { all: true }).then(
      (r) => resolve(r.map((x) => x.address)),
      () => resolve([]),
    );
  });
  if (ips.length === 0) {
    return { ok: false, ips, reason: 'DNS sem resposta' };
  }
  const privateIps = ips.filter((ip) => isPrivateIp(ip));
  if (privateIps.length > 0) {
    return { ok: false, ips, reason: `IP privado(s) na resolução DNS (rebinding?): ${privateIps.join(', ')}` };
  }
  return { ok: true, ips };
}

/** Fetch controlado com: SSRF, DNS rebinding recheck, redirect limit, timeout. */
export async function safeRemoteFetch(url: string, maxBytes: number, opts: { maxRedirects?: number } = {}): Promise<Buffer> {
  const maxRedirects = opts.maxRedirects ?? 0;
  const safe = assertSafeMediaUrl(url);
  if (!safe.ok) throw new Error(safe.message || 'Unsafe media URL');

  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const parsed = new URL(url);
    const dnsCheck = await dnsRebindingCheck(parsed.hostname);
    if (!dnsCheck.ok) throw new Error(`Media URL DNS guard: ${dnsCheck.reason}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(process.env.MEDIA_FETCH_TIMEOUT_MS) || 20000);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: 'manual' });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('Redirect sem location');
        if (redirect === maxRedirects) throw new Error('Máximo de redirects excedido');
        url = new URL(location, url).toString();
        continue;
      }
      if (!response.ok) throw new Error(`Media fetch failed: HTTP ${response.status}`);
      const contentLength = response.headers.get('content-length');
      if (contentLength && Number(contentLength) > maxBytes) throw new Error(`Media exceeds ${maxBytes} bytes`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) throw new Error(`Media exceeds ${maxBytes} bytes`);
      return buffer;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Redirects excedidos');
}
