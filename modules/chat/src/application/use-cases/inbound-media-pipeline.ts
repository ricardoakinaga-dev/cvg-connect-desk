import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, getPool } from '@cvg/database';
import { mediaAssetRepository, processInboundMedia, type PipelineBlockReason } from '@cvg/media';
import {
  mediaRecoveryClaimsTotal,
  mediaRecoveryInFlight,
  mediaRecoveryOutcomesTotal,
  safeFilename,
  validateMedia,
} from '@cvg/shared';
import { messageRepository, type Message } from '../../infrastructure/repositories/message.repository';

/**
 * PROD-14/BE16 — pipeline de mídia inbound conectado ao fluxo de webhook.
 *
 * O webhook persiste a mensagem IMEDIATAMENTE (nunca bloqueia no fetch/scan) e
 * agenda o processamento assíncrono; a URL bruta recebida do provider NUNCA é
 * persistida em `messages.media_url` — o estado vive em `metadata.mediaIntake`
 * (server-side) até o veredito. Somente CLEAN+STORED vira `asset://<id>`.
 */

export type InboundMediaState =
  | 'PENDING_SCAN'
  | 'CLEAN'
  | 'INFECTED'
  | 'SCAN_FAILED'
  | 'REJECTED'
  | 'FAILED'
  | 'PIPELINE_DISABLED';

export type InboundMediaReasonCode =
  | PipelineBlockReason
  | 'unsafe_url'
  | 'pipeline_disabled'
  | 'asset_unavailable'
  | 'awaiting_revalidation';

export interface InboundMediaIntake {
  state: InboundMediaState;
  mediaType?: string;
  mimetype?: string;
  filename?: string;
  /** URL de origem do provider — server-side, removida quando não há retry possível. */
  sourceUrl?: string;
  /** Referência legada preservada (ex.: `asset://` quebrado) após neutralizar `media_url`. */
  legacyRef?: string;
  assetId?: string;
  sha256?: string;
  scanStatus?: string;
  storageStatus?: string;
  reasonCode?: InboundMediaReasonCode;
  reason?: string;
  updatedAt: string;
}

export interface InboundMediaTaskInput {
  messageId: string;
  conversationId: string;
  sourceUrl: string;
  mediaType?: string;
  mimetype?: string;
  filename?: string;
}

export interface InboundMediaOutcome {
  messageId: string;
  state: InboundMediaState;
  assetId?: string;
  storageStatus?: string;
  scanStatus?: string;
  reasonCode?: InboundMediaReasonCode;
  reason?: string;
}

export interface InboundMediaIntakeMetadata {
  mediaIntake?: InboundMediaIntake;
  [key: string]: unknown;
}

/**
 * Flag de configuração REAL do pipeline (compose/staging). Default SEGURO:
 * somente `false|0|no|off` desligam; ausente/qualquer outro valor processa —
 * e o processamento é fail-closed por si (sem scanner nunca entrega).
 */
export function isInboundMediaPipelineEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.MEDIA_PIPELINE_ENABLED ?? '').trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') return false;
  return true;
}

export function parseIntakeMetadata(metadata: string | null | undefined): InboundMediaIntakeMetadata {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return parsed && typeof parsed === 'object' ? { ...(parsed as InboundMediaIntakeMetadata) } : {};
  } catch {
    return {};
  }
}

function intakeFor(
  input: InboundMediaTaskInput,
  state: InboundMediaState,
  now = new Date().toISOString(),
): InboundMediaIntake {
  return {
    state,
    mediaType: input.mediaType,
    mimetype: input.mimetype,
    filename: input.filename ? safeFilename(input.filename) : undefined,
    sourceUrl: input.sourceUrl,
    updatedAt: now,
  };
}

async function writeIntake(
  message: Message,
  intake: InboundMediaIntake,
  media?: {
    mediaUrl?: string | null;
    mediaType?: string;
    mediaMimetype?: string;
    mediaFilename?: string;
  },
): Promise<void> {
  const parsed = parseIntakeMetadata(message.metadata);
  parsed.mediaIntake = intake;
  await messageRepository.update(message.id, {
    metadata: JSON.stringify(parsed),
    ...(media && Object.prototype.hasOwnProperty.call(media, 'mediaUrl') ? { mediaUrl: media.mediaUrl } : {}),
    ...(media?.mediaType ? { mediaType: media.mediaType } : {}),
    ...(media?.mediaMimetype ? { mediaMimetype: media.mediaMimetype } : {}),
    ...(media?.mediaFilename ? { mediaFilename: media.mediaFilename } : {}),
  });
}

