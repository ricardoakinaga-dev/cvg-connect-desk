import { db, schema } from '@cvg/database';
import { eq, inArray } from 'drizzle-orm';
import { createAuditLog } from '@cvg/audit';
import { randomUUID } from 'node:crypto';
import {
  loadPrivacyPolicy,
  policyFor,
  wouldDelete,
  wouldPseudonymize,
  type PrivacyCopyType,
  type PrivacyPolicy,
} from './privacy-policy';
import { getPrivacyMediaStorage } from './media-copy-port';
import {
  intersectScopes,
  loadContactGraph,
  normalizeScope,
  sameScope,
  type InventoryScope,
  type ContactGraph,
} from './contact-graph';
import { anonymizedMarker, identifierList, redactText, textContainsAny } from './redaction';
import { scanResidualIdentifierList } from './residual-scan';
import { recordPrivacyRefusal } from './privacy-audit';

/**
 * AAA-17 / C07 — operação de pseudonimização/eliminação por cópia.
 *
 * Garantias (testadas em HTTP + PostgreSQL real):
 *   - D02 pendente ⇒ default `dry-run`: planeja, audita e NÃO muta nada;
 *   - idempotente por `requestId` (uma operação persistida por pedido);
 *   - retomável por checkpoint em `privacy_operations`;
 *   - passos idempotentes (redação por token não volta a casar);
 *   - resultado PARCIAL sempre que existir resíduo (backup, vínculo de outro
 *     titular, bytes de mídia sem flag irreversível) — nunca alega eliminação
 *     integral;
 *   - auditoria minimizada: ator, resultado, correlação, escopo e contagens.
 *
 * A ordem deixa `contact` por último (antes do backup) para que os
 * identificadores diretos sigam disponíveis à redação das demais cópias em um
 * resume — sem persistir PII fora das tabelas de origem.
 */

export const ERASURE_STEP_ORDER: readonly PrivacyCopyType[] = [
  'conversation',
  'message',
  'note',
  'outbox',
  'dlq',
  'media-asset',
  'audit',
  'tutor-link',
  'contact',
  'backup',
];

export type ErasureStepAction = 'planned' | 'pseudonymized' | 'deferred-d02' | 'residual';

export interface ErasureStepResult {
  copy: PrivacyCopyType;
  action: ErasureStepAction;
  affected: number;
  residual: string | null;
}

export interface ResidualScanSummary {
  checkedAt: string;
  hits: number;
  byCopy: Record<string, number>;
}

export interface ErasureReport {
  operationId: string;
  contactId: string;
  requestId: string;
  mode: 'dry-run' | 'execute';
  policyVersion: string;
  status: 'planned' | 'running' | 'partial' | 'completed' | 'failed';
  result: 'planned-dry-run' | 'partial-pseudonymization' | 'completed-pseudonymization' | 'failed';
  fullErasureClaimed: false;
  partial: boolean;
  checkpoint: number;
  mutatedCopies: number;
  steps: ErasureStepResult[];
  residuals: Array<{ copy: PrivacyCopyType; reason: string }>;
  /** Veredito do teste de reidentificação sobre as cópias do banco. */
  residualScan?: ResidualScanSummary;
  cancelled?: true;
  deduplicated?: boolean;
  resumedFrom?: number;
  resumedBy?: string;
}

export interface ErasureActor {
  userId: string;
  reason: string;
}

export interface RunErasureInput {
  contactId: string;
  actor: ErasureActor;
  scope?: InventoryScope;
  requestId?: string;
  dryRun?: boolean;
  /** Confirmação explícita para passos irreversíveis (bytes de mídia). */
  confirmIrreversible?: boolean;
  faultAfterStep?: PrivacyCopyType;
}

export type RunErasureFailureReason =
  | 'not_found'
  | 'out_of_scope'
  | 'not_resumable'
  | 'conflict'
  | 'confirmation_required';

export type RunErasureResult =
  | { ok: true; report: ErasureReport }
  | { ok: false; reason: RunErasureFailureReason };

/** Ator + escopo ATUAL revalidado na requisição (consulta/retomada/cancelamento). */
export interface OperationAccess {
  actorId: string;
  scope?: InventoryScope;
}

export interface ResumeErasureInput {
  operationId: string;
  actor: ErasureActor;
  scope?: InventoryScope;
  confirmIrreversible?: boolean;
}

export interface CancelErasureInput {
  operationId: string;
  actor: ErasureActor;
  scope?: InventoryScope;
}

export type GetOperationResult =
  | { ok: true; report: ErasureReport }
  | { ok: false; reason: 'not_found' | 'out_of_scope' };

