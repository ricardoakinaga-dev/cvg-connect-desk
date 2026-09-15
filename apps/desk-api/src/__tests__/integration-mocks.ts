import { vi } from 'vitest';

// `createAuditLog`/rotas continuam mockados para isolar o teste; a auditoria
// TRANSACIONAL (`insertAuditLog`, SA-006/AC2) permanece real porque participa do
// commit do caso de uso sob prova.
vi.mock('@cvg/audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cvg/audit')>();
  return {
    ...actual,
    createAuditLog: vi.fn().mockResolvedValue(undefined),
    registerAuditRoutes: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@cvg/secretary-adapter', () => ({
  triggerHandoff: vi.fn().mockResolvedValue(undefined),
  invokeSecretary: vi.fn().mockResolvedValue({
    isErr: () => true,
    isOk: () => false,
  }),
}));

vi.mock('../../../../modules/chat/src/application/events/chat-publisher.ts', () => ({
  publishMessagePersisted: vi.fn().mockResolvedValue(undefined),
  publishConversationCreated: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@cvg/gateway-adapter', () => {
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${Date.now()}-${(counter += 1)}`;
  return {
    registerGatewayRoutes: vi.fn().mockResolvedValue(undefined),
    gatewayService: {
      sendOutbound: vi.fn().mockImplementation(async () => ({ success: true, messageId: nextId('gateway-mock') })),
      healthCheck: vi.fn().mockResolvedValue(true),
      getInstanceStatus: vi.fn().mockResolvedValue(null),
    },
    mediaService: {
      sendText: vi.fn().mockImplementation(async () => ({ success: true, messageId: nextId('mock-text') })),
      sendImage: vi.fn().mockImplementation(async () => ({ success: true, messageId: nextId('mock-image') })),
      sendAudio: vi.fn().mockImplementation(async () => ({ success: true, messageId: nextId('mock-audio') })),
      sendDocument: vi.fn().mockImplementation(async () => ({ success: true, messageId: nextId('mock-document') })),
    },
  };
});
