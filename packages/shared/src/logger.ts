/**
 * Standalone Structured Logger
 * Used by worker and realtime services to output JSON logs
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LoggerConfig {
  service: string;
  minLevel?: LogLevel;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

export function createLogger(config: LoggerConfig) {
  const minLevel = LOG_LEVELS[config.minLevel ?? 'info'];

  function formatMessage(level: LogLevel, message: string, data?: Record<string, unknown>): string {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: config.service,
      message,
      ...data,
    };
    return JSON.stringify(logEntry);
  }

  return {
    debug(message: string, data?: Record<string, unknown>) {
      if (LOG_LEVELS.debug >= minLevel) {
        console.log(formatMessage('debug', message, data));
      }
    },
    info(message: string, data?: Record<string, unknown>) {
      if (LOG_LEVELS.info >= minLevel) {
        console.log(formatMessage('info', message, data));
      }
    },
    warn(message: string, data?: Record<string, unknown>) {
      if (LOG_LEVELS.warn >= minLevel) {
        console.warn(formatMessage('warn', message, data));
      }
    },
    error(message: string, data?: Record<string, unknown>) {
      if (LOG_LEVELS.error >= minLevel) {
        console.error(formatMessage('error', message, data));
      }
    },
    fatal(message: string, data?: Record<string, unknown>) {
      if (LOG_LEVELS.fatal >= minLevel) {
        console.error(formatMessage('fatal', message, data));
      }
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;