export class PrivacyOperationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'PrivacyOperationError';
  }
}

interface StepOutcome {
  step: ErasureStepResult;
  residual?: { copy: PrivacyCopyType; reason: string };
}

interface ErasureContext {
  contactId: string;
  marker: string;
  identifiers: string[];
  inScopeConversationIds: string[];
  inScopeMessageIds: string[];
  inScopeNoteIds: string[];
  inScopeOutbox: Array<typeof schema.outboxEvents.$inferSelect>;
  inScopeDlq: Array<typeof schema.deadLetterEvents.$inferSelect>;
  inScopeMedia: Array<typeof schema.mediaAssets.$inferSelect>;
  inScopeAudit: Array<typeof schema.auditLogs.$inferSelect>;
  linkedTutorIds: string[];
  linkedPatientIds: string[];
}

function buildContext(graph: ContactGraph): ErasureContext {
  return {
    contactId: graph.contact.id,
    marker: anonymizedMarker(graph.contact.id),
    identifiers: identifierList({
      phone: graph.contact.phone ?? undefined,
      name: graph.contact.name ?? undefined,
      email: graph.contact.email ?? undefined,
      externalId: graph.contact.externalId ?? undefined,
    }),
    inScopeConversationIds: graph.inScopeConversationIds,
    inScopeMessageIds: graph.inScopeMessageIds,
    inScopeNoteIds: graph.inScopeNoteIds,
    inScopeOutbox: graph.inScopeOutbox,
    inScopeDlq: graph.inScopeDlq,
    inScopeMedia: graph.inScopeMedia,
    inScopeAudit: graph.inScopeAudit,
    linkedTutorIds: graph.linkedTutorIds,
    linkedPatientIds: graph.linkedPatientIds,
  };
}

function plainResult(
  copy: PrivacyCopyType,
  policy: PrivacyPolicy,
  counts: { planned: number; executed: () => Promise<number> },
): Promise<StepOutcome> {
  const matrix = policyFor(copy);
  if (!matrix.pseudonymizable) {
    return Promise.resolve({ step: { copy, action: 'residual', affected: 0, residual: null } });
  }
  if (policy.mode !== 'execute') {
    return Promise.resolve({ step: { copy, action: 'planned', affected: counts.planned, residual: null } });
  }
  if (!wouldPseudonymize(policy, copy)) {
    return Promise.resolve({ step: { copy, action: 'deferred-d02', affected: 0, residual: null } });
  }
  return counts.executed().then((affected) => ({
    step: { copy, action: 'pseudonymized' as const, affected, residual: null },
  }));
}

async function applyConversationStep(policy: PrivacyPolicy, ctx: ErasureContext): Promise<StepOutcome> {
  const rows = ctx.inScopeConversationIds.length > 0
    ? await db.select().from(schema.conversations).where(inArray(schema.conversations.id, ctx.inScopeConversationIds))
    : [];
  const candidates = rows.filter((row) => textContainsAny(row.metadata, ctx.identifiers));
  return plainResult('conversation', policy, {
    planned: candidates.length,
    executed: async () => {
      let affected = 0;
      await db.transaction(async (tx) => {
        for (const row of candidates) {
          const metadata = redactText(row.metadata, ctx.identifiers, ctx.marker);
          if (metadata !== row.metadata) {
            await tx.update(schema.conversations).set({ metadata }).where(eq(schema.conversations.id, row.id));
            affected += 1;
          }
        }
      });
      return affected;
    },
  });
}

async function applyMessageStep(policy: PrivacyPolicy, ctx: ErasureContext): Promise<StepOutcome> {
  const rows = ctx.inScopeMessageIds.length > 0
    ? await db.select().from(schema.messages).where(inArray(schema.messages.id, ctx.inScopeMessageIds))
    : [];
  const touches = (row: typeof schema.messages.$inferSelect) =>
    textContainsAny(row.content, ctx.identifiers)
    || textContainsAny(row.sender, ctx.identifiers)
    || textContainsAny(row.recipient, ctx.identifiers)
    || textContainsAny(row.metadata, ctx.identifiers)
    || textContainsAny(row.mediaFilename, ctx.identifiers);
  const candidates = rows.filter(touches);
  return plainResult('message', policy, {
    planned: candidates.length,
    executed: async () => {
      let affected = 0;
      await db.transaction(async (tx) => {
        for (const row of candidates) {
          const next = {
            content: redactText(row.content, ctx.identifiers, ctx.marker) ?? row.content,
            sender: redactText(row.sender, ctx.identifiers, ctx.marker),
            recipient: redactText(row.recipient, ctx.identifiers, ctx.marker),
            metadata: redactText(row.metadata, ctx.identifiers, ctx.marker),
            mediaFilename: redactText(row.mediaFilename, ctx.identifiers, ctx.marker),
          };
          await tx.update(schema.messages).set(next).where(eq(schema.messages.id, row.id));
          affected += 1;
        }
      });
      return affected;
    },
  });
}

