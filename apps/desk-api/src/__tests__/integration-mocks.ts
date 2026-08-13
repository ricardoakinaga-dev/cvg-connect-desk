import { vi } from 'vitest';

type InjectResponseHeaders = {
  ['set-cookie']?: string | string[];
};

export function getSessionCookie(response: { headers: InjectResponseHeaders }): string {
  const setCookie = response.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];

  if (cookies.length === 0) {
    throw new Error('Login response did not include a session cookie');
  }

  return cookies.map(cookie => cookie.split(';', 1)[0]).join('; ');
}

export function withSessionCsrf(cookie: string): Record<string, string> {
  const csrfCookie = cookie
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith('cvg_csrf='));
  const csrfToken = csrfCookie?.slice('cvg_csrf='.length);

  if (!csrfToken) {
    throw new Error('Session cookie does not include a CSRF token');
  }

  return {
    cookie,
    'x-csrf-token': decodeURIComponent(csrfToken),
  };
}

vi.mock('@cvg/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  registerAuditRoutes: vi.fn().mockResolvedValue(undefined),
}));

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

vi.mock('@cvg/gateway-adapter', () => ({
  registerGatewayRoutes: vi.fn().mockResolvedValue(undefined),
  setGatewayDeskHandlers: vi.fn(),
  setGatewayReplayStore: vi.fn(),
  gatewayService: {
    sendOutbound: vi.fn().mockResolvedValue({ success: true, messageId: 'gateway-mock' }),
    healthCheck: vi.fn().mockResolvedValue(true),
    getInstanceStatus: vi.fn().mockResolvedValue(null),
  },
  mediaService: {
    sendText: vi.fn().mockResolvedValue({ success: true, messageId: 'mock-text' }),
    sendImage: vi.fn().mockResolvedValue({ success: true, messageId: 'mock-image' }),
    sendAudio: vi.fn().mockResolvedValue({ success: true, messageId: 'mock-audio' }),
    sendDocument: vi.fn().mockResolvedValue({ success: true, messageId: 'mock-document' }),
  },
}));
