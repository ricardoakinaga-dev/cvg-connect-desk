import { pgTable, uuid, text, timestamp, boolean, pgEnum, index, uniqueIndex, integer, varchar } from 'drizzle-orm/pg-core';

export const conversationStatusEnum = pgEnum('conversation_status', ['open', 'pending', 'closed', 'archived']);
export const conversationStatusV2Enum = pgEnum('conversation_status_v2', ['novo', 'em_atendimento', 'pendente', 'em_espera', 'finalizado', 'arquivado']);
export const conversationHandlerEnum = pgEnum('conversation_handler', ['bot', 'human']);
export const messageDirectionEnum = pgEnum('message_direction', ['inbound', 'outbound']);
export const messageStatusEnum = pgEnum('message_status', ['pending', 'sent', 'delivered', 'failed']);
export const interactionTypeEnum = pgEnum('interaction_type', ['clinical', 'commercial', 'urgent']);
export const contactGroupTypeEnum = pgEnum('contact_group_type', ['internal', 'external', 'mixed', 'sector', 'custom']);
export const transferStatusEnum = pgEnum('transfer_status', ['pending', 'accepted', 'rejected']);

export const contacts = pgTable('contacts', {
  id: uuid('id').defaultRandom().primaryKey(),
  externalId: text('external_id'),
  phone: text('phone'),
  name: text('name'),
  email: text('email'),
  tutorId: uuid('tutor_id'),
  patientId: uuid('patient_id'),
  metadata: text('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const tutors = pgTable('tutors', {
  id: uuid('id').defaultRandom().primaryKey(),
  externalId: text('external_id'),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const patients = pgTable('patients', {
  id: uuid('id').defaultRandom().primaryKey(),
  externalId: text('external_id'),
  name: text('name').notNull(),
  species: text('species'),
  breed: text('breed'),
  tutorId: uuid('tutor_id').references(() => tutors.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  contactId: uuid('contact_id').references(() => contacts.id),
  status: conversationStatusEnum('status').default('open').notNull(),
  statusV2: conversationStatusV2Enum('status_v2').default('novo').notNull(),
  currentHandler: conversationHandlerEnum('current_handler').default('bot').notNull(),
  interactionType: interactionTypeEnum('interaction_type'),
  queueId: uuid('queue_id').references(() => queues.id),
  teamId: uuid('team_id').references(() => teams.id),
  sectorId: uuid('sector_id').references(() => sectors.id),
  assignedUserId: uuid('assigned_user_id').references(() => users.id),
  isActive: boolean('is_active').default(true).notNull(),
  externalChannelId: text('external_channel_id'),
  externalConversationId: text('external_conversation_id'),
  metadata: text('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  closedAt: timestamp('closed_at'),
}, (t) => ({
  contactIdx: index('idx_conversations_contact').on(t.contactId),
  statusIdx: index('idx_conversations_status').on(t.status),
  statusV2Idx: index('idx_conversations_status_v2').on(t.statusV2),
  currentHandlerIdx: index('idx_conversations_current_handler').on(t.currentHandler),
  sectorIdx: index('idx_conversations_sector').on(t.sectorId),
  assignedIdx: index('idx_conversations_assigned').on(t.assignedUserId),
  externalIdx: uniqueIndex('idx_conversations_external').on(t.externalConversationId),
}));

export const conversationStatusHistory = pgTable('conversation_status_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').references(() => conversations.id).notNull(),
  status: conversationStatusEnum('status').notNull(),
  changedBy: uuid('changed_by').references(() => users.id),
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  conversationIdx: index('idx_status_history_conversation').on(t.conversationId),
}));

export const conversationAssignments = pgTable('conversation_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').references(() => conversations.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  assignedBy: uuid('assigned_by').references(() => users.id),
  assignedAt: timestamp('assigned_at').defaultNow().notNull(),
}, (t) => ({
  conversationIdx: index('idx_assignments_conversation').on(t.conversationId),
  userIdx: index('idx_assignments_user').on(t.userId),
}));

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').references(() => conversations.id).notNull(),
  direction: messageDirectionEnum('direction').notNull(),
  content: text('content').notNull(),
  sender: text('sender'),
  senderType: text('sender_type'),
  recipient: text('recipient'),
  status: messageStatusEnum('status').default('pending').notNull(),
  externalMessageId: text('external_message_id'),
  metadata: text('metadata'),
  // Media fields
  mediaUrl: text('media_url'),
  mediaType: text('media_type'), // 'image', 'audio', 'video', 'document'
  mediaMimetype: text('media_mimetype'),
  mediaFilename: text('media_filename'),
  sentAt: timestamp('sent_at'),
  deliveredAt: timestamp('delivered_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  conversationIdx: index('idx_messages_conversation').on(t.conversationId),
  externalIdx: uniqueIndex('idx_messages_external').on(t.externalMessageId),
  directionIdx: index('idx_messages_direction').on(t.direction),
}));