async function applyNoteStep(policy: PrivacyPolicy, ctx: ErasureContext): Promise<StepOutcome> {
  const rows = ctx.inScopeNoteIds.length > 0
    ? await db.select().from(schema.internalNotes).where(inArray(schema.internalNotes.id, ctx.inScopeNoteIds))
    : [];
  const candidates = rows.filter(
    (row) => textContainsAny(row.content, ctx.identifiers) || textContainsAny(row.metadata, ctx.identifiers),
  );
  return plainResult('note', policy, {
    planned: candidates.length,
    executed: async () => {
      let affected = 0;
      await db.transaction(async (tx) => {
        for (const row of candidates) {
          const content = redactText(row.content, ctx.identifiers, ctx.marker) ?? row.content;
          const metadata = redactText(row.metadata, ctx.identifiers, ctx.marker);
          await tx.update(schema.internalNotes).set({ content, metadata }).where(eq(schema.internalNotes.id, row.id));
          affected += 1;
        }
      });
      return affected;
    },
  });
}

async function applyOutboxStep(policy: PrivacyPolicy, ctx: ErasureContext): Promise<StepOutcome> {
  const candidates = ctx.inScopeOutbox.filter(
    (row) => textContainsAny(row.payload, ctx.identifiers) || textContainsAny(row.metadata, ctx.identifiers),
  );
  return plainResult('outbox', policy, {
    planned: candidates.length,
    executed: async () => {
      let affected = 0;
      await db.transaction(async (tx) => {
        for (const row of candidates) {
          const payload = redactText(row.payload, ctx.identifiers, ctx.marker) ?? row.payload;
          const metadata = redactText(row.metadata, ctx.identifiers, ctx.marker);
          await tx.update(schema.outboxEvents).set({ payload, metadata }).where(eq(schema.outboxEvents.id, row.id));
          affected += 1;
        }
      });
      return affected;
    },
  });
}

async function applyDlqStep(policy: PrivacyPolicy, ctx: ErasureContext): Promise<StepOutcome> {
  const touches = (row: typeof schema.deadLetterEvents.$inferSelect) =>
    textContainsAny(JSON.stringify(row.payload), ctx.identifiers)
    || textContainsAny(row.errorMessage, ctx.identifiers);
  const candidates = ctx.inScopeDlq.filter(touches);
  return plainResult('dlq', policy, {
    planned: candidates.length,
    executed: async () => {
      let affected = 0;
      await db.transaction(async (tx) => {
        for (const row of candidates) {
          const raw = redactText(JSON.stringify(row.payload), ctx.identifiers, ctx.marker) ?? JSON.stringify(row.payload);
          let payload: unknown;
          try {
            payload = JSON.parse(raw);
          } catch {
            payload = { redacted: raw };
          }
          const errorMessage = redactText(row.errorMessage, ctx.identifiers, ctx.marker);
          await tx.update(schema.deadLetterEvents).set({ payload, errorMessage }).where(eq(schema.deadLetterEvents.id, row.id));
          affected += 1;
        }
      });
      return affected;
    },
  });
}

async function applyMediaStep(policy: PrivacyPolicy, ctx: ErasureContext): Promise<StepOutcome> {
  const matrix = policyFor('media-asset');
  const assets = ctx.inScopeMedia;
  const deleteBytes = wouldDelete(policy, 'media-asset');
  if (policy.mode !== 'execute') {
    return {
      step: { copy: 'media-asset', action: 'planned', affected: assets.length, residual: null },
    };
  }
  const approvedMetadata = matrix.pseudonymizable && wouldPseudonymize(policy, 'media-asset');
  if (!approvedMetadata && !deleteBytes) {
    return {
      step: { copy: 'media-asset', action: 'deferred-d02', affected: 0, residual: null },
      residual: assets.length > 0 ? { copy: 'media-asset', reason: 'object-bytes-retained' } : undefined,
    };
  }
  const port = getPrivacyMediaStorage();
  let affected = 0;
  let bytesRemaining = false;
  await db.transaction(async (tx) => {
    for (const asset of assets) {
      const filename = approvedMetadata
        ? redactText(asset.filename, ctx.identifiers, ctx.marker)
        : asset.filename;
      let storageStatus = asset.storageStatus;
      if (deleteBytes && asset.storageKey) {
        if (port) {
          await port.delete(asset.storageKey);
          storageStatus = 'DELETED';
        } else {
          bytesRemaining = true;
        }
      } else if (asset.storageKey && (asset.storageStatus === 'STORED' || asset.storageStatus === 'EXTERNAL')) {
        bytesRemaining = true;
      }
      const metadataChanged = filename !== asset.filename;
      const statusChanged = storageStatus !== asset.storageStatus;
      if (metadataChanged || statusChanged) {
        await tx.update(schema.mediaAssets).set({ filename, storageStatus }).where(eq(schema.mediaAssets.id, asset.id));
        affected += 1;
      }
    }
  });
  return {
    step: { copy: 'media-asset', action: 'pseudonymized', affected, residual: null },
    residual: bytesRemaining ? { copy: 'media-asset', reason: 'object-bytes-retained' } : undefined,
  };
}

