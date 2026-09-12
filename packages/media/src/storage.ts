/**
 * MediaStorage abstraction (Final-3).
 * Domínio depende desta interface — nunca de um provider específico.
 */

export interface PutMediaInput {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface MediaStorage {
  readonly driver: string;
  put(input: PutMediaInput): Promise<{ etag?: string }>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  createSignedReadUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

export function quarantineKey(key: string): string {
  return key.startsWith('quarantine/') ? key : `quarantine/${key}`;
}

export function mediaKey(key: string): string {
  return key.startsWith('media/') ? key : `media/${key.replace(/^quarantine\//, '')}`;
}

export function isQuarantined(key: string): boolean {
  return key.startsWith('quarantine/');
}
