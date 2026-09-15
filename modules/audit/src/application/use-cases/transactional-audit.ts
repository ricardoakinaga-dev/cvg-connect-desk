import { schema, type DatabaseExecutor } from '@cvg/database';

/**
 * Auditoria participante do MESMO commit da ação (SA-006/AC2, C01/C10).
 *
 * Diferente de `createAuditLog` (que abre a conexão global), esta função recebe
 * o executor da transação do chamador: se a auditoria falhar, a ação inteira
 * sofre rollback — não existe sucesso sem trilha. Nunca serializa hash de
 * senha, token ou conteúdo sensível; apenas referências e estados.
 */
export interface TransactionalAuditInput {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function insertAuditLog(
  executor: DatabaseExecutor,
  entry: TransactionalAuditInput,
): Promise<void> {
  await executor.insert(schema.auditLogs).values({
    userId: entry.userId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    oldValue: entry.oldValue === undefined ? null : JSON.stringify(entry.oldValue),
    newValue: entry.newValue === undefined ? null : JSON.stringify(entry.newValue),
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
    correlationId: entry.correlationId ?? null,
    metadata: entry.metadata === undefined ? null : JSON.stringify(entry.metadata),
  });
}