async function applyAuditStep(policy: PrivacyPolicy, ctx: ErasureContext): Promise<StepOutcome> {
  const touches = (row: typeof schema.auditLogs.$inferSelect) =>
    textContainsAny(row.oldValue, ctx.identifiers)
    || textContainsAny(row.newValue, ctx.identifiers)
    || textContainsAny(row.metadata, ctx.identifiers);
  const candidates = ctx.inScopeAudit.filter(touches);
  return plainResult('audit', policy, {
    planned: candidates.length,
    executed: async () => {
      let affected = 0;
      await db.transaction(async (tx) => {
        for (const row of candidates) {
          await tx.update(schema.auditLogs).set({
            oldValue: redactText(row.oldValue, ctx.identifiers, ctx.marker),
            newValue: redactText(row.newValue, ctx.identifiers, ctx.marker),
            metadata: redactText(row.metadata, ctx.identifiers, ctx.marker),
          }).where(eq(schema.auditLogs.id, row.id));
          affected += 1;
        }
      });
      return affected;
    },
  });
}

async function applyTutorLinkStep(ctx: ErasureContext): Promise<StepOutcome> {
  const hasLinks = ctx.linkedTutorIds.length > 0 || ctx.linkedPatientIds.length > 0;
  return {
    step: { copy: 'tutor-link', action: 'residual', affected: 0, residual: null },
    residual: hasLinks ? { copy: 'tutor-link', reason: 'related-records-of-other-data-subject' } : undefined,
  };
}

async function applyContactStep(policy: PrivacyPolicy, ctx: ErasureContext): Promise<StepOutcome> {
  return plainResult('contact', policy, {
    planned: 1,
    executed: async () => {
      await db.update(schema.contacts).set({
        phone: ctx.marker,
        name: 'Titular anonimizado',
        email: null,
        externalId: null,
        metadata: null,
        updatedAt: new Date(),
      }).where(eq(schema.contacts.id, ctx.contactId));
      return 1;
    },
  });
}

function applyBackupStep(): StepOutcome {
  return {
    step: { copy: 'backup', action: 'residual', affected: 0, residual: null },
    residual: { copy: 'backup', reason: 'external-backup-not-rewritten' },
  };
}

async function applyStep(copy: PrivacyCopyType, policy: PrivacyPolicy, ctx: ErasureContext): Promise<StepOutcome> {
  switch (copy) {
    case 'conversation':
      return applyConversationStep(policy, ctx);
    case 'message':
      return applyMessageStep(policy, ctx);
    case 'note':
      return applyNoteStep(policy, ctx);
    case 'outbox':
      return applyOutboxStep(policy, ctx);
    case 'dlq':
      return applyDlqStep(policy, ctx);
    case 'media-asset':
      return applyMediaStep(policy, ctx);
    case 'audit':
      return applyAuditStep(policy, ctx);
    case 'tutor-link':
      return applyTutorLinkStep(ctx);
    case 'contact':
      return applyContactStep(policy, ctx);
    case 'backup':
      return applyBackupStep();
    default:
      return { step: { copy, action: 'residual', affected: 0, residual: null } };
  }
}

