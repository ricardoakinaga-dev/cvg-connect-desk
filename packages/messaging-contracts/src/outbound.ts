import { z } from 'zod';

/**
 * OutboundMessageV1 — mensagem outbound normalizada (contrato de domínio).
 * Produzido por: POST /messages (após validação Fastify + auth).
 * Consumido por: sendOutboundMessage → provider (EvolutionProvider).
 */
export const OutboundMessageV1Schema = z.object({
  specVersion: z.literal('1.0.0'),
  conversationId: z.string().uuid(),
  content: z.string().max(10000),
  recipient: z.string().min(1).max(64),
  sender: z.string().max(64).optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
  clientMessageId: z.string().max(128).optional(),
  mediaUrl: z.string().max(2048).optional(),
  mediaType: z.enum(['image', 'audio', 'video', 'document']).optional(),
  mediaMimetype: z.string().max(128).optional(),
  mediaFilename: z.string().max(256).optional(),
});

export type OutboundMessageV1 = z.infer<typeof OutboundMessageV1Schema>;
