import { z } from 'zod';

/**
 * InboundMessageV1 — mensagem inbound normalizada (contrato de domínio).
 * Produzido por: gateway normalizer (Evolution → WA_INBOUND → interno),
 * webhook /webhook/inbound (após validação Fastify).
 * Consumido por: receiveInboundMessage (modules/chat).
 *
 * Domínio nunca recebe payload cru da Evolution API.
 */
export const InboundMessageV1Schema = z.object({
  specVersion: z.literal('1.0.0'),
  externalMessageId: z.string().min(1).max(256),
  externalConversationId: z.string().max(256).optional(),
  content: z.string().max(10000),
  sender: z.string().min(1).max(64),
  senderType: z.enum(['contact', 'system', 'unknown']).default('contact'),
  contactPhone: z.string().max(32).optional(),
  contactName: z.string().max(128).optional(),
  sentAt: z.coerce.date(),
  mediaUrl: z.string().max(2048).optional(),
  mediaType: z.enum(['text', 'image', 'audio', 'video', 'document', 'unknown']).optional(),
  mediaMimetype: z.string().max(128).optional(),
  mediaFilename: z.string().max(256).optional(),
});

export type InboundMessageV1 = z.infer<typeof InboundMessageV1Schema>;

export function parseInboundMessageV1(input: unknown):
  | { ok: true; value: InboundMessageV1 }
  | { ok: false; issues: string } {
  const parsed = InboundMessageV1Schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, issues: JSON.stringify(parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))) };
}