function finalizeReport(input: {
  operationId: string;
  contactId: string;
  requestId: string;
  mode: 'dry-run' | 'execute';
  policyVersion: string;
  steps: ErasureStepResult[];
  residuals: Array<{ copy: PrivacyCopyType; reason: string }>;
  residualScan?: ResidualScanSummary;
  resumedFrom?: number;
  resumedBy?: string;
  deduplicated?: boolean;
}): ErasureReport {
  const mutatedCopies = input.steps.filter((step) => step.action === 'pseudonymized').length;
  const dryRun = input.mode !== 'execute';
  const partial = dryRun || input.residuals.length > 0;
  const status: ErasureReport['status'] = dryRun ? 'planned' : partial ? 'partial' : 'completed';
  const result: ErasureReport['result'] = dryRun
    ? 'planned-dry-run'
    : partial
      ? 'partial-pseudonymization'
      : 'completed-pseudonymization';
  return {
    operationId: input.operationId,
    contactId: input.contactId,
    requestId: input.requestId,
    mode: input.mode,
    policyVersion: input.policyVersion,
    status,
    result,
    fullErasureClaimed: false,
    partial,
    checkpoint: input.steps.length,
    mutatedCopies,
    steps: input.steps,
    residuals: input.residuals,
    ...(input.residualScan ? { residualScan: input.residualScan } : {}),
    ...(input.resumedFrom !== undefined ? { resumedFrom: input.resumedFrom } : {}),
    ...(input.resumedBy ? { resumedBy: input.resumedBy } : {}),
    ...(input.deduplicated ? { deduplicated: true } : {}),
  };
}

function collectResiduals(step: ErasureStepResult, outcome: StepOutcome): Array<{ copy: PrivacyCopyType; reason: string }> {
  const residuals: Array<{ copy: PrivacyCopyType; reason: string }> = [];
  if (outcome.residual) residuals.push(outcome.residual);
  if (step.action === 'deferred-d02') residuals.push({ copy: step.copy, reason: 'awaiting-d02-approval' });
  return residuals;
}

/**
 * Passos irreversíveis planejados: exclusão de bytes de mídia no escopo. Só
 * pode ocorrer em `execute` com a cópia aprovada e a trava mestra ligada.
 */
function irreversiblePlanned(policy: PrivacyPolicy, graph: ContactGraph): boolean {
  if (!wouldDelete(policy, 'media-asset')) return false;
  return graph.inScopeMedia.some((asset) =>
    Boolean(asset.storageKey && (asset.storageStatus === 'STORED' || asset.storageStatus === 'EXTERNAL')));
}

function storedScope(row: typeof schema.privacyOperations.$inferSelect): Required<InventoryScope> {
  try {
    return normalizeScope(JSON.parse(row.scope || '{}') as InventoryScope);
  } catch {
    return normalizeScope(undefined);
  }
}

interface RequestBinding {
  contactId: string;
  actorId: string;
  mode: 'dry-run' | 'execute';
  scope: Required<InventoryScope>;
}

/**
 * Idempotência vinculada a ator+contato+modo+escopo: o MESMO requestId só
 * devolve o relatório quando o pedido é compatível; reuso divergente é
 * conflito (409) — nunca entrega relatório alheio.
 */
function bindingMatches(row: typeof schema.privacyOperations.$inferSelect, input: RequestBinding): boolean {
  return row.contactId === input.contactId
    && (row.actorId ?? '') === input.actorId
    && row.mode === input.mode
    && sameScope(storedScope(row), input.scope);
}

async function residualSummary(context: ErasureContext): Promise<ResidualScanSummary> {
  const hits = await scanResidualIdentifierList(context.contactId, context.identifiers);
  const byCopy: Record<string, number> = {};
  for (const hit of hits) {
    byCopy[hit.copy] = (byCopy[hit.copy] ?? 0) + 1;
  }
  return { checkedAt: new Date().toISOString(), hits: hits.length, byCopy };
}

async function persistOperation(
  operationId: string,
  report: ErasureReport,
  status: ErasureReport['status'],
  lastError?: string,
): Promise<void> {
  await db.update(schema.privacyOperations).set({
    status,
    report: JSON.stringify(report),
    steps: JSON.stringify(report.steps),
    checkpoint: report.checkpoint,
    lastError: lastError ?? null,
    updatedAt: new Date(),
    ...(status === 'completed' || status === 'partial' ? { completedAt: new Date() } : {}),
  }).where(eq(schema.privacyOperations.id, operationId));
}

async function findOperationByRequestId(requestId: string) {
  const [row] = await db
    .select()
    .from(schema.privacyOperations)
    .where(eq(schema.privacyOperations.requestId, requestId))
    .limit(1);
  return row ?? null;
}

function reportFromRow(row: typeof schema.privacyOperations.$inferSelect): ErasureReport {
  try {
    return JSON.parse(row.report) as ErasureReport;
  } catch {
    return finalizeReport({
      operationId: row.id,
      contactId: row.contactId,
      requestId: row.requestId,
      mode: row.mode === 'execute' ? 'execute' : 'dry-run',
      policyVersion: row.policyVersion,
      steps: [],
      residuals: [],
    });
  }
}

