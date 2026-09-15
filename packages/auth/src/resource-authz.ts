import { sectorPermissionService, type AccessLevel } from './sector-permissions';
import { hasAuthoritativePermissions, hasPermission, isPermission, type Permission, type Role } from './rbac';

export interface ResourceActor {
  id?: string;
  roles?: string[];
  /** Permissões efetivas do banco (D01/PROD-04-AC3); ausente = catálogo estático. */
  permissions?: string[];
  /**
   * true quando `role_permissions` tem linhas (instalação provisionada): o
   * conjunto resolvido — mesmo vazio — é autoritativo e não cai no estático.
   */
  permissionsAuthoritative?: boolean;
}

export interface ConversationResourceLike {
  id: string;
  sectorId?: string | null;
  assignedUserId?: string | null;
}

export interface ContactResourceLike {
  id: string;
  sectorIds?: string[] | null;
}

export interface TaskResourceLike {
  conversationId?: string | null;
  createdBy?: string | null;
  assignedTo?: string | null;
}

export interface AlertResourceLike {
  conversationId?: string | null;
  taskId?: string | null;
  triggeredBy?: string | null;
  acknowledgedBy?: string | null;
  resolvedBy?: string | null;
}

export type ResourceDenial =
  | {
      allowed: false;
      statusCode: 401 | 403 | 404;
      error: 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND';
      message: string;
    };

export type ResourceAuthz = { allowed: true } | ResourceDenial;

function authenticationRequired(): ResourceDenial {
  return { allowed: false, statusCode: 401, error: 'UNAUTHORIZED', message: 'Authentication required' };
}

function notFound(message: string): ResourceDenial {
  return { allowed: false, statusCode: 404, error: 'NOT_FOUND', message };
}

function forbidden(message: string): ResourceDenial {
  return { allowed: false, statusCode: 403, error: 'FORBIDDEN', message };
}

function levelForAction(action: string): AccessLevel {
  return action.endsWith(':read') ? 'read' : 'write';
}

/**
 * Ações de recurso que não pertencem ao catálogo canônico (`rbac.ts`) mas têm
 * equivalente operacional explícito. Ação sem permissão mapeada é negada
 * (default-deny): nenhum recurso libera sem permissão de ação efetiva (D01).
 */
const RESOURCE_ACTION_PERMISSIONS: Record<string, Permission> = {
  'kanban:read': 'chat:read',
  'kanban:write': 'chat:write',
  'contacts:read': 'chat:read',
  'contacts:write': 'chat:write',
};

function permissionForAction(action: string): Permission | null {
  if (isPermission(action)) {
    return action;
  }
  return RESOURCE_ACTION_PERMISSIONS[action] ?? null;
}

/**
 * Ação efetiva do ator:
 * - com permissões do banco resolvidas OU instalação provisionada
 *   (`permissionsAuthoritative`), a decisão é exclusivamente pelo conjunto
 *   resolvido — vazio nega, inclusive built-in e Admin (D01/AC3);
 * - apenas na instalação legada (sem `role_permissions`) mantém o
 *   comportamento estático anterior: Admin global com override, built-ins
 *   pelo catálogo e papel desconhecido negado.
 */
function actorHasActionPermission(actor: ResourceActor, action: string): boolean {
  const permission = permissionForAction(action);

  if (hasAuthoritativePermissions(actor)) {
    return permission !== null && (actor.permissions ?? []).includes(permission);
  }

  const roles = (actor.roles ?? []) as Role[];
  if (roles.includes('Admin')) {
    return true;
  }
  if (!permission) {
    return false;
  }
  return roles.some((role) => hasPermission(role, permission));
}

/**
 * Autorização por recurso (C02 §1–§3) para recursos de conversa.
 * - sem membership no setor do recurso: 404 (não revela existência);
 * - com leitura mas sem nível/permissão da ação: 403;
 * - conversa sem setor: somente admin global ou vínculo explícito (D-C02-3);
 * - admin global (role Admin ou banco): autorizado.
 */
