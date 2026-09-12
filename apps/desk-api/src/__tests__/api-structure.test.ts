import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('API Integration Structure', () => {
  // index.ts is now a thin bootstrap entry point that delegates to app.ts
  const indexPath = resolve(__dirname, '../index.ts');
  const indexContent = readFileSync(indexPath, 'utf-8');
  const appPath = resolve(__dirname, '../app.ts');
  const appContent = readFileSync(appPath, 'utf-8');

  it('imports buildDeskApiApp in bootstrap entry point', () => {
    expect(indexContent).toContain("buildDeskApiApp");
  });

  it('does not duplicate Fastify app setup in bootstrap entry point', () => {
    expect(indexContent).not.toContain("from 'fastify'");
    expect(indexContent).not.toContain("@fastify/cors");
    expect(indexContent).not.toContain("@cvg/auth");
    expect(indexContent).not.toContain("@cvg/chat");
  });

  it('has listen method in bootstrap entry point', () => {
    expect(indexContent).toContain('.listen');
  });

  it('bootstrap entry point delegates to buildDeskApiApp', () => {
    expect(indexContent).toContain('buildDeskApiApp()');
  });

  it('app.ts imports Fastify and core plugins', () => {
    expect(appContent).toContain("from 'fastify'");
    expect(appContent).toContain("@fastify/cors");
    expect(appContent).toContain("@cvg/auth");
    expect(appContent).toContain("@cvg/chat");
  });

  it('registers health endpoint in app.ts', () => {
    expect(appContent).toContain("health");
  });

  it('registers domain routes via registerXxxRoutes functions', () => {
    expect(appContent).toContain('registerTaskRoutes');
    expect(appContent).toContain('registerAuthRoutes');
    expect(appContent).toContain('registerInboundWebhook');
    expect(appContent).toContain('registerOutboundController');
  });

  it('buildDeskApiApp exports Fastify instance', () => {
    expect(appContent).toContain('buildDeskApiApp');
  });
});

describe('Events Endpoint', () => {
  const appPath = resolve(__dirname, '../app.ts');
  const adminControllerPath = resolve(__dirname, '../../../../modules/admin/src/presentation/http/admin.controller.ts');
  const content = readFileSync(appPath, 'utf-8');
  const adminContent = readFileSync(adminControllerPath, 'utf-8');

  it('uses ConsumerAwareOutboxReader for /events endpoint', () => {
    // /events uses ConsumerAwareOutboxReader with HTTP_POLL consumer
    expect(content).toContain('ConsumerAwareOutboxReader');
    expect(content).toContain('CONSUMER_IDS.HTTP_POLL');
  });

  it('uses deadLetterStore for /admin/dead-letters endpoint', () => {
    expect(adminContent).toContain('deadLetterStore');
  });

  it('registers /events endpoint', () => {
    expect(content).toContain("app.get('/events'");
    expect(content).toContain('preHandler: createInternalEventsGuard()');
  });

  it('registers /admin/dead-letters endpoint', () => {
    expect(adminContent).toContain("app.get('/admin/dead-letters'");
  });

  it('registers dead-letter retry and resolve actions in admin controller', () => {
    expect(adminContent).toContain("app.post('/admin/dead-letters/:id/retry'");
    expect(adminContent).toContain("app.post('/admin/dead-letters/:id/resolve'");
  });
});
