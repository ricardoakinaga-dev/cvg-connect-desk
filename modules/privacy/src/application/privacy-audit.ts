import { createAuditLog } from '@cvg/audit';
import type { InventoryScope } from './contact-graph';

/**
 * AAA-17 / C07 / PROD-16 — trilha de recusas de privacidade.
 *
 * Toda negação de escopo/permissão/confirmação é registrada sem PII: ator,
 * código estável da recusa, correlação e escopo efetivo. A recusa nunca
 * devolve o relatório alheio nem revela a existência do recurso.
 */

export type PrivacyRefusalCode =
  | 'contact-out-of-scope'
  | 'operation-out-of-scope'
  | 'full-export-denied'
  | 'irreversible-confirmation-required'
  | 'request-id-conflict'
  | 'operation-not-resumable';

export async function recordPrivacyRefusal(input: {
  actorId: string;
  action: string;
  reasonCode: PrivacyRefusalCode;
  entityType?: string;
  entityId?: string;
  requestId?: string;
  scope?: InventoryScope;
}): Promise<void> {
  const scope = input.scope
    ? { mode: input.scope.all ? 'all' : 'sectors', sectorIds: input.scope.sectorIds ?? [] }
    : null;
  await createAuditLog({
    userId: input.actorId,
    action: input.action,
    entityType: input.entityType ?? 'privacy_operation',
    ...(input.entityId ? { entityId: input.entityId } : {}),
    ...(input.requestId ? { correlationId: input.requestId } : {}),
    metadata: {
      reasonCode: input.reasonCode,
      requestId: input.requestId ?? null,
      scope,
      result: 'refused',
    },
  }).catch(() => undefined);
}
