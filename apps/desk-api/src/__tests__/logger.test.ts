import { describe, expect, it, vi } from 'vitest';
import { addCorrelationIdToLog, createStructuredLogger, logWithContext } from '../logger';

describe('structured logger helpers', () => {
  it('formats metadata with service, message and correlation id', () => {
    const logger = createStructuredLogger('realtime');

    const metadata = logger.formatMetadata({ message: 'connected', userId: 'user-1' }, 'corr-1');

    expect(metadata).toMatchObject({
      service: 'realtime',
      level: 'info',
      message: 'connected',
      correlation_id: 'corr-1',
      userId: 'user-1',
    });
    expect(metadata.timestamp).toEqual(expect.any(String));
  });

  it('normalizes missing message fields and merges correlation id', () => {
    const logger = createStructuredLogger();

    expect(logger.formatMetadata({ count: 1 })).toMatchObject({
      service: 'desk-api',
      message: '',
      count: 1,
    });

    expect(addCorrelationIdToLog({} as never, 'corr-2', { path: '/health' })).toEqual({
      path: '/health',
      correlation_id: 'corr-2',
    });
  });

  it.each(['debug', 'info', 'warn', 'error'] as const)('logs contextual %s messages', (level) => {
    const log = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    logWithContext(log as never, level, 'message', { requestId: 'req-1' });

    expect(log[level]).toHaveBeenCalledWith(
      expect.objectContaining({ timestamp: expect.any(String), requestId: 'req-1' }),
      'message'
    );
  });
});
