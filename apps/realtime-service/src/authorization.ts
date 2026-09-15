import type {
  AuthorizationDecision,
  ParsedChannel,
  RealtimeAuthorizationPort,
  RealtimePrincipal,
} from '@cvg/realtime';

// Pacotes internos são publicados como CommonJS; este serviço é ESM.
import * as authNamespace from '@cvg/auth';
import * as databaseNamespace from '@cvg/database';
import { eq } from 'drizzle-orm';

function unwrapCommonJs<T>(namespace: T): T {
  return ((namespace as unknown as { default?: T }).default ?? namespace) as T;
}

const authModule = unwrapCommonJs(authNamespace);
const databaseModule = unwrapCommonJs(databaseNamespace);

const { authorizeConversationResource, authorizeSectorScope, actorGrantsPermission, resolveUserAccess } = authModule;
const { db, schema } = databaseModule;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Permissão exigida para conteúdo realtime, idêntica à do HTTP
 * (`outbound.controller.ts` -> `requirePermission('chat:read')`). Setor é canal
 * de conteúdo de conversa, então usa a mesma permissão.
 */
const REALTIME_CONTENT_PERMISSION = 'chat:read';

/**
 * Cache curto (1s) das permissões efetivas por usuário. A fonte autoritativa é
 * o banco (mesma do HTTP); o TTL mantém revogação bem abaixo do limite de 5s
 * sem uma query por entrega de evento.
 */
const ACCESS_CACHE_TTL_MS = 1_000;
const accessCache = new Map<string, { roles: string[]; permissions: string[]; expiresAt: number }>();

async function resolveAccessCached(userId: string): Promise<{ roles: string[]; permissions: string[] }> {
  const cached = accessCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return { roles: cached.roles, permissions: cached.permissions };
  }
  const access = await resolveUserAccess(userId);
  const value = { roles: access.roles, permissions: access.permissions };
  accessCache.set(userId, { ...value, expiresAt: Date.now() + ACCESS_CACHE_TTL_MS });
  return value;
}

function allowed(): AuthorizationDecision {
  return { allowed: true, reason: 'permitted' };
}

function denied(reason: string): AuthorizationDecision {
  return { allowed: false, reason };
}

/**
 * Resolve RBAC pela fonte efetiva do banco (papéis + permissões), com o mesmo
 * fallback do HTTP apenas para instalações legadas. Papel customizado sem
 * permissão no banco é negado.
 */
function hasRealtimeContentPermission(access: { roles: string[]; permissions: string[] }): boolean {
  return actorGrantsPermission(access, REALTIME_CONTENT_PERMISSION as never);
}

/**
 * Porta real (C02 D-C02-2/3): exige a permissão RBAC do HTTP
 * (`chat:read`) e consulta membership no banco usando as mesmas funções de
 * @cvg/auth que as rotas HTTP (permission + membership).
 * Nenhuma decisão usa payload de evento ou dado vindo do cliente.
 */
export function createDatabaseAuthorizationPort(): RealtimeAuthorizationPort {
  async function authorizeConversation(
    principal: RealtimePrincipal,
    conversationId: string,
  ): Promise<AuthorizationDecision> {
    const access = await resolveAccessCached(principal.id);

    // Mesma ordem do HTTP: permissão (403) antes de resolver o recurso (404).
    if (!hasRealtimeContentPermission(access)) {
      return denied('missing-permission');
    }

    // IDs não-UUID nunca existem no banco; nega sem query (default-deny).
    if (!UUID_PATTERN.test(conversationId)) {
      return denied('conversation-not-found');
    }

    const [row] = await db
      .select({
        id: schema.conversations.id,
        sectorId: schema.conversations.sectorId,
        assignedUserId: schema.conversations.assignedUserId,
      })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId))
      .limit(1);

    const decision = await authorizeConversationResource({
      actor: { id: principal.id, roles: access.roles, permissions: access.permissions },
      action: 'chat:read',
      conversation: row
        ? { id: row.id, sectorId: row.sectorId, assignedUserId: row.assignedUserId }
        : null,
      requiredLevel: 'read',
    });

    return decision.allowed ? allowed() : denied(decision.error);
  }

  async function authorizeSector(
    principal: RealtimePrincipal,
    sectorId: string,
  ): Promise<AuthorizationDecision> {
    const access = await resolveAccessCached(principal.id);

    if (!hasRealtimeContentPermission(access)) {
      return denied('missing-permission');
    }

    if (!UUID_PATTERN.test(sectorId)) {
      return denied('sector-not-found');
    }

    const decision = await authorizeSectorScope({
      actor: { id: principal.id, roles: access.roles, permissions: access.permissions },
      sectorId,
      requiredLevel: 'read',
      action: 'chat:read',
    });

    return decision.allowed ? allowed() : denied(decision.error);
  }

  async function authorizeChannel(
    principal: RealtimePrincipal,
    channel: ParsedChannel,
  ): Promise<AuthorizationDecision> {
    switch (channel.kind) {
      case 'global':
      case 'correlation':
        // Canais de sinal sanitizado: autenticado já é suficiente.
        return allowed();
      case 'user':
        return principal.id === channel.userId ? allowed() : denied('foreign-user-channel');
      case 'conversation':
        return await authorizeConversation(principal, channel.conversationId);
      case 'sector':
        return await authorizeSector(principal, channel.sectorId);
      default:
        return denied('unsupported-channel');
    }
  }

  return {
    async authorizeSubscription(principal, channel) {
      return await authorizeChannel(principal, channel);
    },

    async authorizeDelivery(principal, target) {
      switch (target.resource.kind) {
        case 'conversation':
          return await authorizeConversation(principal, target.resource.conversationId);
        case 'sector':
          return await authorizeSector(principal, target.resource.sectorId);
        case 'user':
          return principal.id === target.resource.userId
            ? allowed()
            : denied('foreign-user-channel');
        default:
          return denied('unsupported-resource');
      }
    },
  };
}