/**
 * Lock de sessão por mensagem (idempotência entre tentativas concorrentes e
 * entre processos). O lock é liberado no `finally` e, em crash, quando a
 * conexão dedicada é fechada — jamais fica preso.
 */
async function withMessageLock<T>(messageId: string, fn: () => Promise<T>): Promise<T> {
  const lockKey = `inbound-media:${messageId}`;
  const client = await getPool().connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockKey]);
    return await fn();
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]).catch(() => undefined);
    client.release();
  }
}

function terminalState(scanStatus: string): InboundMediaState {
  if (scanStatus === 'CLEAN') return 'CLEAN';
  if (scanStatus === 'INFECTED') return 'INFECTED';
  if (scanStatus === 'SCAN_FAILED') return 'SCAN_FAILED';
  return 'PENDING_SCAN';
}

function outcomeFromStore(
  input: InboundMediaTaskInput,
  intake: InboundMediaIntake,
): InboundMediaOutcome {
  return {
    messageId: input.messageId,
    state: intake.state,
    assetId: intake.assetId,
    storageStatus: intake.storageStatus,
    scanStatus: intake.scanStatus,
    reasonCode: intake.reasonCode,
  };
}

async function runInboundMediaTask(input: InboundMediaTaskInput): Promise<InboundMediaOutcome> {
  return withMessageLock(input.messageId, async () => {
    const message = await messageRepository.findById(input.messageId);
    if (!message) {
      return { messageId: input.messageId, state: 'FAILED', reasonCode: 'fetch_failed' };
    }

    // Idempotência: terminal já publicado ou asset terminal já persistido.
    if (message.mediaUrl?.startsWith('asset://')) {
      return { messageId: input.messageId, state: 'CLEAN', assetId: message.mediaUrl.slice('asset://'.length) };
    }
    const existingAssets = await mediaAssetRepository.findByMessageId(input.messageId);
    const terminal = existingAssets.find((asset) => asset.scanStatus === 'CLEAN' || asset.scanStatus === 'INFECTED');
    if (terminal) {
      const intake: InboundMediaIntake = {
        ...intakeFor(input, terminalState(terminal.scanStatus), new Date().toISOString()),
        assetId: terminal.id,
        sha256: terminal.sha256 ?? undefined,
        scanStatus: terminal.scanStatus,
        storageStatus: terminal.storageStatus,
      };
      if (terminal.scanStatus === 'CLEAN' && terminal.storageStatus === 'STORED') {
        intake.sourceUrl = undefined;
        await writeIntake(message, intake, {
          mediaUrl: `asset://${terminal.id}`,
          mediaType: input.mediaType,
          mediaMimetype: terminal.mimeType ?? input.mimetype,
          mediaFilename: terminal.filename ?? input.filename,
        });
      } else {
        await writeIntake(message, intake);
      }
      return outcomeFromStore(input, intake);
    }

    const result = await processInboundMedia({
      messageId: input.messageId,
      conversationId: input.conversationId,
      actorId: input.messageId,
      mediaType: input.mediaType,
      mimetype: input.mimetype,
      filename: input.filename,
      url: input.sourceUrl,
      fetchRemote: true,
    });

    const intake: InboundMediaIntake = {
      ...intakeFor(input, 'PENDING_SCAN'),
      assetId: result.assetId || undefined,
      sha256: result.sha256,
      scanStatus: result.scanStatus,
      storageStatus: result.storageStatus,
      reasonCode: result.reasonCode,
      reason: result.reason,
    };

    if (result.storageStatus === 'STORED' && result.scanStatus === 'CLEAN' && result.assetId) {
      intake.state = 'CLEAN';
      intake.sourceUrl = undefined;
      intake.mimetype = result.mimetype ?? input.mimetype;
      await writeIntake(message, intake, {
        mediaUrl: `asset://${result.assetId}`,
        mediaType: input.mediaType,
        mediaMimetype: result.mimetype ?? input.mimetype,
        mediaFilename: input.filename,
      });
      return outcomeFromStore(input, intake);
    }

    // Sem bytes persistidos não há asset/retry: estados permanentes.
    if (!result.assetId) {
      const permanent = result.reasonCode !== 'fetch_failed' && result.reasonCode !== 'storage_unavailable';
      intake.state = permanent ? 'REJECTED' : 'FAILED';
      if (permanent) intake.sourceUrl = undefined;
      await writeIntake(message, intake);
      return outcomeFromStore(input, intake);
    }

    // Bytes preservados em quarentena: FAILED permite retry, PENDING/SCAN_FAILED idem.
    intake.state = result.scanStatus === 'INFECTED' ? 'INFECTED' : result.scanStatus === 'SCAN_FAILED' ? 'SCAN_FAILED' : 'PENDING_SCAN';
    await writeIntake(message, intake);
    return outcomeFromStore(input, intake);
  });
}

