import type { SendOutboundMessageInput } from './use-cases/send-outbound-message.use-case';

export interface OutboundDeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface OutboundDeliveryService {
  send(input: SendOutboundMessageInput): Promise<OutboundDeliveryResult>;
}

let outboundDeliveryService: OutboundDeliveryService | null = null;

export function setOutboundDeliveryService(service: OutboundDeliveryService | null): void {
  outboundDeliveryService = service;
}

export function getOutboundDeliveryService(): OutboundDeliveryService | null {
  return outboundDeliveryService;
}
