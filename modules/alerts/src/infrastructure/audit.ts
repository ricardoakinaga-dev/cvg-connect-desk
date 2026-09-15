import { schema, type DatabaseExecutor } from '@cvg/database';

/**
 * Trilha de auditoria transacional (PROD-18/AC1-AC2).
 *
 * O insert participa do MESMO executor (`tx`) da entidade/histórico/outbox:
 * falha em qualquer escrita derruba todas. A trilha nunca copia conteúdo
 * sensível — apenas referências, tamanhos e estados (C07/AAA-17).
 */
export interface OperationalAuditInput {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function insertOperationalAudit(
  executor: DatabaseExecutor,
  entry: OperationalAuditInput,
): Promise<void> {
  await executor.insert(schema.auditLogs).values({
    userId: entry.userId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    oldValue: entry.oldValue === undefined ? null : JSON.stringify(entry.oldValue),
    newValue: entry.newValue === undefined ? null : JSON.stringify(entry.newValue),
    correlationId: entry.correlationId ?? null,
    metadata: entry.metadata === undefined ? null : JSON.stringify(entry.metadata),
  });
}
