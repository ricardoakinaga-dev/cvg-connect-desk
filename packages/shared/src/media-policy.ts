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