const inflight = new Map<string, Promise<InboundMediaOutcome>>();
const recoveryInflight = new Map<string, Promise<void>>();

/**
 * Agenda o processamento assíncrono (o webhook responde sem esperar fetch/scan).
 * Reentrância para a MESMA mensagem compartilha a tarefa em andamento.
 */
export function enqueueInboundMediaProcessing(input: InboundMediaTaskInput): Promise<InboundMediaOutcome> {
  const current = inflight.get(input.messageId);
  if (current) return current;

  if (!isInboundMediaPipelineEnabled()) {
    const disabled: InboundMediaOutcome = {
      messageId: input.messageId,
      state: 'PIPELINE_DISABLED',
      reasonCode: 'pipeline_disabled',
    };
    const task = (async () => {
      const message = await messageRepository.findById(input.messageId);
      if (message) {
        const intake = intakeFor(input, 'PIPELINE_DISABLED');
        intake.reasonCode = 'pipeline_disabled';
        intake.reason = 'MEDIA_PIPELINE_ENABLED=false: mídia nunca referenciada como pública';
        await writeIntake(message, intake, { mediaUrl: null });
      }
      return disabled;
    })().finally(() => inflight.delete(input.messageId));
    inflight.set(input.messageId, task);
    return task;
  }

  const task = runInboundMediaTask(input)
    .catch(async (error): Promise<InboundMediaOutcome> => {
      const reason = error instanceof Error ? error.message : String(error);
      // Falha inesperada também precisa deixar um intake recuperável. Sem esta
      // escrita, um crash lógico poderia preservar apenas o PENDING inicial.
      try {
        const message = await messageRepository.findById(input.messageId);
        if (message) {
          await writeIntake(message, {
            ...intakeFor(input, 'FAILED'),
            reasonCode: 'fetch_failed',
            reason,
          }, { mediaUrl: null });
        }
      } catch {
        // A próxima tentativa do recovery usa o lease expirado; não mascara a
        // falha original nem publica uma referência insegura.
      }
      return {
        messageId: input.messageId,
        state: 'FAILED',
        reasonCode: 'fetch_failed',
        reason,
      };
    })
    .finally(() => inflight.delete(input.messageId));
  inflight.set(input.messageId, task);
  return task;
}

/**
 * Drena tarefas em andamento (testes determinísticos e shutdown gracioso).
 */