export const taskStatusEnum = pgEnum('task_status', ['pending', 'in_progress', 'completed', 'cancelled']);
export const taskPriorityEnum = pgEnum('task_priority', ['low', 'medium', 'high', 'urgent']);
export const alertStatusEnum = pgEnum('alert_status', ['active', 'acknowledged', 'resolved']);
export const alertSeverityEnum = pgEnum('alert_severity', ['info', 'warning', 'error', 'critical']);
export const alertTypeEnum = pgEnum('alert_type', ['message', 'deadline', 'assignment', 'system']);
export const noteReferenceTypeEnum = pgEnum('note_reference_type', ['conversation', 'task', 'tutor', 'patient']);

export const tasks = pgTable('tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').references(() => conversations.id),
  tutorId: uuid('tutor_id').references(() => tutors.id),
  patientId: uuid('patient_id').references(() => patients.id),
  title: text('title').notNull(),
  description: text('description'),
  status: taskStatusEnum('status').default('pending').notNull(),
  priority: taskPriorityEnum('priority').default('medium').notNull(),
  assignedTo: uuid('assigned_to').references(() => users.id),
  createdBy: uuid('created_by').references(() => users.id),
  dueAt: timestamp('due_at'),
  completedAt: timestamp('completed_at'),
  metadata: text('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  conversationIdx: index('idx_tasks_conversation').on(t.conversationId),
  tutorIdx: index('idx_tasks_tutor').on(t.tutorId),
  patientIdx: index('idx_tasks_patient').on(t.patientId),
  assignedIdx: index('idx_tasks_assigned').on(t.assignedTo),
  statusIdx: index('idx_tasks_status').on(t.status),
}));

export const taskStatusHistory = pgTable('task_status_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  taskId: uuid('task_id').references(() => tasks.id).notNull(),
  status: taskStatusEnum('status').notNull(),
  changedBy: uuid('changed_by').references(() => users.id),
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  taskIdx: index('idx_task_status_history_task').on(t.taskId),
}));

export const internalNotes = pgTable('internal_notes', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').references(() => conversations.id),
  taskId: uuid('task_id').references(() => tasks.id),
  authorId: uuid('author_id').references(() => users.id).notNull(),
  content: text('content').notNull(),
  referenceType: noteReferenceTypeEnum('reference_type'),
  referenceId: uuid('reference_id'),
  metadata: text('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  conversationIdx: index('idx_notes_conversation').on(t.conversationId),
  taskIdx: index('idx_notes_task').on(t.taskId),
  referenceIdx: index('idx_notes_reference').on(t.referenceType, t.referenceId),
  authorIdx: index('idx_notes_author').on(t.authorId),
}));

export const alerts = pgTable('alerts', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').references(() => conversations.id),
  taskId: uuid('task_id').references(() => tasks.id),
  type: alertTypeEnum('type').notNull(),
  title: text('title').notNull(),
  message: text('message'),
  severity: alertSeverityEnum('severity').default('info').notNull(),
  status: alertStatusEnum('status').default('active').notNull(),
  triggeredBy: uuid('triggered_by').references(() => users.id),
  acknowledgedBy: uuid('acknowledged_by').references(() => users.id),
  acknowledgedAt: timestamp('acknowledged_at'),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  resolvedAt: timestamp('resolved_at'),
  metadata: text('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  conversationIdx: index('idx_alerts_conversation').on(t.conversationId),
  taskIdx: index('idx_alerts_task').on(t.taskId),
  statusIdx: index('idx_alerts_status').on(t.status),
}));

export const alertEvents = pgTable('alert_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  alertId: uuid('alert_id').references(() => alerts.id).notNull(),
  eventType: text('event_type').notNull(),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  changedBy: uuid('changed_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  alertIdx: index('idx_alert_events_alert').on(t.alertId),
}));

