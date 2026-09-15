import { sql } from 'drizzle-orm';
import { db } from '@cvg/database';
import { AppError } from '@cvg/shared';
import {
  AIBudgetExhaustedError,
  beginSecretaryInvocation,
  completeSecretaryInvocation,
  failSecretaryInvocation,
  getAIBudgetLimits,
  markSecretaryInvocationUnknown,
  type BeginSecretaryInvocationResult,
  type SecretaryInvocationRecord,
} from '@cvg/secretary-adapter';
import { conversationRepository } from '../../infrastructure/repositories/conversation.repository';
import { messageRepository, type Message } from '../../infrastructure/repositories/message.repository';
import { processMessageWithSecretary } from './process-message-with-secretary.use-case';
import { sendOutboundMessage } from './send-outbound-message.use-case';

/**
 * PROD-10 / C04+C05+C08 — execução ASSÍNCRONA e durável da invocação da
 * Secretary, acionada pelo worker a partir do evento `message.persisted` do
 * inbound (commitado na MESMA transação da mensagem em
 * `persistInboundAtomically`).
 *
 * Garantias:
 *  - o webhook não espera a IA: aqui roda fora do caminho síncrono, sob lease;
 *  - dedup por invocação (`secretary_invocations`, chave `inbound:<messageId>`):
 *    replay/crash não reexecutam a IA quando `completed`;
 *  - resposta ao contato SEMPRE pelo caminho idempotente C05
 *    (`sendOutboundMessage`, chave `secretary-reply:<externalMessageId>`), então
 *    crash/duplicata não duplicam a mensagem enviada;
 *  - estado `pending/processing/completed/failed/unknown` registrado e
 *    observável (causa/erro/código); `unknown` aguarda reconciliação explícita;
 *  - handoff humano/estado antigo cancelam resposta tardia;
 *  - nenhum log aqui carrega conteúdo/telefone (PII).
 */

export const SECRETARY_INVOKE_EFFECT = 'secretary:invoke';
export const SECRETARY_REPLY_KEY_PREFIX = 'secretary-reply:';

/**
 * Erro classificável da invocação: `permanent` vai direto para DLQ (sem
 * consumir orçamento); `ambiguous` registra `unknown` (provider sem
 * confirmação) em vez de `failed`.
 */
export class InboundSecretaryInvocationError extends Error {
  readonly errorCode: string;
  readonly permanent: boolean;
  readonly ambiguous: boolean;

  constructor(
    message: string,
    errorCode: string,
    options: { permanent?: boolean; ambiguous?: boolean } = {},
  ) {
    super(message);
    this.name = 'InboundSecretaryInvocationError';
    this.errorCode = errorCode;
    this.permanent = options.permanent ?? false;
    this.ambiguous = options.ambiguous ?? false;
    Object.setPrototypeOf(this, InboundSecretaryInvocationError.prototype);
  }
}

export interface ExecuteInboundSecretaryInvocationInput {
  /** Evento de outbox que causou a execução (lease/fencing/dedup). */
  eventId: string;
  correlationId?: string;
  conversationId: string;
  messageId: string;
  consumerId?: string;
}

export interface ExecuteInboundSecretaryInvocationOutput {
  effectType: string;
  invocationId: string;
  invocationKey: string;
  status: 'completed' | 'skipped' | 'unknown' | 'processing' | 'denied';
  deduplicated: boolean;
  outboundMessageId?: string;
  handoffTriggered?: boolean;
}

function invocationKeyFor(messageId: string): string {
  return `inbound:${messageId}`;
}

function instanceFromMetadata(metadata: string | null): string | undefined {
  if (!metadata) return undefined;
  try {
    const parsed = JSON.parse(metadata) as { instance?: unknown };
    return typeof parsed?.instance === 'string' && parsed.instance.trim() ? parsed.instance : undefined;
  } catch {
    return undefined;
  }
}

