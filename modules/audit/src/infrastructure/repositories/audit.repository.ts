import { db, schema } from '@cvg/database';
import { eq, desc, and, gte, lte } from 'drizzle-orm';

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValue: string | null;
  newValue: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  correlationId: string | null;
  metadata: string | null;
  createdAt: Date;
}

export interface AuditFilter {
  userId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  startDate?: Date;
  endDate?: Date;
}

export const auditRepository = {
  async create(data: {
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
  }): Promise<AuditLogEntry> {
    const [entry] = await db
      .insert(schema.auditLogs)
      .values({
        userId: data.userId || null,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId || null,
        oldValue: data.oldValue ? JSON.stringify(data.oldValue) : null,
        newValue: data.newValue ? JSON.stringify(data.newValue) : null,
        ipAddress: data.ipAddress || null,
        userAgent: data.userAgent || null,
        correlationId: data.correlationId || null,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      })
      .returning();

    return entry;
  },

  async findAll(filter?: AuditFilter, limit = 100, offset = 0): Promise<AuditLogEntry[]> {
    let query = db.select().from(schema.auditLogs).$dynamic();

    const conditions = [];

    if (filter?.userId) {
      conditions.push(eq(schema.auditLogs.userId, filter.userId));
    }
    if (filter?.entityType) {
      conditions.push(eq(schema.auditLogs.entityType, filter.entityType));
    }
    if (filter?.entityId) {
      conditions.push(eq(schema.auditLogs.entityId, filter.entityId));
    }
    if (filter?.action) {
      conditions.push(eq(schema.auditLogs.action, filter.action));
    }
    if (filter?.startDate) {
      conditions.push(gte(schema.auditLogs.createdAt, filter.startDate));
    }
    if (filter?.endDate) {
      conditions.push(lte(schema.auditLogs.createdAt, filter.endDate));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const result = await query
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(limit)
      .offset(offset);

    return result;
  },

  async findByEntity(entityType: string, entityId: string): Promise<AuditLogEntry[]> {
    return db
      .select()
      .from(schema.auditLogs)
      .where(and(
        eq(schema.auditLogs.entityType, entityType),
        eq(schema.auditLogs.entityId, entityId)
      ))
      .orderBy(desc(schema.auditLogs.createdAt));
  },

  async findByUser(userId: string, limit = 50): Promise<AuditLogEntry[]> {
    return db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.userId, userId))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(limit);
  },
};