export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(), // Ex: 'Admin', 'Receptionist', 'Veterinarian'
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const permissions = pgTable('permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(), // Ex: 'chat:read', 'tasks:write'
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const rolePermissions = pgTable('role_permissions', {
  roleId: uuid('role_id').references(() => roles.id).notNull(),
  permissionId: uuid('permission_id').references(() => permissions.id).notNull(),
}, (t) => ({
  pk: {
    columns: [t.roleId, t.permissionId]
  }
}));

export const queues = pgTable('queues', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userRoles = pgTable('user_roles', {
  userId: uuid('user_id').references(() => users.id).notNull(),
  roleId: uuid('role_id').references(() => roles.id).notNull(),
}, (t) => ({
  pk: {
    columns: [t.userId, t.roleId]
  }
}));

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
}, (t) => ({
  userIdx: index('idx_sessions_user').on(t.userId),
  tokenIdx: uniqueIndex('idx_sessions_token').on(t.token),
}));

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  correlationId: text('correlation_id'),
  metadata: text('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  userIdx: index('idx_audit_logs_user').on(t.userId),
  entityIdx: index('idx_audit_logs_entity').on(t.entityType, t.entityId),
  actionIdx: index('idx_audit_logs_action').on(t.action),
  createdAtIdx: index('idx_audit_logs_created').on(t.createdAt),
}));

// ============================================
// FASE 9 — Enterprise Premium
// ============================================

// --- Labels (Tags Globais) ---
export const labels = pgTable('labels', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  color: varchar('color', { length: 7 }).notNull().default('#6b7280'),
  description: text('description'),
  category: text('category'),
  isSystem: boolean('is_system').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  nameIdx: uniqueIndex('idx_labels_name').on(t.name),
  categoryIdx: index('idx_labels_category').on(t.category),
}));

export const conversationLabels = pgTable('conversation_labels', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }).notNull(),
  labelId: uuid('label_id').references(() => labels.id, { onDelete: 'cascade' }).notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  convLabelIdx: uniqueIndex('idx_conv_labels_unique').on(t.conversationId, t.labelId),
  conversationIdx: index('idx_conv_labels_conversation').on(t.conversationId),
  labelIdx: index('idx_conv_labels_label').on(t.labelId),
}));

export const contactLabels = pgTable('contact_labels', {
  id: uuid('id').defaultRandom().primaryKey(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }).notNull(),
  labelId: uuid('label_id').references(() => labels.id, { onDelete: 'cascade' }).notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  contactLabelIdx: uniqueIndex('idx_contact_labels_unique').on(t.contactId, t.labelId),
  contactIdx: index('idx_contact_labels_contact').on(t.contactId),
  labelIdx: index('idx_contact_labels_label').on(t.labelId),
}));

// --- Setores (Sectors — evolução de queues) ---
export const sectors = pgTable('sectors', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 50 }).notNull(),
  description: text('description'),
  color: varchar('color', { length: 7 }).notNull().default('#4361ee'),
  icon: varchar('icon', { length: 10 }).notNull().default('📋'),
  isActive: boolean('is_active').default(true).notNull(),
  autoAssign: boolean('auto_assign').default(false).notNull(),
  maxConcurrent: integer('max_concurrent').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  codeIdx: uniqueIndex('idx_sectors_code').on(t.code),
}));

// --- Vínculo Contato ↔ Setor ---
export const contactSectors = pgTable('contact_sectors', {
  id: uuid('id').defaultRandom().primaryKey(),
  contactId: uuid('contact_id').references(() => contacts.id).notNull(),
  sectorId: uuid('sector_id').references(() => sectors.id).notNull(),
  sourceId: text('source_id'),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  assignedUserId: uuid('assigned_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  contactSectorIdx: uniqueIndex('idx_contact_sectors_unique').on(t.contactId, t.sectorId),
  contactIdx: index('idx_contact_sectors_contact').on(t.contactId),
  sectorIdx: index('idx_contact_sectors_sector').on(t.sectorId),
}));

// --- Grupos de Contatos ---
export const contactGroups = pgTable('contact_groups', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 150 }).notNull(),
  description: text('description'),
  groupType: contactGroupTypeEnum('group_type').notNull().default('custom'),
  sectorId: uuid('sector_id').references(() => sectors.id),
  color: varchar('color', { length: 7 }).default('#6b7280'),
  icon: varchar('icon', { length: 10 }).default('👥'),
  isSystem: boolean('is_system').default(false).notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  typeIdx: index('idx_contact_groups_type').on(t.groupType),
  sectorIdx: index('idx_contact_groups_sector').on(t.sectorId),
}));

