import { db, schema } from '@cvg/database';
import { eq } from 'drizzle-orm';

/**
 * Fonte efetiva de papéis/permissões (D01/PROD-04-AC3).
 *
 * A partir deste delta a fonte AUTORITATIVA é o banco: `user_roles` ->
 * `role_permissions` -> `permissions`. O catálogo estático de `rbac.ts` passa a
 * ser apenas fallback de compatibilidade para instalações ainda não
 * provisionadas (sem linhas em `role_permissions`), nunca a primeira fonte.
 *
 * A resolução é uma única query (left joins preservam usuários com papel mas
 * sem permissão, que o chamador decide negar/fallback).
 */
export interface AccessSets {
  roles: string[];
  permissions: string[];
}

export interface UserAccess extends AccessSets {
  /**
   * true quando a INSTALAÇÃO está provisionada (existe ao menos uma linha em
   * `role_permissions`): o conjunto resolvido do usuário é autoritativo mesmo
   * quando VAZIO, e o catálogo estático de `rbac.ts` deixa de ser consultado.
   * false/ausente = instalação legada (sem `role_permissions`), único cenário
   * em que o fallback estático vale.
   */
  permissionsAuthoritative: boolean;
}

export interface UserAccessRow {
  roleName: string | null;
  permissionName: string | null;
}

/** Colapsa as linhas do join em conjuntos únicos de papéis e permissões. */
export function collapseAccessRows(rows: readonly UserAccessRow[]): AccessSets {
  const roles = new Set<string>();
  const permissions = new Set<string>();
  for (const row of rows) {
    if (row.roleName) {
      roles.add(row.roleName);
    }
    if (row.permissionName) {
      permissions.add(row.permissionName);
    }
  }
  return { roles: [...roles], permissions: [...permissions] };
}

/**
 * TTL do flag de provisionamento. Curto de propósito (≤5s): depois de uma
 * migração/seed o flag se corrige sozinho, e uma edição de role_permissions
 * continua refletindo na requisição seguinte (o flag só muda de instalação
 * não provisionada para provisionada, nunca por edição de um papel).
 */
const PROVISION_CACHE_TTL_MS = 5000;

let provisionCache: { authoritative: boolean; expiresAt: number } | null = null;

/** Somente testes: zera o cache de provisionamento entre cenários. */
export function resetPermissionProvisionCacheForTests(): void {
  provisionCache = null;
}

/**
 * A instalação está provisionada quando `role_permissions` tem ao menos uma
 * linha (pós-0025/seed). A checagem é global (não por usuário) e cacheada por
 * no máximo 5s — é o que distingue "papel sem nenhuma permissão no banco"
 * (autoritativo, nega) de "instalação legada sem catálogo no banco" (fallback
 * estático apenas para built-in).
 */
export async function isRolePermissionsProvisioned(): Promise<boolean> {
  const now = Date.now();
  if (provisionCache && provisionCache.expiresAt > now) {
    return provisionCache.authoritative;
  }

  const [row] = await db
    .select({ roleId: schema.rolePermissions.roleId })
    .from(schema.rolePermissions)
    .limit(1);

  const authoritative = Boolean(row);
  provisionCache = { authoritative, expiresAt: now + PROVISION_CACHE_TTL_MS };
  return authoritative;
}

/** Papéis do usuário + permissões efetivas + flag de provisionamento da instalação. */
export async function resolveUserAccess(userId: string): Promise<UserAccess> {
  const [rows, permissionsAuthoritative] = await Promise.all([
    db
      .select({
        roleName: schema.roles.name,
        permissionName: schema.permissions.name,
      })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
      .leftJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.roles.id))
      .leftJoin(schema.permissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
      .where(eq(schema.userRoles.userId, userId)),
    isRolePermissionsProvisioned(),
  ]);

  return { ...collapseAccessRows(rows), permissionsAuthoritative };
}

/** Permissões efetivas do usuário conforme o banco (Set para decisão). */
export async function resolveEffectivePermissions(userId: string): Promise<Set<string>> {
  const access = await resolveUserAccess(userId);
  return new Set(access.permissions);
}
