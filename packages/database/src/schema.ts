import { pgTable, uuid, text, timestamp, boolean, pgEnum, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const conversationStatusEnum = pgEnum('conversation_status', ['open', 'pending', 'closed', 'archived']);
export const conversationHandlerEnum = pgEnum('conversation_handler', ['bot', 'human']);
export const messageDirectionEnum = pgEnum('message_direction', ['inbound', 'outbound']);
export const messageStatusEnum = pgEnum('message_status', ['pending', 'sent', 'delivered', 'failed']);
export const interactionTypeEnum = pgEnum('interaction_type', ['clinical', 'commercial', 'urgent']);

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
  currentHandler: conversationHandlerEnum('current_handler').default('bot').notNull(),
  interactionType: interactionTypeEnum('interaction_type'),
  queueId: uuid('queue_id').references(() => queues.id),
  teamId: uuid('team_id').references(() => teams.id),
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
  currentHandlerIdx: index('idx_conversations_current_handler').on(t.currentHandler),
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