export async function runContactErasure(input: RunErasureInput): Promise<RunErasureResult> {
  const policy = loadPrivacyPolicy();
  const mode: 'dry-run' | 'execute' = input.dryRun ? 'dry-run' : policy.mode;
  const effectivePolicy: PrivacyPolicy = { ...policy, mode };

  const graph = await loadContactGraph(input.contactId, input.scope);
  if (!graph) return { ok: false, reason: 'not_found' };
  const scope = normalizeScope(input.scope);
  if (!scope.all && !graph.contactInScope) return { ok: false, reason: 'out_of_scope' };

  const requestId = input.requestId?.trim() || `privacy:${randomUUID()}`;
  const binding: RequestBinding = {
    contactId: graph.contact.id,
    actorId: input.actor.userId,
    mode,
    scope,
  };
  const existing = await findOperationByRequestId(requestId);
  if (existing) {
    if (bindingMatches(existing, binding)) {
      return { ok: true, report: { ...reportFromRow(existing), deduplicated: true } };
    }
    await recordPrivacyRefusal({
      actorId: input.actor.userId,
      action: 'lgpd.pseudonymize.refused',
      reasonCode: 'request-id-conflict',
      entityType: 'contact',
      entityId: graph.contact.id,
      requestId,
      scope,
    });
    return { ok: false, reason: 'conflict' };
  }

  // Execução irreversível (bytes de mídia) exige confirmação EXPLÍCITA do
  // ator; sem ela nada é mutado e a recusa é auditada.
  if (irreversiblePlanned(effectivePolicy, graph) && !input.confirmIrreversible) {
    await recordPrivacyRefusal({
      actorId: input.actor.userId,
      action: 'lgpd.pseudonymize.refused',
      reasonCode: 'irreversible-confirmation-required',
      entityType: 'contact',
      entityId: graph.contact.id,
      requestId,
      scope,
    });
    return { ok: false, reason: 'confirmation_required' };
  }

  const operationId = randomUUID();
  const context = buildContext(graph);
  try {
    await db.insert(schema.privacyOperations).values({
      id: operationId,
      requestId,
      contactId: graph.contact.id,
      operation: 'pseudonymize',
      mode,
      status: 'running',
      policyVersion: policy.version,
      scope: JSON.stringify(scope),
      steps: '[]',
      report: '{}',
      checkpoint: 0,
      actorId: input.actor.userId,
    });
  } catch (error) {
    // Corrida no mesmo requestId: só devolve o vencedor se o vínculo for
    // compatível; caso contrário é conflito sem relatório alheio.
    if ((error as { code?: string }).code === '23505') {
      const winner = await findOperationByRequestId(requestId);
      if (winner && bindingMatches(winner, binding)) {
        return { ok: true, report: { ...reportFromRow(winner), deduplicated: true } };
      }
      await recordPrivacyRefusal({
        actorId: input.actor.userId,
        action: 'lgpd.pseudonymize.refused',
        reasonCode: 'request-id-conflict',
        entityType: 'contact',
        entityId: graph.contact.id,
        requestId,
        scope,
      });
      return { ok: false, reason: 'conflict' };
    }
    throw error;
  }

  const steps: ErasureStepResult[] = [];
  const residuals: Array<{ copy: PrivacyCopyType; reason: string }> = [];
  try {
    for (const copy of ERASURE_STEP_ORDER) {
      const outcome = await applyStep(copy, effectivePolicy, context);
      steps.push(outcome.step);
      residuals.push(...collectResiduals(outcome.step, outcome));
      const snapshot = finalizeReport({
        operationId,
        contactId: graph.contact.id,
        requestId,
        mode,
        policyVersion: policy.version,
        steps,
        residuals,
      });
      await persistOperation(operationId, snapshot, mode === 'execute' ? 'running' : 'planned');
      if (input.faultAfterStep === copy) {
        throw new PrivacyOperationError('FAILURE_INJECTED', `fault after step ${copy}`);
      }
    }

    const report = finalizeReport({
      operationId,
      contactId: graph.contact.id,
      requestId,
      mode,
      policyVersion: policy.version,
      steps,
      residuals,
      residualScan: await residualSummary(context),
    });
    await persistOperation(operationId, report, report.status);
    await createAuditLog({
      userId: input.actor.userId,
      action: 'lgpd.pseudonymize',
      entityType: 'contact',
      entityId: graph.contact.id,
      metadata: {
        requestId,
        reason: input.actor.reason,
        policyVersion: policy.version,
        mode,
        result: report.result,
        partial: report.partial,
        fullErasureClaimed: false,
        mutatedCopies: report.mutatedCopies,
        checkpoint: report.checkpoint,
        residuals: report.residuals,
        residualScan: report.residualScan,
        irreversibleConfirmed: Boolean(input.confirmIrreversible),
        scope,
      },
    });
    return { ok: true, report };
  } catch (error) {
    const code = error instanceof PrivacyOperationError ? error.code : 'OPERATION_FAILED';
    const failedReport = finalizeReport({
      operationId,
      contactId: graph.contact.id,
      requestId,
      mode,
      policyVersion: policy.version,
      steps,
      residuals,
    });
    const withFailure: ErasureReport = {
      ...failedReport,
      status: 'failed',
      result: 'failed',
      checkpoint: steps.length,
    };
    await persistOperation(operationId, withFailure, 'failed', code).catch(() => undefined);
    await createAuditLog({
      userId: input.actor.userId,
      action: 'lgpd.pseudonymize.failed',
      entityType: 'contact',
      entityId: graph.contact.id,
      metadata: {
        requestId,
        reason: input.actor.reason,
        policyVersion: policy.version,
        mode,
        errorCode: code,
        checkpoint: steps.length,
        scope,
      },
    }).catch(() => undefined);
    const wrapped = error instanceof PrivacyOperationError
      ? error
      : new PrivacyOperationError(code, error instanceof Error ? error.message : String(error));
    // Expõe o id retomável mesmo em falha: reconciliação via
    // GET/POST /privacy/operations/:id.
    (wrapped as PrivacyOperationError & { operationId?: string }).operationId = operationId;
    throw wrapped;
  }
}

