import { describe, it, expect } from 'vitest';
import {
  validateMedia,
  assertSafeMediaUrl,
  dataUrlSizeBytes,
  safeFilename,
  sha256Hex,
} from '../media-policy';

describe('media-policy', () => {
  it('allows listed MIME per kind and rejects others', () => {
    expect(validateMedia({ mediaType: 'image', mimetype: 'image/jpeg' }).ok).toBe(true);
    expect(validateMedia({ mediaType: 'image', mimetype: 'application/x-sh' })).toMatchObject({
      ok: false,
      reason: 'mime_not_allowed',
    });
    expect(validateMedia({ mediaType: 'application', mimetype: 'application/x-sh' })).toMatchObject({
      ok: false,
      reason: 'mime_not_allowed',
    });
    expect(validateMedia({ mediaType: 'audio', mimetype: 'audio/ogg' }).ok).toBe(true);
  });

  it('rejects oversized media', () => {
    expect(validateMedia({ sizeBytes: 1024 }).ok).toBe(true);
    expect(validateMedia({ sizeBytes: 1_000_000_000 })).toMatchObject({ ok: false, reason: 'media_too_large' });
  });

  it('blocks SSRF targets (file, localhost, private nets, metadata IP)', () => {
    for (const url of [
      'file:///etc/passwd',
      'ftp://example.com/x',
      'http://localhost:8080/x',
      'http://127.0.0.1/x',
      'http://10.0.0.5/x',
      'http://192.168.1.1/x',
      'http://172.16.0.1/x',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/x',
      'https://user:pass@example.com/x',
      'not a url',
    ]) {
      expect(assertSafeMediaUrl(url).ok, url).toBe(false);
    }
    expect(assertSafeMediaUrl('https://example.com/foto.jpg').ok).toBe(true);
    expect(assertSafeMediaUrl('http://cdn.example.com/a.mp3').ok).toBe(true);
  });

  it('bounds embedded base64 data URLs', () => {
    const small = `data:image/jpeg;base64,${Buffer.from('hello').toString('base64')}`;
    expect(validateMedia({ url: small }).ok).toBe(true);
    expect(dataUrlSizeBytes(small)).toBe(5);

    const huge = `data:image/jpeg;base64,${'A'.repeat(30_000_000)}`;
    expect(validateMedia({ url: huge })).toMatchObject({ ok: false, reason: 'media_too_large' });
    expect(validateMedia({ url: 'data:;base64,@@@' }).ok).toBe(true);
  });

  it('sanitizes filenames against traversal', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('..\\windows\\x')).toBe('x');
    expect(safeFilename('foto legal.jpg')).toBe('foto legal.jpg');
    expect(safeFilename('')).toBe('file');
  });

  it('sha256 is deterministic', () => {
    expect(sha256Hex('abc')).toBe(sha256Hex(Buffer.from('abc')));
    expect(sha256Hex('abc')).toHaveLength(64);
  });
});