export async function authorizeConversationResource(input: {
  actor: ResourceActor | undefined | null;
  action: string;
  conversation: ConversationResourceLike | null | undefined;
  requiredLevel?: AccessLevel;
  isGlobalAdmin?: (userId: string) => Promise<boolean>;
}): Promise<ResourceAuthz> {
  const { actor, action, conversation, requiredLevel, isGlobalAdmin } = input;

  if (!actor?.id) {
    return authenticationRequired();
  }

  // Ação+recurso (D01/C02): sem permissão de ação a resposta é 403 mesmo para
  // recurso existente; o 404 continua reservado a escopo/membership.
  if (!actorHasActionPermission(actor, action)) {
    return forbidden('Missing permission for this action');
  }

  if (!conversation) {
    return notFound('Conversation not found');
  }

  const roles = actor.roles ?? [];
  if (roles.includes('Admin')) {
    return { allowed: true };
  }

  const checkGlobalAdmin = isGlobalAdmin ?? ((userId: string) => sectorPermissionService.isGlobalAdmin(userId));
  if (await checkGlobalAdmin(actor.id)) {
    return { allowed: true };
  }

  const sectorId = conversation.sectorId ?? undefined;
  if (sectorId) {
    const hasRead = await sectorPermissionService.hasAccess(actor.id, sectorId, 'read');
    if (!hasRead) {
      return notFound('Conversation not found');
    }

    const level = requiredLevel ?? levelForAction(action);
    const hasLevel = await sectorPermissionService.hasAccess(actor.id, sectorId, level);
    if (!hasLevel) {
      return forbidden('Insufficient sector access level');
    }

    return { allowed: true };
  }

  if (conversation.assignedUserId && conversation.assignedUserId === actor.id) {
    return { allowed: true };
  }

  return notFound('Conversation not found');
}

/**
 * Autorização para contato (C02 §1): quando o contato tem vínculos de setor,
 * exige membership em pelo menos um deles; contato sem vínculo permanece no
 * diretório autenticado atual (comportamento preservado e documentado).
 */
export async function authorizeContactResource(input: {
  actor: ResourceActor | undefined | null;
  action: string;
  contact: ContactResourceLike | null | undefined;
  requiredLevel?: AccessLevel;
  isGlobalAdmin?: (userId: string) => Promise<boolean>;
}): Promise<ResourceAuthz> {
  const { actor, action, contact, requiredLevel, isGlobalAdmin } = input;

  if (!actor?.id) {
    return authenticationRequired();
  }

  if (!actorHasActionPermission(actor, action)) {
    return forbidden('Missing permission for this action');
  }

  if (!contact) {
    return notFound('Contact not found');
  }

  const roles = actor.roles ?? [];
  if (roles.includes('Admin')) {
    return { allowed: true };
  }

  const checkGlobalAdmin = isGlobalAdmin ?? ((userId: string) => sectorPermissionService.isGlobalAdmin(userId));
  if (await checkGlobalAdmin(actor.id)) {
    return { allowed: true };
  }

  const sectorIds = contact.sectorIds ?? [];
  if (sectorIds.length === 0) {
    return { allowed: true };
  }

  const level = requiredLevel ?? levelForAction(action);
  let hasReadAnywhere = false;
  for (const sectorId of sectorIds) {
    if (!(await sectorPermissionService.hasAccess(actor.id, sectorId, 'read'))) {
      continue;
    }
    hasReadAnywhere = true;
    if (await sectorPermissionService.hasAccess(actor.id, sectorId, level)) {
      return { allowed: true };
    }
  }

  return hasReadAnywhere
    ? forbidden('Insufficient sector access level')
    : notFound('Contact not found');
}

/**
 * Autorização para task (C02 §1): com conversa, delega à conversa; sem
 * conversa, somente criador, assignee ou admin global (default-deny).
 */
