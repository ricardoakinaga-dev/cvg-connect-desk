/**
 * Tracing utilities for cross-module use
 * Re-exports from desk-api tracing for use by modules
 */

export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): void;
  setStatus(c: { code: number; message?: string }): void;
  end(): void;
}

let _tracing: {
  withSpan: <T>(name: string, fn: (span: Span) => Promise<T>) => Promise<T>;
  setSpanAttribute: (key: string, value: string | number | boolean) => void;
} = {
  withSpan: async <T>(_name: string, fn: (span: Span) => Promise<T>): Promise<T> => {
    return fn({ setAttribute: () => {}, addEvent: () => {}, setStatus: () => {}, end: () => {} });
  },
  setSpanAttribute: (_key: string, _value: string | number | boolean) => {},
};

export function withSpan<T>(operationName: string, fn: (span: Span) => Promise<T>): Promise<T> {
  return _tracing.withSpan(operationName, fn);
}

export function setSpanAttribute(key: string, value: string | number | boolean): void {
  _tracing.setSpanAttribute(key, value);
}

export function extractCorrelationId(_headers: Record<string, string | string[] | undefined>): string | undefined {
  return undefined;
}

/**
 * Initialize tracing from desk-api tracing module
 * Called at app startup to wire up the actual tracing implementation
 */
export function initializeTracing(tracing: typeof _tracing) {
  _tracing = tracing;
}
