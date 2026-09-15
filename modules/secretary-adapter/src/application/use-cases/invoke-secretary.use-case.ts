import { ok, err, type Result } from '@cvg/shared';
import { AppError } from '@cvg/shared';
import { getSecretaryClient } from '@cvg/integrations';
import { buildSecretaryRequest, handleSecretaryResponse, validateSecretaryResponse } from '../../infrastructure';
import { classifyAIAction, evaluateAIPolicy, recordAIDecision, sanitizeAIArgs } from '../ai-policy';
import { countConversationInvocations } from '../../infrastructure/repositories/secretary-invocation.repository';
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
  /**
   * PROD-10 — identidade estável da invocação durável. Replays/crash reusam o
   * MESMO id (estado `secretary_invocations`), então os eventos publicados e a
   * trilha de decisão permitem correlacionar as tentativas de uma mesma
   * invocação lógica; ausente ⇒ id sintético por chamada (comportamento
   * anterior preservado).
   */
  invocationId?: string;
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

export async function invokeSecretary(input: InvokeSecretaryInput): Promise<Result<InvokeSecretaryOutput, AppError>> {
  const client = getSecretaryClient();
  if (!client) {
    return err(new AppError('Secretary client not initialized', 500, 'SECRETARY_NOT_CONFIGURED'));
  }

  const invocationId = input.invocationId?.trim()
    || `${INVOCATION_ID_PREFIX}${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // AI Safety policy gate (§8): antes de qualquer chamada externa.
  // PROD-13/AC1 — `priorInvocations` vem do contador DURÁVEL por conversa em
  // `secretary_invocations` (a própria invocação é excluída). Indisponibilidade
  // do store NÃO libera a chamada: sem contador confiável a decisão é deny
  // (fail-closed, 403 AI_POLICY_DENIED).
  let priorInvocations: number;
  try {
    priorInvocations = await countConversationInvocations(input.conversationId, {
      excludeInvocationKey: invocationId,
    });
  } catch {
    recordAIDecision({
      invocationId,
      action: input.action,
      classification: classifyAIAction(input.action),
      decision: 'deny',
      reason: 'ai budget store unavailable',
      conversationId: input.conversationId,
      messageId: input.messageId,
    });
    await publishSecretaryInvocation({
      conversationId: input.conversationId,
      messageId: input.messageId,
      invocationId,
      action: input.action,
      status: 'failed',
      errorMessage: 'AI policy denied: budget store unavailable',
      metadata: { policyDenied: true, reasonCode: 'BUDGET_STORE_UNAVAILABLE' },
    });
    return err(new AppError('AI policy denied: budget store unavailable', 403, 'AI_POLICY_DENIED'));
  }

  const policy = evaluateAIPolicy({
    invocationId,
    action: input.action,
    conversationId: input.conversationId,
    messageId: input.messageId,
    contentChars: input.content?.length ?? 0,
    historyItems: input.conversationHistory?.length ?? 0,
    priorInvocations,
  });
  recordAIDecision({
    invocationId,
    action: input.action,
    classification: policy.classification,
    decision: policy.decision,
    reason: policy.reason,
    conversationId: input.conversationId,
    messageId: input.messageId,
  });
  if (policy.decision === 'deny') {
    await publishSecretaryInvocation({
      conversationId: input.conversationId,
      messageId: input.messageId,
      invocationId,
      action: input.action,
      status: 'failed',
      errorMessage: `AI policy denied: ${policy.reason}`,
      metadata: { policyDenied: true, reasonCode: policy.reasonCode, args: sanitizeAIArgs({ action: input.action }) },
    });
    return err(new AppError(`AI policy denied: ${policy.reason}`, 403, 'AI_POLICY_DENIED'));
  }

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
      input.messageId,
      invocationId,
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

    return err(error instanceof AppError
      ? error
      : new AppError(error instanceof Error ? error.message : 'Unknown error', 500, 'SECRETARY_ERROR'));
  }
}
