import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import {
  authenticate,
  authorizeContactResource,
  hasPermission,
  requirePermission,
  sectorPermissionService,
  type Permission,
  type ResourceActor,
  type ResourceAuthz,
  type Role,
} from '@cvg/auth';
import { AppError } from '@cvg/shared';
import * as useCases from '../../application/use-cases';

function hasRolePermission(actor: ResourceActor | undefined, permission: Permission): boolean {
  return (actor?.roles ?? []).some((role) => hasPermission(role as Role, permission));
}

async function isGlobalAdmin(actor: ResourceActor | undefined): Promise<boolean> {
  return actor?.id ? sectorPermissionService.isGlobalAdmin(actor.id) : false;
}

async function authorizeGroup(
  actor: ResourceActor | undefined,
  action: string,
  groupId: string,
): Promise<ResourceAuthz> {
  if (!actor?.id) {
    return { allowed: false, statusCode: 401, error: 'UNAUTHORIZED', message: 'Authentication required' };
  }

  const result = await useCases.getGroup(groupId);
  if (result.isErr()) {
    return { allowed: false, statusCode: 404, error: 'NOT_FOUND', message: 'Grupo não encontrado' };
  }
  const group = result.value;

  const isWrite = !action.endsWith(':read');
  const hasAdminLevel = hasRolePermission(actor, 'admin:write')
    || (!isWrite && hasRolePermission(actor, 'admin:read'));
  if (hasAdminLevel || (await isGlobalAdmin(actor))) {
    return { allowed: true };
  }

  if (group.sectorId) {
    const level = isWrite ? 'write' : 'read';
    if (await sectorPermissionService.hasAccess(actor.id, group.sectorId, level)) {
      return { allowed: true };
    }
    if (level === 'write' && (await sectorPermissionService.hasAccess(actor.id, group.sectorId, 'read'))) {
      return { allowed: false, statusCode: 403, error: 'FORBIDDEN', message: 'Insufficient sector access level' };
    }
  }

  return { allowed: false, statusCode: 404, error: 'NOT_FOUND', message: 'Grupo não encontrado' };
}

async function filterGroupsByAccess<T extends { sectorId?: string | null }>(
  actor: ResourceActor | undefined,
  groups: T[],
): Promise<T[]> {
  if (!actor?.id) {
    return [];
  }

  if (hasRolePermission(actor, 'admin:read') || (await isGlobalAdmin(actor))) {
    return groups;
  }

  const memberSectorIds = await sectorPermissionService.getUserSectorIds(actor.id);
  return groups.filter((group) => Boolean(group.sectorId && memberSectorIds.includes(group.sectorId)));
}

async function contactSectorIds(contactId: string): Promise<string[]> {
  const rows = await db
    .select({ sectorId: schema.contactSectors.sectorId })
    .from(schema.contactSectors)
    .where(eq(schema.contactSectors.contactId, contactId));
  return rows.map((row) => row.sectorId);
}

/**
 * SA-019/AC3 (D6): membros VISÍVEIS ao ator. Admin global enxerga todos; os
 * demais só contatos acessíveis (mesma regra de authorizeContactResource).
 */
async function visibleGroupMembers(
  actor: { id?: string; roles?: string[] } | undefined,
  groupId: string,
): Promise<Array<{ contactId: string }> | null> {
  const result = await useCases.getGroupMembers(groupId);
  if (result.isErr()) return null;
  const isGlobalAdmin = (actor?.roles ?? []).includes('Admin')
    || (actor?.id ? await sectorPermissionService.isGlobalAdmin(actor.id) : false);
  if (isGlobalAdmin) return result.value as Array<{ contactId: string }>;
  const visible: Array<{ contactId: string }> = [];
  for (const member of result.value as Array<{ contactId: string }>) {
    const memberAccess = await authorizeContactResource({
      actor,
      action: 'chat:read',
      contact: { id: member.contactId, sectorIds: await contactSectorIds(member.contactId) },
      requiredLevel: 'read',
    });
    if (memberAccess.allowed) visible.push(member);
  }
  return visible;
}

