export type Permission =
  | 'chat:read'
  | 'chat:write'
  | 'chat:delete'
  | 'tasks:read'
  | 'tasks:write'
  | 'tasks:delete'
  | 'notes:read'
  | 'notes:write'
  | 'notes:delete'
  | 'alerts:read'
  | 'alerts:write'
  | 'alerts:delete'
  | 'admin:read'
  | 'admin:write'
  | 'dashboard:read';

export type Role = 'Admin' | 'Receptionist' | 'Veterinarian' | 'Manager';

/**
 * Catálogo canônico de permissões (fonte estática vigente). Alterações de
 * papéis/permissões em produção permanecem OPEN em D01; este conjunto apenas
 * permite validar ações de recurso contra o catálogo sem inventar nomes.
 */
export const ALL_PERMISSIONS: readonly Permission[] = Object.freeze([
  'chat:read', 'chat:write', 'chat:delete',
  'tasks:read', 'tasks:write', 'tasks:delete',
  'notes:read', 'notes:write', 'notes:delete',
  'alerts:read', 'alerts:write', 'alerts:delete',
  'admin:read', 'admin:write',
  'dashboard:read',
]);

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}


export const RolePermissions: Record<Role, Permission[]> = {
  Admin: [
    'chat:read', 'chat:write', 'chat:delete',
    'tasks:read', 'tasks:write', 'tasks:delete',
    'notes:read', 'notes:write', 'notes:delete',
    'alerts:read', 'alerts:write', 'alerts:delete',
    'admin:read', 'admin:write',
    'dashboard:read',
  ],
  Receptionist: [
    'chat:read', 'chat:write',
    'tasks:read', 'tasks:write',
    'notes:read', 'notes:write',
    'alerts:read',
    'dashboard:read',
  ],
  Veterinarian: [
    'chat:read', 'chat:write',
    'tasks:read', 'tasks:write',
    'notes:read', 'notes:write',
    'alerts:read', 'alerts:write',
    'dashboard:read',
  ],
  Manager: [
    'chat:read', 'chat:write',
    'tasks:read', 'tasks:write',
    'notes:read',
    'alerts:read', 'alerts:write',
    'admin:read',
    'dashboard:read',
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return RolePermissions[role]?.includes(permission) ?? false;
}

/** Papel built-in do catálogo estático (Admin/Receptionist/Veterinarian/Manager). */
export function isBuiltInRole(role: string): role is Role {
  return Object.prototype.hasOwnProperty.call(RolePermissions, role);
}

/**
 * Permissões concedidas pelo catálogo estático a um conjunto de papéis,
 * considerando apenas papéis built-in (papel desconhecido nunca concede).
 * Usado SOMENTE no fallback de instalações ainda não provisionadas no banco.
 */
export function builtInRolesGrant(roles: readonly string[] | undefined, permission: Permission): boolean {
  return (roles ?? []).some((role) => isBuiltInRole(role) && hasPermission(role, permission));
}

export interface ActorPermissionSource {
  roles?: string[];
  permissions?: string[];
  /**
   * true quando a instalação tem `role_permissions` (provisionada): o
   * conjunto resolvido é autoritativo MESMO VAZIO. Ausente/false = instalação
   * legada; um `permissions` não vazio também é autoritativo por conteúdo.
   */
  permissionsAuthoritative?: boolean;
}

/**
 * A fonte efetiva é autoritativa quando o chamador marcou a instalação como
 * provisionada (`permissionsAuthoritative`) ou quando o conjunto resolvido
 * veio não vazio. Quem decide é o banco; o estático nunca "vence" um conjunto
 * explícito — nem quando o conjunto é vazio.
 */
export function hasAuthoritativePermissions(
  actor: ActorPermissionSource | undefined | null,
): boolean {
  if (!actor) return false;
  if (actor.permissionsAuthoritative === true) return true;
  return actor.permissions !== undefined && actor.permissions.length > 0;
}

/**
 * Decisão de ação com a fonte efetiva (D01/PROD-04-AC3):
 * - instalação provisionada (`permissionsAuthoritative`) ou `permissions` não
 *   vazio é AUTORITATIVO: concede apenas se a permissão estiver no conjunto
 *   resolvido (vazio = nega, inclusive built-in e Admin);
 * - apenas instalação legada (sem `role_permissions`, flag false/ausente)
 *   cai no catálogo estático, e ainda assim apenas para papéis built-in.
 *   Papel customizado sem permissão no banco = negado.
 */
export function actorGrantsPermission(
  actor: ActorPermissionSource | undefined | null,
  permission: Permission,
): boolean {
  if (hasAuthoritativePermissions(actor)) {
    return (actor?.permissions ?? []).includes(permission);
  }
  return builtInRolesGrant(actor?.roles, permission);
}