export async function authorizeTaskResource(input: {
  actor: ResourceActor | undefined | null;
  action: string;
  task: TaskResourceLike | null | undefined;
  conversation?: ConversationResourceLike | null;
  requiredLevel?: AccessLevel;
  isGlobalAdmin?: (userId: string) => Promise<boolean>;
}): Promise<ResourceAuthz> {
  const { actor, action, task, conversation, requiredLevel, isGlobalAdmin } = input;

  if (!actor?.id) {
    return authenticationRequired();
  }

  if (!actorHasActionPermission(actor, action)) {
    return forbidden('Missing permission for this action');
  }

  if (!task) {
    return notFound('Task not found');
  }

  if (task.conversationId) {
    if (!conversation) {
      return notFound('Task not found');
    }
    return authorizeConversationResource({ actor, action, conversation, requiredLevel, isGlobalAdmin });
  }

  const roles = actor.roles ?? [];
  if (roles.includes('Admin')) {
    return { allowed: true };
  }

  const checkGlobalAdmin = isGlobalAdmin ?? ((userId: string) => sectorPermissionService.isGlobalAdmin(userId));
  if (await checkGlobalAdmin(actor.id)) {
    return { allowed: true };
  }

  if (task.createdBy === actor.id || task.assignedTo === actor.id) {
    return { allowed: true };
  }

  return notFound('Task not found');
}

/**
 * Autorização para alert (C02 §1): com conversa direta ou via task, delega à
 * conversa; sem vínculo, somente admin, donos da task ou
 * triggeredBy/acknowledgedBy/resolvedBy (default-deny).
 */
export async function authorizeAlertResource(input: {
  actor: ResourceActor | undefined | null;
  action: string;
  alert: AlertResourceLike | null | undefined;
  conversation?: ConversationResourceLike | null;
  task?: TaskResourceLike | null;
  requiredLevel?: AccessLevel;
  isGlobalAdmin?: (userId: string) => Promise<boolean>;
}): Promise<ResourceAuthz> {
  const { actor, action, alert, conversation, task, requiredLevel, isGlobalAdmin } = input;

  if (!actor?.id) {
    return authenticationRequired();
  }

  if (!actorHasActionPermission(actor, action)) {
    return forbidden('Missing permission for this action');
  }

  if (!alert) {
    return notFound('Alert not found');
  }

  const conversationId = alert.conversationId ?? task?.conversationId;
  if (conversationId) {
    if (!conversation) {
      return notFound('Alert not found');
    }
    return authorizeConversationResource({ actor, action, conversation, requiredLevel, isGlobalAdmin });
  }

  const roles = actor.roles ?? [];
  if (roles.includes('Admin')) {
    return { allowed: true };
  }

  const checkGlobalAdmin = isGlobalAdmin ?? ((userId: string) => sectorPermissionService.isGlobalAdmin(userId));
  if (await checkGlobalAdmin(actor.id)) {
    return { allowed: true };
  }

  if (task && (task.createdBy === actor.id || task.assignedTo === actor.id)) {
    return { allowed: true };
  }

  if (alert.triggeredBy === actor.id || alert.acknowledgedBy === actor.id || alert.resolvedBy === actor.id) {
    return { allowed: true };
  }

  return notFound('Alert not found');
}

/**
 * Autorização de escopo de setor informado explicitamente (ex.: iniciar
 * conversa em um setor): exige membership nível `write` (ou admin). Quando a
 * ação de origem é informada, também exige a permissão RBAC correspondente
 * (nunca libera só por existir membership).
 */
export async function authorizeSectorScope(input: {
  actor: ResourceActor | undefined | null;
  sectorId: string;
  requiredLevel?: AccessLevel;
  action?: string;
}): Promise<ResourceAuthz> {
  const { actor, sectorId, requiredLevel = 'write', action } = input;

  if (!actor?.id) {
    return authenticationRequired();
  }

  if (action !== undefined && !actorHasActionPermission(actor, action)) {
    return forbidden('Missing permission for this action');
  }

  const roles = actor.roles ?? [];
  if (roles.includes('Admin')) {
    return { allowed: true };
  }

  const hasRead = await sectorPermissionService.hasAccess(actor.id, sectorId, 'read');
  if (!hasRead) {
    return notFound('Sector not found');
  }

  const hasLevel = await sectorPermissionService.hasAccess(actor.id, sectorId, requiredLevel);
  if (!hasLevel) {
    return forbidden('Insufficient sector access level');
  }

  return { allowed: true };
}
