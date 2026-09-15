/**
 * Portas de composição Chat↔Gateway (C02 v1.0.1 §5).
 *
 * Shapes estruturais: este módulo NÃO importa `@cvg/chat`,
 * `@cvg/gateway-adapter` nem `@cvg/shared` — evita aresta nova no grafo.
 */

export interface MessageView {
  id: string;
  conversationId: string;
  direction: 'inbound' | 'outbound';
  content: string;
  sender?: string | null;
  recipient?: string | null;
  status: string;
  externalMessageId?: string | null;
  createdAt: Date;
}

export interface InboundMessageInput {
  externalMessageId: string;
  externalConversationId?: string;
  content: string;
  sender: string;
  senderType?: 'contact' | 'system' | 'unknown';
  contactPhone?: string;
  contactName?: string;
  sentAt?: Date;
  mediaUrl?: string;
  mediaType?: string;
  mediaMimetype?: string;
  mediaFilename?: string;
  metadata?: Record<string, unknown>;
}

export interface InboundMessageResult {
  messageId: string;
  conversationId: string;
  isNewConversation: boolean;
}

export type InboundMessageOutcome =
  | { ok: true; value: InboundMessageResult }
  | { ok: false; error: { code: string; message: string } };

export interface InboundMessagePort {
  submit(input: InboundMessageInput): Promise<InboundMessageOutcome>;
}

export interface MessageReadPort {
  findByExternalId(externalMessageId: string): Promise<MessageView | null>;
  listPendingOutbound(limit: number): Promise<MessageView[]>;
}

export type ProviderReceiptStatus = 'sent' | 'delivered' | 'read' | 'failed' | 'played';
export type InternalDeliveryStatus = 'sent' | 'delivered' | 'failed';

/** Mesmo mapeamento do baseline (`gateway.controller.ts`/`use-cases`), agora compartilhado. */
export function mapProviderReceiptStatus(status: ProviderReceiptStatus): InternalDeliveryStatus {
  switch (status) {
    case 'delivered':
    case 'read':
    case 'played':
      return 'delivered';
    case 'failed':
      return 'failed';
    default:
      return 'sent';
  }
}

export interface MessageStatusPort {
  applyReceipt(input: {
    externalMessageId: string;
    status: ProviderReceiptStatus;
    statusAt: Date;
  }): Promise<{ updated: boolean; messageId?: string }>;
}

export interface OutboundConfirmationPort {
  markOutboundSent(input: {
    internalMessageId: string;
    externalMessageId?: string;
  }): Promise<{ updated: boolean; messageId?: string }>;
}

export interface GatewayOutboundRequest {
  messageId: string;
  conversationId: string;
  externalPhone: string;
  content: string;
  instance?: string;
  senderName?: string;
  senderType?: 'agent' | 'bot' | 'system';
  attachmentUrl?: string;
}

export interface GatewayOutboundPort {
  sendOutbound(
    request: GatewayOutboundRequest,
  ): Promise<{ success: boolean; messageId?: string; error?: string }>;
}

/** Dependências que a composição injeta nos handlers do gateway. */
export interface GatewayHandlerPorts {
  inbound: InboundMessagePort;
  messageRead: MessageReadPort;
  messageStatus: MessageStatusPort;
  confirmation: OutboundConfirmationPort;
}
