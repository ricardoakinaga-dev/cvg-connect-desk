import type { SecretaryInvocationRequest } from '../types';

export function buildSecretaryRequest(
  conversationId: string,
  action: SecretaryInvocationRequest['action'],
  context: {
    content: string;
    sender: string;
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
    contactName?: string;
    contactPhone?: string;
    tutorId?: string;
    patientId?: string;
  },
  messageId?: string,
  invocationId?: string,
): SecretaryInvocationRequest {
  return {
    conversationId,
    messageId,
    invocationId,
    action,
    context: {
      content: context.content,
      sender: context.sender,
      conversationHistory: context.conversationHistory,
      contactInfo: {
        name: context.contactName,
        phone: context.contactPhone,
        tutorId: context.tutorId,
        patientId: context.patientId,
      },
    },
  };
}