/** Código estável de um AppError para estado/DLQ (nunca inclui payload). */
function errorCodeOf(error: unknown): string {
  if (error instanceof InboundSecretaryInvocationError) return error.errorCode;
  if (error instanceof AppError) return error.code;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string') return code;
  return 'SECRETARY_INVOCATION_ERROR';
}

/** Timeout/5xx/rede: a IA pode ter processado — resultado ambíguo. */
function isAmbiguousSecretaryError(error: unknown): boolean {
  if (error instanceof AppError) {
    return (
      error.code === 'SECRETARY_TIMEOUT'
      || error.code === 'SECRETARY_ERROR'
      || error.statusCode >= 500
    );
  }
  return false;
}

/**
 * Existe mensagem inbound MAIS NOVA na conversa? A invocação é de um estado
 * antigo: a resposta tardia seria indevida e é cancelada (AC3).
 *
 * A comparação é feita pelo BANCO (`(created_at, id) > (SELECT ...)`), usando
 * o valor íntegro de `created_at` — comparar com o Date do JS truncaria
 * microssegundos e a própria mensagem pareceria "mais nova" que si mesma.
 */
async function isSuperseded(message: Message): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT m.id FROM messages m
     WHERE m.conversation_id = ${message.conversationId}
       AND m.direction = 'inbound'
       AND (m.created_at, m.id) > (
         SELECT m2.created_at, m2.id FROM messages m2 WHERE m2.id = ${message.id}::uuid
       )
     LIMIT 1
  `);
  const rows = (result as unknown as { rows: Array<{ id: string }> }).rows ?? [];
  return rows.length > 0;
}

function classifyInvocationStateError(error: unknown): { errorCode: string; ambiguous: boolean } {
  const errorCode = errorCodeOf(error);
  const ambiguous = isAmbiguousSecretaryError(error)
    || errorCode === 'OUTBOUND_UNKNOWN'
    || errorCode === 'OUTBOUND_AMBIGUOUS';
  return { errorCode, ambiguous };
}

/** PROD-13/AC1 — bloqueio de orçamento durável da conversa (403 tipado). */
function isBudgetExhausted(error: unknown): boolean {
  return error instanceof AIBudgetExhaustedError
    || (error as { errorCode?: unknown } | null)?.errorCode === 'AI_BUDGET_EXHAUSTED';
}

/**
 * Executa UMA invocação assíncrona para a mensagem inbound. O chamador é o
 * handler do worker: qualquer falha NÃO permanente relançada vira retry/backoff
 * e DLQ durável (C04); `Err` nunca é engolido.
 */
export async function executeInboundSecretaryInvocation(
  input: ExecuteInboundSecretaryInvocationInput,
): Promise<ExecuteInboundSecretaryInvocationOutput> {
  const invocationKey = invocationKeyFor(input.messageId);
  const base = { effectType: SECRETARY_INVOKE_EFFECT, invocationId: invocationKey, invocationKey };

  const message = await messageRepository.findById(input.messageId);
  if (!message) {
    throw new InboundSecretaryInvocationError(
      `Mensagem ${input.messageId} não encontrada para invocação`,
      'MESSAGE_NOT_FOUND',
      { permanent: true },
    );
  }
  if (message.direction !== 'inbound') {
    throw new InboundSecretaryInvocationError(
      `Mensagem ${input.messageId} não é inbound`,
      'MESSAGE_NOT_INBOUND',
      { permanent: true },
    );
  }

  const conversation = await conversationRepository.findById(input.conversationId);
  if (!conversation || conversation.id !== message.conversationId) {
    throw new InboundSecretaryInvocationError(
      `Conversa ${input.conversationId} incompatível com a mensagem ${input.messageId}`,
      'CONVERSATION_MISMATCH',
      { permanent: true },
    );
  }

  // PROD-13/AC1 — admissão sob orçamento DURÁVEL por conversa. No limite, a
  // tentativa vira `denied` terminal (auditável em `secretary_invocations`,
  // sem PII) e a mensagem NÃO chama a IA — resposta tardia não vence o humano.
  let begun: BeginSecretaryInvocationResult;
  try {
    begun = await beginSecretaryInvocation({
      invocationKey,
      conversationId: conversation.id,
      messageId: message.id,
      eventId: input.eventId,
      consumerId: input.consumerId ?? 'worker',
      action: 'classify',
      maxInvocations: getAIBudgetLimits().maxInvocationsPerConversation,
    });
  } catch (error) {
    if (isBudgetExhausted(error)) {
      return { ...base, status: 'denied', deduplicated: false };
    }
    throw error;
  }
  const { record, alreadyCompleted } = begun;

  if (alreadyCompleted) {
    // Efeito já aplicado em tentativa anterior (crash pós-efeito/duplicata):
    // NÃO chama a IA de novo e NÃO reenvia — devolve o resultado ancorado.
    return {
      ...base,
      status: 'completed',
      deduplicated: true,
      outboundMessageId: record.resultRef ?? undefined,
    };
  }

  if (begun.outcome === 'unknown') {
    // Resultado ambíguo exige reconciliação explícita; uma redelivery não pode
    // disparar nova IA sem confirmação do provider.
    return {
      ...base,
      status: 'unknown',
      deduplicated: true,
      outboundMessageId: record.resultRef ?? undefined,
    };
  }

  if (begun.outcome === 'in_progress') {
    // Outro executor ainda possui a tentativa. ACK da intenção duplicada não
    // inicia um segundo efeito externo.
    return {
      ...base,
      status: 'processing',
      deduplicated: true,
      outboundMessageId: record.resultRef ?? undefined,
    };
  }

  // AC3 — estado humano/antigo cancela a invocação antes de qualquer IA.
  if (!conversation.isActive || conversation.currentHandler !== 'bot') {
    const skipped = !conversation.isActive ? 'conversation_inactive' : 'handler_not_bot';
    await completeSecretaryInvocation(invocationKey, { detail: { skipped }, expectedAttemptCount: record.attemptCount });
    return { ...base, status: 'skipped', deduplicated: false };
  }
  if (await isSuperseded(message)) {
    await completeSecretaryInvocation(invocationKey, {
      detail: { skipped: 'superseded_by_newer_inbound' },
      expectedAttemptCount: record.attemptCount,
    });
    return { ...base, status: 'skipped', deduplicated: false };
  }

  const secretaryResult = await processMessageWithSecretary({
    conversationId: conversation.id,
    messageId: message.id,
    content: message.content,
    sender: message.sender ?? '',
    invocationId: invocationKey,
  });

  if (secretaryResult.isErr()) {
    const error = secretaryResult.error;
    const { errorCode, ambiguous } = classifyInvocationStateError(error);
    await failSecretaryInvocation(invocationKey, {
      error: error.message,
      errorCode,
      ambiguous,
      detail: { ambiguous },
      expectedAttemptCount: record.attemptCount,
    });
    if (ambiguous) {
      // O recibo já é terminal/unknown. Reconhecer o evento evita retry cego;
      // a reconciliação do provider continua sendo uma ação explícita.
      return { ...base, status: 'unknown', deduplicated: false };
    }
    // Falha não ambígua: o worker decide retry/backoff/DLQ pela classificação.
    throw error;
  }

  const output = secretaryResult.value;

  if (output.handoffTriggered) {
    await conversationRepository.updateCurrentHandler(conversation.id, 'human');
    await completeSecretaryInvocation(invocationKey, {
      detail: { handoffTriggered: true, classification: output.classification ?? null },
      expectedAttemptCount: record.attemptCount,
    });
    return { ...base, status: 'completed', deduplicated: false, handoffTriggered: true };
  }

  const response = output.secretaryResponse?.trim();
  if (!response) {
    await completeSecretaryInvocation(invocationKey, {
      detail: { noResponse: true, classification: output.classification ?? null },
      expectedAttemptCount: record.attemptCount,
    });
    return { ...base, status: 'completed', deduplicated: false };
  }

  // Revalida o estado IMEDIATAMENTE antes de enviar: handoff humano ou uma
  // mensagem mais nova tornam esta resposta tardia/indevida.
  const latestConversation = await conversationRepository.findById(conversation.id);
  if (
    !latestConversation
    || !latestConversation.isActive
    || latestConversation.currentHandler !== 'bot'
    || await isSuperseded(message)
  ) {
    await completeSecretaryInvocation(invocationKey, {
      detail: { skipped: 'late_reply_cancelled' },
      expectedAttemptCount: record.attemptCount,
    });
    return { ...base, status: 'skipped', deduplicated: false };
  }

  const instance = instanceFromMetadata(message.metadata) || process.env.EVOLUTION_INSTANCE || 'cvg-local';
  const outbound = await sendOutboundMessage({
    conversationId: conversation.id,
    content: response,
    recipient: message.sender ?? undefined,
    sender: 'agent-secretary',
    senderType: 'bot',
    instance,
    idempotencyKey: `${SECRETARY_REPLY_KEY_PREFIX}${message.externalMessageId ?? message.id}`,
    metadata: {
      source: 'agent-secretary',
      replyToMessageId: message.id,
      instance,
      secretaryInvocationId: invocationKey,
    },
  });

  if (outbound.isErr()) {
    const error = outbound.error;
    const { errorCode, ambiguous } = classifyInvocationStateError(error);
    await failSecretaryInvocation(invocationKey, {
      error: error.message,
      errorCode,
      ambiguous,
      detail: { stage: 'outbound', ambiguous },
      expectedAttemptCount: record.attemptCount,
    });
    if (ambiguous) {
      // O recibo já registra a incerteza; reconhecer o evento evita uma nova
      // entrega do worker, além de não repetir o efeito externo.
      return { ...base, status: 'unknown', deduplicated: false };
    }
    throw error;
  }

  const delivery = outbound.value;

  if (delivery.outcome === 'unknown_reconciling') {
    // C05: o provider pode ter aceito; sem reenvio cego. O estado fica
    // `unknown` e a reconciliação explícita (dona da intenção) resolve.
    await markSecretaryInvocationUnknown(invocationKey, {
      resultRef: delivery.messageId,
      error: 'outbound ambíguo (unknown_reconciling)',
      errorCode: 'OUTBOUND_UNKNOWN',
      detail: { outboundOutcome: delivery.outcome, deduplicated: delivery.deduplicated },
      expectedAttemptCount: record.attemptCount,
    });
    return {
      ...base,
      status: 'unknown',
      deduplicated: delivery.deduplicated,
      outboundMessageId: delivery.messageId,
    };
  }

  if (delivery.outcome === 'failed') {
    const error = new InboundSecretaryInvocationError(
      'Provider rejeitou explicitamente a resposta da IA (outcome=failed)',
      'OUTBOUND_REJECTED',
      { permanent: true },
    );
    await failSecretaryInvocation(invocationKey, {
      error: error.message,
      errorCode: error.errorCode,
      detail: { stage: 'outbound', outboundOutcome: delivery.outcome },
      expectedAttemptCount: record.attemptCount,
    });
    throw error;
  }

  await completeSecretaryInvocation(invocationKey, {
    resultRef: delivery.messageId,
    detail: { outboundOutcome: delivery.outcome, deduplicated: delivery.deduplicated },
    expectedAttemptCount: record.attemptCount,
  });

  return {
    ...base,
    status: 'completed',
    deduplicated: delivery.deduplicated,
    outboundMessageId: delivery.messageId,
  };
}

/** Exposto para testes/observação sem reexecutar a invocação. */
export function secretaryInvocationKeyFor(messageId: string): string {
  return invocationKeyFor(messageId);
}

export type { SecretaryInvocationRecord };
