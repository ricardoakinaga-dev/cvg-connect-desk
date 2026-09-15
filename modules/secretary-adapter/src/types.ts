export interface SecretaryInvocationRequest {
  conversationId: string;
  messageId?: string;
  /** Chave estável para retries/reconciliação no provider externo. */
  invocationId?: string;
  action: 'classify' | 'respond' | 'handoff' | 'evaluate';
  context: {
    content: string;
    sender: string;
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
    contactInfo?: {
      name?: string;
      phone?: string;
      tutorId?: string;
      patientId?: string;
    };
    metadata?: Record<string, unknown>;
  };
}

export interface SecretaryInvocationResponse {
  success: boolean;
  response?: string;
  classification?: {
    category: 'clinical' | 'commercial' | 'urgent' | 'general';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    confidence: number;
  };
  action?: string;
  handoffReason?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface HandoffContext {
  conversationId: string;
  previousHandler: 'bot' | 'human';
  newHandler: 'bot' | 'human';
  reason: string;
  triggeredBy?: string;
  metadata?: Record<string, unknown>;
}
