import { actorGrantsPermission, hasAuthoritativePermissions, type Permission } from './rbac';
import { sectorPermissionService } from './sector-permissions';

/**
 * Autorização central (Phase 4 — §7.1): RBAC + sector scope + resource scope.
 *
 * Modelo:
 * - roles do usuário (RBAC estático) — permissão necessária por ação;
 * - sector memberships (banco) — escopo para recursos setorizados;
 * - global admin override (role Admin).
 *
 * API: authorize(actor, action, resource?, context?)
 */

export interface AuthzActor {
  id: string;
  roles: string[];
  /** Permissões efetivas do banco (D01/PROD-04-AC3); ausente = catálogo estático. */
  permissions?: string[];
  /**
   * true quando `role_permissions` tem linhas (instalação provisionada): o
   * conjunto resolvido — mesmo vazio — é autoritativo e o override de Admin
   * do modo legado não se aplica.
   */
  permissionsAuthoritative?: boolean;
}

export interface AuthzResource {
  type: string;
  id?: string;
  sectorId?: string | null;
}

export interface AuthzContext {
  sectorId?: string | null;
  sectorLevel?: 'read' | 'write' | 'admin';
}

export type AuthzReason =
  | 'unauthenticated'
  | 'global-admin'
  | 'missing-permission'
  | 'sector-allowed'
  | 'sector-denied'
  | 'permitted';

export interface AuthzDecision {
  allowed: boolean;
  reason: AuthzReason;
}

export interface AuthzDeps {
  isGlobalAdmin: (userId: string) => Promise<boolean>;
  hasSectorAccess: (userId: string, sectorId: string, level: 'read' | 'write' | 'admin') => Promise<boolean>;
}

const defaultDeps: AuthzDeps = {
  isGlobalAdmin: (userId) => sectorPermissionService.isGlobalAdmin(userId),
  hasSectorAccess: (userId, sectorId, level) => sectorPermissionService.hasAccess(userId, sectorId, level),
};

/**
 * Ações sensíveis (§7.3) e a permissão mínima exigida.
 * Toda ação desta lista deve passar por authorize() e gerar audit log.
 */
export const SENSITIVE_ACTIONS: Record<string, Permission> = {
  'admin.permission.change': 'admin:write',
  'admin.role.change': 'admin:write',
  'contact.delete': 'admin:write',
  'conversation.delete': 'chat:delete',
  'dlq.replay': 'admin:write',
  'dlq.resolve': 'admin:write',
  'message.resend': 'chat:write',
  'message.delete': 'chat:delete',
  'session.revoke': 'admin:write',
  'sector.membership.change': 'admin:write',
  'ai.privileged': 'admin:write',
  'lgpd.export': 'admin:read',
  'lgpd.anonymize': 'admin:write',
};

function requiredSectorLevel(action: Permission, context?: AuthzContext): 'read' | 'write' | 'admin' {
  if (context?.sectorLevel) return context.sectorLevel;
  return action.endsWith(':read') ? 'read' : 'write';
}

export async function authorize(
  actor: AuthzActor | undefined | null,
  action: Permission,
  resource?: AuthzResource | null,
  context?: AuthzContext | null,
  deps: AuthzDeps = defaultDeps,
): Promise<AuthzDecision> {
  if (!actor?.id) {
    return { allowed: false, reason: 'unauthenticated' };
  }

  const roles = actor.roles ?? [];

  // Fonte efetiva do banco é autoritativa quando a instalação está
  // provisionada (flag) ou quando o conjunto resolvido veio não vazio; o
  // override global de Admin permanece apenas no modo legado (sem
  // `role_permissions`). Built-in/Admin com conjunto vazio = negado.
  if (!hasAuthoritativePermissions(actor) && roles.includes('Admin')) {
    return { allowed: true, reason: 'global-admin' };
  }

  if (!actorGrantsPermission(actor, action)) {
    return { allowed: false, reason: 'missing-permission' };
  }

  const sectorId = resource?.sectorId ?? context?.sectorId ?? undefined;
  if (sectorId) {
    if (await deps.isGlobalAdmin(actor.id)) {
      return { allowed: true, reason: 'global-admin' };
    }
    const level = requiredSectorLevel(action, context ?? undefined);
    const ok = await deps.hasSectorAccess(actor.id, sectorId, level);
    return ok
      ? { allowed: true, reason: 'sector-allowed' }
      : { allowed: false, reason: 'sector-denied' };
  }

  return { allowed: true, reason: 'permitted' };
}
