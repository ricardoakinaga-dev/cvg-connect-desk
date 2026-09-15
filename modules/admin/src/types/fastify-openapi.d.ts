import 'fastify';

// OpenAPI operation metadata consumed by @fastify/swagger at runtime.
// Mirror of the augmentation shipped by @fastify/swagger types, declared
// locally so package-level `tsc --noEmit` (without the swagger plugin in the
// program) still type-checks route schemas.
declare module 'fastify' {
  interface FastifySchema {
    hide?: boolean;
    deprecated?: boolean;
    tags?: readonly string[];
    description?: string;
    summary?: string;
    consumes?: readonly string[];
    produces?: readonly string[];
    security?: ReadonlyArray<{ [securityLabel: string]: readonly string[] }>;
    operationId?: string;
  }
}
