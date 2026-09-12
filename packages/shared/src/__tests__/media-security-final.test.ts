import { describe, it, expect } from 'vitest';
import {
  sniffMimeType,
  mimeMatchesBytes,
  isPrivateIp,
  dnsRebindingCheck,
  safeRemoteFetch,
  validateMedia,
} from '../media-policy';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 0)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 0)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100, 0)]);
const EICARISH = Buffer.from('plain text sem magic');

describe('media security final (magic bytes + rebinding + redirects)', () => {
  it('sniffMimeType detecta jpeg/png/pdf e ignora texto', () => {
    expect(sniffMimeType(JPEG)).toBe('image/jpeg');
    expect(sniffMimeType(PNG)).toBe('image/png');
    expect(sniffMimeType(PDF)).toBe('application/pdf');
    expect(sniffMimeType(EICARISH)).toBeUndefined();
  });

  it('mimeMatchesBytes: PNG declarado como jpeg é mismatch (polyglot)', () => {
    expect(mimeMatchesBytes('image/png', PNG)).toMatchObject({ matches: true });
    expect(mimeMatchesBytes('image/jpeg', PNG)).toMatchObject({ matches: false, detected: 'image/png' });
    expect(mimeMatchesBytes('text/plain', EICARISH)).toMatchObject({ matches: true });
  });

  it('validateMedia mantém política: MIME não permitido bloqueado', () => {
    expect(validateMedia({ mediaType: 'image', mimetype: 'image/png', url: 'x' })).toMatchObject({ ok: false });
  });

  it('isPrivateIp cobre loopback/RFC1918/metadata/link-local/IPv6', () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '172.16.0.1', '169.254.169.254', '::1', 'fe80::1', 'fd42::1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('151.101.1.140')).toBe(false);
  });

  it('dnsRebindingCheck rejeita hostname que resolve para privado', async () => {
    const r = await dnsRebindingCheck('127.0.0.1');
    expect(r.ok).toBe(false);
    const localhost = await dnsRebindingCheck('localhost');
    expect(localhost.ok).toBe(false);
  });

  it('safeRemoteFetch: SSRF + dns guard + redirect limit + size cap', async () => {
    await expect(safeRemoteFetch('http://169.254.169.254/x', 100)).rejects.toThrow(/Blocked/i);
    await expect(safeRemoteFetch('http://localhost:9/x', 100)).rejects.toThrow(/DNS guard|Blocked/i);
    await expect(safeRemoteFetch('http://127.0.0.1:9/x', 1)).rejects.toThrow();
    await expect(safeRemoteFetch('not-a-url', 100)).rejects.toThrow();
    await expect(safeRemoteFetch('https://example.com/x', 10)).rejects.toThrow(); // fetch real falha/size, mas nunca SSRF-pass
  }, 30000);
});
