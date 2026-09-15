/**
 * Porta de bytes de mídia (AAA-17 / C07).
 *
 * O módulo de privacidade não depende do pacote de mídia: a composição injeta
 * um adaptador (S3/MinIO/memória) via `setPrivacyMediaStorage`. Sem porta, os
 * bytes são reportados como residual não gerenciado — nunca apagados.
 */
export interface MediaObjectPort {
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

let mediaObjectPort: MediaObjectPort | null = null;

export function setPrivacyMediaStorage(port: MediaObjectPort | null): void {
  mediaObjectPort = port;
}

export function getPrivacyMediaStorage(): MediaObjectPort | null {
  return mediaObjectPort;
}
