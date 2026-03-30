import { auditRepository, AuditFilter } from '../../infrastructure/repositories/audit.repository';

export async function createAuditLog(data: {
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValue?: object;
  newValue?: object;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
  metadata?: object;
}) {
  return auditRepository.create(data);
}

export async function getAuditLogs(filter?: AuditFilter, limit = 100, offset = 0) {
  return auditRepository.findAll(filter, limit, offset);
}

export async function getEntityAuditHistory(entityType: string, entityId: string) {
  return auditRepository.findByEntity(entityType, entityId);
}

export async function getUserAuditTrail(userId: string, limit = 50) {
  return auditRepository.findByUser(userId, limit);
}