async function loadOperationRow(operationId: string) {
  const [row] = await db
    .select()
    .from(schema.privacyOperations)
    .where(eq(schema.privacyOperations.id, operationId))
    .limit(1);
  return row ?? null;
}

function isCancelled(row: typeof schema.privacyOperations.$inferSelect): boolean {
  if (row.lastError === 'CANCELLED') return true;
  try {
    return (JSON.parse(row.report) as { cancelled?: boolean }).cancelled === true;
  } catch {
    return false;
  }
}

/**
 * Retomada com ator+escopo ATUAIS: o contato precisa continuar no escopo do
 * ator da requisição (revogação de membership bloqueia), e a execução usa a
 * INTERSEÇÃO entre o escopo registrado e o escopo atual — retomar nunca
 * amplia alcance.
 */
export async function resumeContactErasure(input: ResumeErasureInput): Promise<RunErasureResult> {
  const row = await loadOperationRow(input.operationId);
  if (!row) return { ok: false, reason: 'not_found' };

  const currentScope = normalizeScope(input.scope);
  const effectiveScope = intersectScopes(storedScope(row), currentScope);
  const graph = await loadContactGraph(row.contactId, effectiveScope);
  if (!graph) return { ok: false, reason: 'not_found' };
  if (!effectiveScope.all && !graph.contactInScope) return { ok: false, reason: 'out_of_scope' };

  if (isCancelled(row)) return { ok: false, reason: 'not_resumable' };

  if (row.status === 'completed' || row.status === 'partial' || row.status === 'planned') {
    return { ok: true, report: reportFromRow(row) };
  }
  if (row.status !== 'failed' && row.status !== 'running') {
    return { ok: false, reason: 'not_resumable' };
  }

  const policy = loadPrivacyPolicy();
  const mode: 'dry-run' | 'execute' = row.mode === 'execute' ? 'execute' : 'dry-run';
  const effectivePolicy: PrivacyPolicy = { ...policy, mode };
  if (irreversiblePlanned(effectivePolicy, graph) && !input.confirmIrreversible) {
    await recordPrivacyRefusal({
      actorId: input.actor.userId,
      action: 'lgpd.pseudonymize.refused',
      reasonCode: 'irreversible-confirmation-required',
      entityType: 'contact',
      entityId: row.contactId,
      requestId: row.requestId,
      scope: effectiveScope,
    });
    return { ok: false, reason: 'confirmation_required' };
  }

  const context = buildContext(graph);

  let steps: ErasureStepResult[];
  try {
    steps = JSON.parse(row.steps || '[]') as ErasureStepResult[];
  } catch {
    steps = [];
  }
  const resumedFrom = steps.length;
  const residuals: Array<{ copy: PrivacyCopyType; reason: string }> = [];
  for (const completed of steps) {
    if (completed.residual) residuals.push({ copy: completed.copy, reason: completed.residual });
    if (completed.action === 'deferred-d02') residuals.push({ copy: completed.copy, reason: 'awaiting-d02-approval' });
  }

  for (const copy of ERASURE_STEP_ORDER.slice(resumedFrom)) {
    const outcome = await applyStep(copy, effectivePolicy, context);
    steps.push(outcome.step);
    residuals.push(...collectResiduals(outcome.step, outcome));
    const snapshot = finalizeReport({
      operationId: row.id,
      contactId: row.contactId,
      requestId: row.requestId,
      mode,
      policyVersion: row.policyVersion,
      steps,
      residuals,
      resumedFrom,
      resumedBy: input.actor.userId,
    });
    await persistOperation(row.id, snapshot, mode === 'execute' ? 'running' : 'planned');
  }

  const report = finalizeReport({
    operationId: row.id,
    contactId: row.contactId,
    requestId: row.requestId,
    mode,
    policyVersion: row.policyVersion,
    steps,
    residuals,
    residualScan: await residualSummary(context),
    resumedFrom,
    resumedBy: input.actor.userId,
  });
  await persistOperation(row.id, report, report.status);
  await createAuditLog({
    userId: input.actor.userId,
    action: 'lgpd.pseudonymize',
    entityType: 'contact',
    entityId: row.contactId,
    metadata: {
      requestId: row.requestId,
      reason: input.actor.reason,
      policyVersion: row.policyVersion,
      mode,
      result: report.result,
      partial: report.partial,
      fullErasureClaimed: false,
      mutatedCopies: report.mutatedCopies,
      checkpoint: report.checkpoint,
      resumedFrom,
      resumedBy: input.actor.userId,
      originalActorId: row.actorId,
      residualScan: report.residualScan,
      irreversibleConfirmed: Boolean(input.confirmIrreversible),
      scope: effectiveScope,
      storedScope: storedScope(row),
    },
  });
  return { ok: true, report };
}

