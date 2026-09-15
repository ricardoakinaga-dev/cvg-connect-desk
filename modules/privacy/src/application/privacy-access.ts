import { sectorPermissionService } from '@cvg/auth';
import { normalizeScope, type InventoryScope } from './contact-graph';

/**
 * AAA-17 / C07 / PROD-16 — resolução do escopo EFETIVO e ATUAL de uma
 * requisição de privacidade.
 *
 * - a decisão de ação (`admin:read`/`admin:write`) fica no `requirePermission`
 *   das rotas, que usa a fonte efetiva de permissões (D01/PROD-04):
 *   `role_permissions` do banco é autoritativa quando provisionada; o catálogo
 *   estático só vale como fallback legado de papéis built-in;
 * - o escopo de setores vem de `user_sectors` no momento da requisição — uma
 *   revogação entre o início e a retomada reduz o escopo visto pelo serviço;
 * - ausência de setores NUNCA significa admin global (D01): só o papel
 *   `Admin` (ou o marcador global do banco) libera `all`.
 */

export interface PrivacyActorLike {
  id?: string;
  roles?: string[];
  permissions?: string[];
  permissionsAuthoritative?: boolean;
}

export async function resolveActorScope(actor?: PrivacyActorLike): Promise<Required<InventoryScope>> {
  if (!actor?.id) return normalizeScope(undefined);
  if ((actor.roles ?? []).includes('Admin')) return { all: true, sectorIds: [] };
  if (await sectorPermissionService.isGlobalAdmin(actor.id)) return { all: true, sectorIds: [] };
  const sectorIds = await sectorPermissionService.getUserSectorIds(actor.id);
  return normalizeScope({ all: false, sectorIds });
}