export async function waitForInboundMediaProcessing(messageId?: string, timeoutMs = 30_000): Promise<void> {
  const tasks: Array<Promise<unknown>> = [];
  if (messageId) {
    const task = inflight.get(messageId);
    if (task) tasks.push(task);
    const recoveryTask = recoveryInflight.get(messageId);
    if (recoveryTask) tasks.push(recoveryTask);
  } else {
    tasks.push(...inflight.values(), ...recoveryInflight.values());
  }
  if (tasks.length === 0) return;
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.allSettled(tasks),
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function inFlightInboundMediaCount(): number {
  return inflight.size;
}

export interface MediaRecoveryOptions {
  messageId?: string;
  owner?: string;
  leaseSeconds?: number;
  maxAttempts?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

interface MediaRecoveryClaim {
  messageId: string;
  conversationId: string;
  mediaType?: string;
  mimetype?: string;
  metadata: string | null;
  attemptCount: number;
}

function positiveEnvInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function recoveryOptions(options: MediaRecoveryOptions = {}) {
  return {
    messageId: options.messageId,
    owner: options.owner || process.env.MEDIA_RECOVERY_OWNER || `media-recovery-${process.pid}`,
    leaseSeconds: options.leaseSeconds ?? positiveEnvInt('MEDIA_RECOVERY_LEASE_SECONDS', 120),
    maxAttempts: options.maxAttempts ?? positiveEnvInt('MEDIA_RECOVERY_MAX_ATTEMPTS', 8),
    backoffBaseMs: options.backoffBaseMs ?? positiveEnvInt('MEDIA_RECOVERY_BACKOFF_BASE_MS', 1_000),
    backoffMaxMs: options.backoffMaxMs ?? positiveEnvInt('MEDIA_RECOVERY_BACKOFF_MAX_MS', 300_000),
  };
}

function recoveryBackoffMs(attemptCount: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * (2 ** Math.max(0, attemptCount - 1)));
}

function isRecoveryTerminal(outcome: InboundMediaOutcome): boolean {
  return outcome.state === 'CLEAN'
    || outcome.state === 'INFECTED'
    || outcome.state === 'REJECTED'
    || outcome.state === 'PIPELINE_DISABLED';
}

async function claimPendingInboundMedia(limit: number, options: ReturnType<typeof recoveryOptions>): Promise<MediaRecoveryClaim[]> {
  const messageScope = options.messageId ? sql`AND m.id = ${options.messageId}` : sql``;
  const result = await db.execute(sql`
    WITH candidates AS (
      SELECT m.id
        FROM messages m
       WHERE m.direction = 'inbound'
         AND m.media_url IS NULL
         AND m.metadata LIKE '%"mediaIntake"%'
         AND (
           m.metadata LIKE '%"state":"PENDING_SCAN"%'
           OR m.metadata LIKE '%"state":"SCAN_FAILED"%'
           OR m.metadata LIKE '%"state":"FAILED"%'
         )
         ${messageScope}
         AND m.media_intake_attempt_count < ${options.maxAttempts}
         AND (m.media_intake_next_attempt_at IS NULL OR m.media_intake_next_attempt_at <= NOW())
         AND (m.media_intake_lease_until IS NULL OR m.media_intake_lease_until <= NOW())
       ORDER BY COALESCE(m.media_intake_next_attempt_at, m.created_at), m.created_at, m.id
       LIMIT ${limit}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE messages m
       SET media_intake_attempt_count = m.media_intake_attempt_count + 1,
           media_intake_lease_owner = ${options.owner},
           media_intake_lease_until = NOW() + (${options.leaseSeconds} * INTERVAL '1 second')
      FROM candidates c
     WHERE m.id = c.id
     RETURNING m.id, m.conversation_id, m.media_type, m.media_mimetype, m.metadata,
               m.media_intake_attempt_count
  `);
  const rows = ((result as unknown as { rows: Array<Record<string, unknown>> }).rows ?? []);
  return rows.map((row) => ({
    messageId: String(row.id),
    conversationId: String(row.conversation_id),
    mediaType: (row.media_type as string | null) ?? undefined,
    mimetype: (row.media_mimetype as string | null) ?? undefined,
    metadata: (row.metadata as string | null) ?? null,
    attemptCount: Number(row.media_intake_attempt_count),
  }));
}

async function finishMediaRecoveryClaim(
  claim: MediaRecoveryClaim,
  outcome: InboundMediaOutcome,
  options: ReturnType<typeof recoveryOptions>,
): Promise<void> {
  const exhausted = !isRecoveryTerminal(outcome) && claim.attemptCount >= options.maxAttempts;
  const nextAttemptAt = exhausted
    ? null
    : isRecoveryTerminal(outcome)
      ? null
      : new Date(Date.now() + recoveryBackoffMs(claim.attemptCount, options.backoffBaseMs, options.backoffMaxMs));
  const lastError = isRecoveryTerminal(outcome)
    ? null
    : exhausted
      ? `retry_exhausted:${outcome.reasonCode || outcome.state}`
      : outcome.reasonCode || outcome.state;

  const result = await db.execute(sql`
    UPDATE messages
       SET media_intake_lease_owner = NULL,
           media_intake_lease_until = NULL,
           media_intake_next_attempt_at = ${nextAttemptAt},
           media_intake_last_error = ${lastError}
     WHERE id = ${claim.messageId}
       AND media_intake_lease_owner = ${options.owner}
  `);
  const rowCount = (result as unknown as { rowCount?: number | null }).rowCount ?? 0;
  if (rowCount === 0) return; // Lease fenced by a newer recovery owner.

  mediaRecoveryOutcomesTotal.inc({ state: exhausted ? 'RETRY_EXHAUSTED' : outcome.state });
}

/**
 * Recuperação pós-crash: reclama de forma atômica mensagens cujo intake ficou
 * retentável e agenda o mesmo pipeline. Lease, backoff e limite vivem no
 * banco, então reinício ou outra réplica não perde o trabalho nem duplica o
 * asset. SCAN_FAILED é retentável; INFECTED/CLEAN nunca são reabertos.
 */
export async function recoverPendingInboundMedia(limit = 50, inputOptions: MediaRecoveryOptions = {}): Promise<number> {
  if (!isInboundMediaPipelineEnabled()) return 0;
  const boundedLimit = Number.isFinite(limit) && limit > 0
    ? Math.max(1, Math.min(500, Math.trunc(limit)))
    : 1;
  const baseOptions = recoveryOptions(inputOptions);
  // Token por lote impede que uma tarefa antiga finalize uma nova claim caso
  // o lease expire durante um scanner lento e o mesmo worker seja reentrante.
  const options = { ...baseOptions, owner: `${baseOptions.owner}:${randomUUID()}` };
  const claims = await claimPendingInboundMedia(boundedLimit, options);
  for (const claim of claims) {
    mediaRecoveryClaimsTotal.inc();
    const parsed = parseIntakeMetadata(claim.metadata);
    const sourceUrl = parsed.mediaIntake?.sourceUrl;
    if (!sourceUrl) {
      const missingSource: InboundMediaOutcome = {
        messageId: claim.messageId,
        state: 'REJECTED',
        reasonCode: 'asset_unavailable',
      };
      const message = await messageRepository.findById(claim.messageId);
      if (message) {
        const intake: InboundMediaIntake = {
          ...(parsed.mediaIntake ?? {
            state: 'REJECTED',
            updatedAt: new Date().toISOString(),
          }),
          state: 'REJECTED',
          sourceUrl: undefined,
          reasonCode: 'asset_unavailable',
          reason: 'Intake retentável sem URL de origem; descartado sem publicação',
          updatedAt: new Date().toISOString(),
        };
        await writeIntake(message, intake, { mediaUrl: null });
      }
      await finishMediaRecoveryClaim(claim, missingSource, options);
      continue;
    }

    mediaRecoveryInFlight.inc();
    const task = enqueueInboundMediaProcessing({
      messageId: claim.messageId,
      conversationId: claim.conversationId,
      sourceUrl,
      mediaType: claim.mediaType ?? parsed.mediaIntake?.mediaType,
      mimetype: claim.mimetype ?? parsed.mediaIntake?.mimetype,
      filename: parsed.mediaIntake?.filename,
    });
    const completion = task.then(
      (outcome) => finishMediaRecoveryClaim(claim, outcome, options),
      async (error) => {
        const failed: InboundMediaOutcome = {
          messageId: claim.messageId,
          state: 'FAILED',
          reasonCode: 'fetch_failed',
          ...(error instanceof Error ? { reason: error.message } : {}),
        };
        await finishMediaRecoveryClaim(claim, failed, options);
      },
    ).finally(() => {
      mediaRecoveryInFlight.dec();
    });
    recoveryInflight.set(claim.messageId, completion);
    void completion.then(
      () => undefined,
      () => undefined,
    ).finally(() => {
      if (recoveryInflight.get(claim.messageId) === completion) recoveryInflight.delete(claim.messageId);
    });
  }
  return claims.length;
}

/** Validação de intake no recebimento (SSRF/limite/MIME) sem bloquear a mensagem. */
export function evaluateInboundMediaInput(input: {
  url?: string;
  mediaType?: string;
  mimetype?: string;
}): { ok: boolean; reasonCode?: InboundMediaReasonCode; reason?: string } {
  const validation = validateMedia({
    mediaType: input.mediaType,
    mimetype: input.mimetype,
    url: input.url,
  });
  if (!validation.ok) {
    return { ok: false, reasonCode: (validation.reason as InboundMediaReasonCode) ?? 'unsafe_url', reason: validation.message };
  }
  return { ok: true };
}
