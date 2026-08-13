export interface NormalizedInboundMessage {
  externalMessageId: string;
  externalConversationId: string;
  content: string;
  sender: string;
  senderType: 'contact' | 'system' | 'unknown';
  contactPhone: string;
  contactName?: string;
  sentAt: Date;
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

export interface PendingOutboundMessage {
  id: string;
  content: string;
  sender: string | null;
}

export interface GatewayDeskHandlers {
  receiveInboundMessage(input: NormalizedInboundMessage): Promise<InboundMessageResult>;
  findPendingOutbound(limit: number): Promise<PendingOutboundMessage[]>;
  markOutboundSent(id: string, externalMessageId?: string): Promise<void>;
  updateReceipt(externalMessageId: string, status: string, deliveredAt?: Date): Promise<{ updated: boolean; messageId?: string; status?: string; skipped?: true; reason?: string }>;
}

let gatewayDeskHandlers: GatewayDeskHandlers | null = null;

export function setGatewayDeskHandlers(handlers: GatewayDeskHandlers | null): void {
  gatewayDeskHandlers = handlers;
}

export function getGatewayDeskHandlers(): GatewayDeskHandlers {
  if (!gatewayDeskHandlers) {
    throw new Error('Gateway desk handlers are not configured');
  }

  return gatewayDeskHandlers;
}
