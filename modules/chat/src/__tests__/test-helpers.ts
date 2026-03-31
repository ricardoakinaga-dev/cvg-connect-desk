import { vi } from 'vitest';

// ==========================================
// Mock Factories
// ==========================================

export function createMockConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-001',
    contactId: 'contact-001',
    status: 'open',
    statusV2: 'novo',
    currentHandler: 'bot',
    interactionType: null,
    queueId: null,
    teamId: null,
    sectorId: null,
    assignedUserId: null,
    isActive: true,
    externalChannelId: 'whatsapp',
    externalConversationId: 'ext-conv-001',
    metadata: null,
    createdAt: new Date('2026-03-31T12:00:00Z'),
    updatedAt: new Date('2026-03-31T12:00:00Z'),
    closedAt: null,
    ...overrides,
  };
}

export function createMockMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-001',
    conversationId: 'conv-001',
    direction: 'inbound' as const,
    content: 'Olá, gostaria de agendar uma consulta',
    sender: '+5511999999999',
    senderType: 'contact',
    recipient: null,
    status: 'pending' as const,
    externalMessageId: 'ext-msg-001',
    metadata: null,
    mediaUrl: null,
    mediaType: null,
    mediaMimetype: null,
    mediaFilename: null,
    sentAt: new Date('2026-03-31T12:00:00Z'),
    deliveredAt: null,
    createdAt: new Date('2026-03-31T12:00:00Z'),
    ...overrides,
  };
}

export function createMockContact(overrides: Record<string, unknown> = {}) {
  return {
    id: 'contact-001',
    externalId: null,
    phone: '5511999999999',
    name: 'João Silva',
    email: 'joao@example.com',
    tutorId: null,
    patientId: null,
    metadata: null,
    createdAt: new Date('2026-03-31T12:00:00Z'),
    updatedAt: new Date('2026-03-31T12:00:00Z'),
    ...overrides,
  };
}

export function createMockSector(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sector-001',
    name: 'Recepção',
    code: 'recepcao',
    description: 'Primeiro atendimento',
    color: '#4361ee',
    icon: '🏥',
    isActive: true,
    autoAssign: false,
    maxConcurrent: 0,
    createdAt: new Date('2026-03-31T12:00:00Z'),
    updatedAt: new Date('2026-03-31T12:00:00Z'),
    ...overrides,
  };
}

// ==========================================
// Mock Repositories
// ==========================================

export function createMockConversationRepository() {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByExternalId: vi.fn(),
    findByContactId: vi.fn(),
    findActiveByContactId: vi.fn(),
    findAll: vi.fn(),
    update: vi.fn(),
    updateStatusV2: vi.fn(),
    updateSector: vi.fn(),
    assignUser: vi.fn(),
    close: vi.fn(),
    addStatusHistory: vi.fn(),
    updateCurrentHandler: vi.fn(),
    countByStatusV2: vi.fn(),
    countBySector: vi.fn(),
  };
}

export function createMockMessageRepository() {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByExternalId: vi.fn(),
    findByConversationId: vi.fn(),
    findRecentByConversationId: vi.fn(),
    updateStatus: vi.fn(),
    updateDeliveryStatus: vi.fn(),
    update: vi.fn(),
    findPendingOutbound: vi.fn(),
  };
}

// ==========================================
// Mock Publisher
// ==========================================

export function createMockPublisher() {
  return {
    publishMessagePersisted: vi.fn().mockResolvedValue(undefined),
    publishConversationCreated: vi.fn().mockResolvedValue(undefined),
    publishConversationStatusChanged: vi.fn().mockResolvedValue(undefined),
  };
}

// ==========================================
// Mock Audit
// ==========================================

export function createMockAudit() {
  return {
    createAuditLog: vi.fn().mockResolvedValue(undefined),
  };
}
