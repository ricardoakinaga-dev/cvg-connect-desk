import { ok, err, type Result } from '@cvg/shared';
import { AppError } from '@cvg/shared';
import { getSecretaryClient } from '@cvg/integrations';
import { buildSecretaryRequest, handleSecretaryResponse, validateSecretaryResponse } from '../../infrastructure';
import { publishSecretaryInvocation } from './secretary-publisher';

export interface InvokeSecretaryInput {
  conversationId: string;
  messageId?: string;
  action: 'classify' | 'respond' | 'handoff' | 'evaluate';
  content: string;
  sender: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  contactName?: string;
  contactPhone?: string;
  tutorId?: string;
  patientId?: string;
}

export interface InvokeSecretaryOutput {
  success: boolean;
  response?: string;
  classification?: {
    category: 'clinical' | 'commercial' | 'urgent' | 'general';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    confidence: number;
  };
  shouldHandoff: boolean;
  handoffReason?: string;
  metadata?: Record<string, unknown>;
}

const INVOCATION_ID_PREFIX = 'sec_';

export async function invokeSecretary(input: InvokeSecretaryInput): Promise<Result<InvokeSecretaryOutput, Error>> {
  const client = getSecretaryClient();
  if (!client) {
    return err(new AppError('Secretary client not initialized', 500, 'SECRETARY_NOT_CONFIGURED'));
  }

  const invocationId = `${INVOCATION_ID_PREFIX}${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  await publishSecretaryInvocation({
    conversationId: input.conversationId,
    messageId: input.messageId,
    invocationId,
    action: input.action,
    status: 'requested',
  });

  try {
    const secretaryRequest = buildSecretaryRequest(
      input.conversationId,
      input.action,
      {
        content: input.content,
        sender: input.sender,
        conversationHistory: input.conversationHistory,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        tutorId: input.tutorId,
        patientId: input.patientId,
      },
      input.messageId
    );

    const result = await client.invoke(secretaryRequest);

    if (result.isErr()) {
      await publishSecretaryInvocation({
        conversationId: input.conversationId,
        messageId: input.messageId,
        invocationId,
        action: input.action,
        status: 'failed',
        errorMessage: result.error.message,
      });

      return err(result.error);
    }

    const response = result.value;

    if (!validateSecretaryResponse(response)) {
      const error = new AppError('Invalid response format from Secretary', 500, 'SECRETARY_INVALID_RESPONSE');
      
      await publishSecretaryInvocation({
        conversationId: input.conversationId,
        messageId: input.messageId,
        invocationId,
        action: input.action,
        status: 'failed',
        errorMessage: 'Invalid response format',
      });

      return err(error);
    }

    const parsedResult = handleSecretaryResponse(response);
    
    if (parsedResult.isErr()) {
      await publishSecretaryInvocation({
        conversationId: input.conversationId,
        messageId: input.messageId,
        invocationId,
        action: input.action,
        status: 'failed',
        errorMessage: parsedResult.error.message,
      });

      return err(parsedResult.error);
    }

    await publishSecretaryInvocation({
      conversationId: input.conversationId,
      messageId: input.messageId,
      invocationId,
      action: input.action,
      status: 'success',
      metadata: parsedResult.value.metadata,
    });

    return ok({
      success: parsedResult.value.success,
      response: parsedResult.value.response,
      classification: parsedResult.value.classification,
      shouldHandoff: parsedResult.value.shouldHandoff,
      handoffReason: parsedResult.value.handoffReason,
      metadata: parsedResult.value.metadata,
    });
  } catch (error) {
    await publishSecretaryInvocation({
      conversationId: input.conversationId,
      messageId: input.messageId,
      invocationId,
      action: input.action,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });

    return err(error as Error);
  }
}