/**
 * Cancelamento com ator+escopo ATUAIS: operação terminal é idempotente; uma
 * operação em voo/falha vira `failed` com marcador `CANCELLED` e não pode
 * mais ser retomada. Sem status novo no schema (escopo de escrita não inclui
 * migrations), o marcador fica em `last_error` + `report.cancelled`.
 */
export async function cancelPrivacyOperation(input: CancelErasureInput): Promise<RunErasureResult> {
  const row = await loadOperationRow(input.operationId);
  if (!row) return { ok: false, reason: 'not_found' };

  const currentScope = normalizeScope(input.scope);
  const effectiveScope = intersectScopes(storedScope(row), currentScope);
  const graph = await loadContactGraph(row.contactId, effectiveScope);
  if (!graph) return { ok: false, reason: 'not_found' };
  if (!effectiveScope.all && !graph.contactInScope) return { ok: false, reason: 'out_of_scope' };

  if (row.status === 'completed' || row.status === 'partial' || row.status === 'planned') {
    return { ok: true, report: reportFromRow(row) };
  }
  if (isCancelled(row)) {
    return { ok: true, report: reportFromRow(row) };
  }

  const cancelledReport: ErasureReport = {
    ...reportFromRow(row),
    status: 'failed',
    result: 'failed',
    cancelled: true,
  };
  await persistOperation(row.id, cancelledReport, 'failed', 'CANCELLED');
  await createAuditLog({
    userId: input.actor.userId,
    action: 'lgpd.pseudonymize.cancelled',
    entityType: 'contact',
    entityId: row.contactId,
    metadata: {
      requestId: row.requestId,
      reason: input.actor.reason,
      originalActorId: row.actorId,
      scope: effectiveScope,
      checkpoint: cancelledReport.checkpoint,
    },
  });
  return { ok: true, report: cancelledReport };
}

/**
 * Consulta de operação SEMPRE com ator+escopo atuais: contato fora do escopo
 * responde `out_of_scope` (a rota devolve 404, sem revelar existência).
 */
export async function getPrivacyOperation(
  operationId: string,
  access: OperationAccess,
): Promise<GetOperationResult> {
  const row = await loadOperationRow(operationId);
  if (!row) return { ok: false, reason: 'not_found' };

  const currentScope = normalizeScope(access.scope);
  if (!currentScope.all) {
    const graph = await loadContactGraph(row.contactId, currentScope);
    if (!graph) return { ok: false, reason: 'not_found' };
    if (!graph.contactInScope) return { ok: false, reason: 'out_of_scope' };
  }
  return { ok: true, report: reportFromRow(row) };
}