export const contactGroupMembers = pgTable('contact_group_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  groupId: uuid('group_id').references(() => contactGroups.id, { onDelete: 'cascade' }).notNull(),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }).notNull(),
  addedBy: uuid('added_by').references(() => users.id),
  addedAt: timestamp('added_at').defaultNow().notNull(),
}, (t) => ({
  groupContactIdx: uniqueIndex('idx_group_members_unique').on(t.groupId, t.contactId),
  groupIdx: index('idx_group_members_group').on(t.groupId),
  contactIdx: index('idx_group_members_contact').on(t.contactId),
}));

// --- Transferências entre Setores ---
export const contactTransfers = pgTable('contact_transfers', {
  id: uuid('id').defaultRandom().primaryKey(),
  contactId: uuid('contact_id').references(() => contacts.id).notNull(),
  conversationId: uuid('conversation_id').references(() => conversations.id),
  fromSectorId: uuid('from_sector_id').references(() => sectors.id),
  toSectorId: uuid('to_sector_id').references(() => sectors.id).notNull(),
  fromUserId: uuid('from_user_id').references(() => users.id),
  toUserId: uuid('to_user_id').references(() => users.id),
  reason: text('reason'),
  status: transferStatusEnum('status').default('pending').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
}, (t) => ({
  contactIdx: index('idx_transfers_contact').on(t.contactId),
  conversationIdx: index('idx_transfers_conversation').on(t.conversationId),
  fromSectorIdx: index('idx_transfers_from_sector').on(t.fromSectorId),
  toSectorIdx: index('idx_transfers_to_sector').on(t.toSectorId),
  statusIdx: index('idx_transfers_status').on(t.status),
}));

// --- Coluna sector_id e status_v2 adicionados à conversations ---
// (adicionado via migration separada para não quebrar dados existentes)

// ============================================
// FASE 9.2 — Permissões por Setor
// ============================================

export const userSectors = pgTable('user_sectors', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  sectorId: uuid('sector_id').references(() => sectors.id, { onDelete: 'cascade' }).notNull(),
  accessLevel: varchar('access_level', { length: 20 }).notNull().default('read'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  userSectorIdx: uniqueIndex('idx_user_sectors_unique').on(t.userId, t.sectorId),
  userIdx: index('idx_user_sectors_user').on(t.userId),
  sectorIdx: index('idx_user_sectors_sector').on(t.sectorId),
}));

// ============================================
// Outbox de Eventos (Pipeline Interprocesso)
// ============================================

export const outboxEvents = pgTable('outbox_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: text('event_id').notNull().unique(),
  eventType: text('event_type').notNull(),
  eventVersion: integer('event_version').notNull().default(1),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  occurredAt: timestamp('occurred_at').notNull(),
  payload: text('payload').notNull(),
  metadata: text('metadata'),
  correlationId: text('correlation_id'),
  causationId: text('causation_id'),
  version: integer('version').notNull().default(1),
  processedAt: timestamp('processed_at'),
  retryCount: integer('retry_count').notNull().default(0),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  eventIdIdx: uniqueIndex('idx_outbox_event_id').on(t.eventId),
  eventTypeIdx: index('idx_outbox_event_type').on(t.eventType),
  aggregateIdx: index('idx_outbox_aggregate').on(t.aggregateType, t.aggregateId),
  processedIdx: index('idx_outbox_processed').on(t.processedAt),
  createdAtIdx: index('idx_outbox_created').on(t.createdAt),
}));

// ============================================
// Outbox Consumer Acks (Fan-out por Consumer)
// Permite que múltiplos consumers processem o mesmo evento independentemente
// ============================================

export const outboxConsumerAcks = pgTable('outbox_consumer_acks', {
  eventId: text('event_id').notNull(),
  consumerId: text('consumer_id').notNull(),
  processedAt: timestamp('processed_at'),
  lastError: text('last_error'),
  retryCount: integer('retry_count').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  pk: { columns: [t.eventId, t.consumerId] },
  consumerIdx: index('idx_acks_consumer').on(t.consumerId),
}));
