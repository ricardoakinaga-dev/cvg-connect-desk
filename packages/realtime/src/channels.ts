/**
 * Canais realtime canônicos (C02 §4).
 *
 * - `global` transporta somente sinais sanitizados (D-C02-5);
 * - `user:<userId>` é o canal pessoal do principal;
 * - `conversation:<conversationId>` exige acesso à conversa (D-C02-2/3);
 * - `sector:<sectorId>` exige membership no setor;
 * - `correlation:<id>` é canal de sinal, nunca de conteúdo.
 *
 * Canais legados `<aggregateType>:<id>` de Conversa/Setor/Usuário mapeiam para
 * o canal canônico correspondente. Canais legados de agregados sem resolução
 * de escopo (ex.: `message:<id>`) são recusados: o conteúdo de mensagem é
 * roteado para `conversation:<conversationId>`.
 */

export const GLOBAL_CHANNEL = 'global';

export type ParsedChannel =
  | { channel: string; kind: 'global' }
  | { channel: string; kind: 'user'; userId: string }
  | { channel: string; kind: 'conversation'; conversationId: string }
  | { channel: string; kind: 'sector'; sectorId: string }
  | { channel: string; kind: 'correlation'; correlationId: string };

const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_CHANNEL_LENGTH = 256;

export function userChannel(userId: string): string {
  return `user:${userId}`;
}

export function conversationChannel(conversationId: string): string {
  return `conversation:${conversationId}`;
}

export function sectorChannel(sectorId: string): string {
  return `sector:${sectorId}`;
}

export function correlationChannel(correlationId: string): string {
  return `correlation:${correlationId}`;
}

export function parseChannel(raw: unknown): ParsedChannel | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_CHANNEL_LENGTH) {
    return null;
  }

  if (value === GLOBAL_CHANNEL) {
    return { channel: GLOBAL_CHANNEL, kind: 'global' };
  }

  const separator = value.indexOf(':');
  if (separator <= 0 || separator === value.length - 1) {
    return null;
  }

  const prefix = value.slice(0, separator).toLowerCase();
  const id = value.slice(separator + 1);
  if (!IDENTIFIER.test(id)) {
    return null;
  }

  switch (prefix) {
    case 'user':
      return { channel: userChannel(id), kind: 'user', userId: id };
    case 'conversation':
      return { channel: conversationChannel(id), kind: 'conversation', conversationId: id };
    case 'sector':
      return { channel: sectorChannel(id), kind: 'sector', sectorId: id };
    case 'correlation':
      return { channel: correlationChannel(id), kind: 'correlation', correlationId: id };
    default:
      return null;
  }
}

export function isContentChannel(parsed: ParsedChannel): boolean {
  return parsed.kind === 'conversation' || parsed.kind === 'sector' || parsed.kind === 'user';
}