export async function registerContactGroupRoutes(app: FastifyInstance) {
  // Listar grupos
  app.get('/contact-groups', {
    preHandler: [authenticate, requirePermission('chat:read')],
    schema: { description: 'Listar grupos de contatos', tags: ['Contact Groups'], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const result = await useCases.listGroups();
    if (result.isErr()) return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    const visible = await filterGroupsByAccess(request.user, result.value);

    // SA-019/AC3 (D6): a contagem do catálogo não pode incluir contatos que o
    // ator não acessa; recalcula para não-admins a partir dos membros visíveis.
    const isGlobalAdmin = (request.user?.roles ?? []).includes('Admin')
      || (request.user?.id ? await sectorPermissionService.isGlobalAdmin(request.user.id) : false);
    if (isGlobalAdmin) {
      return reply.status(200).send(visible);
    }
    const aligned = [];
    for (const group of visible as Array<{ id: string; memberCount?: number }>) {
      const members = await visibleGroupMembers(request.user, group.id);
      aligned.push(members ? { ...group, memberCount: members.length } : group);
    }
    return reply.status(200).send(aligned);
  });

  // Criar grupo
  app.post('/contact-groups', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      description: 'Criar grupo de contatos', tags: ['Contact Groups'], security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['name'],
        properties: {
          name: { type: 'string' }, description: { type: 'string' },
          groupType: { type: 'string', enum: ['internal', 'external', 'mixed', 'sector', 'custom'] },
          sectorId: { type: 'string' }, color: { type: 'string' }, icon: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const userId = (request.user as any)?.id;
    const result = await useCases.createGroup(request.body as any, userId);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return reply.status(201).send(result.value);
  });

  // Atualizar grupo
  app.put('/contact-groups/:id', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: { description: 'Atualizar grupo', tags: ['Contact Groups'], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.updateGroup(id, request.body as any);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });

  // Deletar grupo
  app.delete('/contact-groups/:id', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: { description: 'Deletar grupo', tags: ['Contact Groups'], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.deleteGroup(id);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });

  // Membros do grupo
  app.get('/contact-groups/:id/members', {
    preHandler: [authenticate, requirePermission('chat:read')],
    schema: { description: 'Listar membros do grupo', tags: ['Contact Groups'], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await authorizeGroup(request.user, 'contact-groups:read', id);
    if (!access.allowed) {
      return reply.status(access.statusCode).send({ error: access.error, message: access.message });
    }

    const result = await useCases.getGroupMembers(id);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }

    // SA-019/AC3 (D6): a lista não pode vazar nome/telefone de contato fora do
    // escopo do ator; o helper é o mesmo usado para alinhar a contagem.
    const visible = await visibleGroupMembers(request.user, id);
    return visible ?? result.value;
  });

  // Adicionar membro
  //
  // F3: composição de grupo é operação de chat (um membro de setor com nível
  // write já era autorizado pelo `authorizeGroup`), não uma operação
  // administrativa de catálogo; a ação canônica é `chat:write`, aplicada ANTES
  // do escopo de recurso. A checagem de grupo/membership é preservada.
  app.post('/contact-groups/:id/members', {
    preHandler: [authenticate, requirePermission('chat:write')],
    schema: {
      description: 'Adicionar contato ao grupo', tags: ['Contact Groups'], security: [{ bearerAuth: [] }],
      body: { type: 'object', required: ['contactId'], properties: { contactId: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { contactId } = request.body as { contactId: string };
    const userId = (request.user as any)?.id;

    const access = await authorizeGroup(request.user, 'contact-groups:write', id);
    if (!access.allowed) {
      return reply.status(access.statusCode).send({ error: access.error, message: access.message });
    }

    // SA-019/AC2 (D2/D3): contato precisa existir E estar acessível ao ator;
    // negado e inexistente respondem o MESMO 404 sem vazar existência.
    const [contactRow] = await db.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.id, contactId));
    if (!contactRow) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Contact not found' });
    }
    const contactAccess = await authorizeContactResource({
      actor: request.user,
      action: 'contacts:write',
      contact: { id: contactId, sectorIds: await contactSectorIds(contactId) },
      requiredLevel: 'write',
    });
    if (!contactAccess.allowed) {
      // Contrato: 404 quando o contato não é acessível (não revela existência);
      // 403 quando o ator LÊ o contato mas não tem escrita (matriz §3/§7).
      const deniedMessage = contactAccess.statusCode === 404 ? 'Contact not found' : contactAccess.message;
      return reply.status(contactAccess.statusCode).send({ error: contactAccess.error, message: deniedMessage });
    }

    const result = await useCases.addGroupMember(id, contactId, userId);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return reply.status(201).send(result.value);
  });

  // Remover membro
  //
  // F3: mesma ação canônica do add (`chat:write`), mantendo o `authorizeGroup`
  // como escopo de recurso (admin:read/write estático ou membership do setor).
  app.delete('/contact-groups/:id/members/:contactId', {
    preHandler: [authenticate, requirePermission('chat:write')],
    schema: { description: 'Remover contato do grupo', tags: ['Contact Groups'], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const { id, contactId } = request.params as { id: string; contactId: string };

    const access = await authorizeGroup(request.user, 'contact-groups:write', id);
    if (!access.allowed) {
      return reply.status(access.statusCode).send({ error: access.error, message: access.message });
    }

    // SA-019/AC2 (D4): remover contato exige o MESMO acesso exigido para adicionar.
    const [contactRow] = await db.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.id, contactId));
    if (!contactRow) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Contact not found' });
    }
    const contactAccess = await authorizeContactResource({
      actor: request.user,
      action: 'contacts:write',
      contact: { id: contactId, sectorIds: await contactSectorIds(contactId) },
      requiredLevel: 'write',
    });
    if (!contactAccess.allowed) {
      const deniedMessage = contactAccess.statusCode === 404 ? 'Contact not found' : contactAccess.message;
      return reply.status(contactAccess.statusCode).send({ error: contactAccess.error, message: deniedMessage });
    }

    const result = await useCases.removeGroupMember(id, contactId);
    if (result.isErr()) return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    return result.value;
  });

  // Grupos de um contato
  app.get('/contacts/:id/groups', {
    preHandler: [authenticate],
    schema: { description: 'Grupos de um contato', tags: ['Contact Groups'], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    // SA-013/G02: contato inexistente deve ser 404 idêntico ao negado, não 200 [].
    const [contactRow] = await db.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.id, id));
    if (!contactRow) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Contact not found' });
    }

    const sectorIds = await contactSectorIds(id);
    const contactAccess = await authorizeContactResource({
      actor: request.user,
      action: 'contacts:read',
      contact: { id, sectorIds },
      requiredLevel: 'read',
    });
    if (!contactAccess.allowed) {
      return reply.status(contactAccess.statusCode).send({ error: contactAccess.error, message: contactAccess.message });
    }

    const result = await useCases.getContactGroups(id);
    if (result.isErr()) return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    const visible = await filterGroupsByAccess(request.user, result.value);
    return reply.status(200).send(visible);
  });
}
