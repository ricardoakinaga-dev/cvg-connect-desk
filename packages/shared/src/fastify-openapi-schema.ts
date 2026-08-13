import type {} from 'fastify/types/schema';

declare module 'fastify/types/schema' {
  interface FastifySchema {
    description?: string;
    tags?: string[];
    security?: Array<Record<string, string[]>>;
    summary?: string;
    hide?: boolean;
  }
}

export {};
