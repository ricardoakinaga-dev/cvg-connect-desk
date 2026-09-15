/**
 * Redaction para logs (Phase 6 + LGPD §13).
 * Nunca registrar: Authorization, cookies, tokens, API keys, webhook secrets,
 * senhas; mascarar telefones quando apropriado.
 */

const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'apikey',
  'x-api-key',
  'secret',
  'webhook_secret',
  'webhook-secret',
  'x-webhook-signature',
  'password',
  'passwordhash',
  'session',
  'bearer',
]);

const PII_KEYS = new Set(['phone', 'contactphone', 'recipient', 'sender', 'email']);

export const REDACTED = '[REDACTED]';
export const MASKED_PHONE = '[PHONE]';

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

/** Reduz telefone a máscara (mantém DDI quando possível para debug operacional). */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return MASKED_PHONE;
  return `${MASKED_PHONE}:${digits.slice(0, 2)}***${digits.slice(-2)}`;
}

function redactValue(key: string, value: unknown, maskPhones: boolean): unknown {
  const normalized = normalizeKey(key);
  if (SENSITIVE_KEYS.has(key.toLowerCase()) || SENSITIVE_KEYS.has(normalized)) {
    return REDACTED;
  }
  if (maskPhones && PII_KEYS.has(normalized) && typeof value === 'string') {
    return maskPhone(value);
  }
  return value;
}

/**
 * Clona o objeto aplicando redaction (não muta o original).
 * Suporta aninhamento e arrays. Valores circulares viram '[Circular]'.
 */
export function redactObject<T>(input: T, options: { maskPhones?: boolean } = {}): T {
  const maskPhones = options.maskPhones ?? true;
  const seen = new WeakSet();

  const walk = (value: unknown, key = ''): unknown => {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return redactValue(key, value, maskPhones);
    }
    if (typeof value !== 'object') return value;
    if (seen.has(value as object)) return '[Circular]';
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.map((item) => walk(item, key));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const redacted = redactValue(k, v, maskPhones);
      out[k] = redacted === v && typeof v === 'object' && v !== null ? walk(v, k) : redacted;
    }
    return out;
  };

  return walk(input) as T;
}

/** Paths de redaction para o logger pino (Fastify). */
export const PINO_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-webhook-signature"]',
  'req.body.password',
  'req.body.token',
  'res.headers["set-cookie"]',
];

/**
 * Remove caracteres de controle C0 (U+0000–U+001F) e DEL (U+007F).
 * Implementado sem regex para não depender de classes com escapes de
 * controle (evita falso positivo do `no-control-regex` do ESLint).
 */
export function stripControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code > 0x1f && code !== 0x7f) out += ch;
  }
  return out;
}
