import { db, schema } from './index';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

async function seed() {
  console.log('Starting seed...');

  // 1. Criar roles
  const roles = ['Admin', 'Receptionist', 'Veterinarian', 'Manager'];
  
  for (const roleName of roles) {
    const existingRole = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.name, roleName))
      .limit(1);
    
    if (existingRole.length === 0) {
      await db
        .insert(schema.roles)
        .values({ name: roleName })
        .returning();
      console.log(`Created role: ${roleName}`);
    } else {
      console.log(`Role already exists: ${roleName}`);
    }
  }

  // 2. Criar permissões do catálogo vigente (PROD-04/AC3/D01).
  // Mesmos nomes do catálogo estático de packages/auth/src/rbac.ts e do
  // backfill idempotente da migration 0025 — nenhum nome novo é inventado.
  const permissions = [
    { name: 'chat:read', description: 'Read chat messages' },
    { name: 'chat:write', description: 'Send messages' },
    { name: 'chat:delete', description: 'Delete conversations/messages' },
    { name: 'tasks:read', description: 'Read tasks' },
    { name: 'tasks:write', description: 'Create and update tasks' },
    { name: 'tasks:delete', description: 'Delete tasks' },
    { name: 'notes:read', description: 'Read notes' },
    { name: 'notes:write', description: 'Create notes' },
    { name: 'notes:delete', description: 'Delete notes' },
    { name: 'alerts:read', description: 'Read alerts' },
    { name: 'alerts:write', description: 'Acknowledge and resolve alerts' },
    { name: 'alerts:delete', description: 'Delete alerts' },
    { name: 'dashboard:read', description: 'View dashboard' },
    { name: 'admin:read', description: 'Read admin resources' },
    { name: 'admin:write', description: 'Manage admin resources' },
    { name: 'audit:read', description: 'Read audit logs' },
  ];

  for (const perm of permissions) {
    const existing = await db
      .select()
      .from(schema.permissions)
      .where(eq(schema.permissions.name, perm.name))
      .limit(1);
    
    if (existing.length === 0) {
      await db
        .insert(schema.permissions)
        .values(perm)
        .returning();
      console.log(`Created permission: ${perm.name}`);
    } else {
      console.log(`Permission already exists: ${perm.name}`);
    }
  }

  // 3. Associar permissões aos papéis built-in conforme o catálogo estático
  // vigente (RolePermissions, packages/auth/src/rbac.ts). Idempotente: usa
  // ON CONFLICT DO NOTHING sobre a PK (role_id, permission_id), sem duplicar.
  const rolePermissionCatalog: Record<string, readonly string[]> = {
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

  const permissionRows = await db.select().from(schema.permissions);
  const permissionIdByName = new Map(permissionRows.map((permission) => [permission.name, permission.id]));

  for (const [roleName, permissionNames] of Object.entries(rolePermissionCatalog)) {
    const [role] = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.name, roleName))
      .limit(1);

    if (!role) {
      console.log(`Seed: papel built-in ausente — associações não aplicadas: ${roleName}`);
      continue;
    }

    let assigned = 0;
    for (const permissionName of permissionNames) {
      const permissionId = permissionIdByName.get(permissionName);
      if (!permissionId) {
        console.log(`Seed: permissão ausente no banco: ${permissionName}`);
        continue;
      }
      await db
        .insert(schema.rolePermissions)
        .values({ roleId: role.id, permissionId })
        .onConflictDoNothing();
      assigned += 1;
    }
    console.log(`Role ${roleName}: ${assigned} associações de permissão garantidas`);
  }

  const [adminRole] = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.name, 'Admin'))
    .limit(1);

  // 4. Criar admin user — APENAS em desenvolvimento/teste.
  // Em produção, usar ADMIN_BOOTSTRAP_EMAIL + ADMIN_BOOTSTRAP_PASSWORD via bootstrap dedicado.
  const nodeEnv = (process.env.NODE_ENV || process.env.DESK_ENV || 'development').toLowerCase();
  const isProduction = nodeEnv === 'production' || nodeEnv === 'prod';
  const bootstrapEmail = process.env.ADMIN_BOOTSTRAP_EMAIL;
  const bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const adminEmail = bootstrapEmail || 'admin@cvg.com';

  if (isProduction && (!bootstrapEmail || !bootstrapPassword)) {
    console.log('Seed: produção sem ADMIN_BOOTSTRAP_EMAIL/ADMIN_BOOTSTRAP_PASSWORD — nenhum admin criado (fail-secure).');
    console.log('Seed completed!');
    return;
  }

  if (bootstrapPassword && bootstrapPassword.length < 12) {
    throw new Error('Seed: ADMIN_BOOTSTRAP_PASSWORD deve ter ao menos 12 caracteres.');
  }
  const existingUser = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, adminEmail))
    .limit(1);

  if (existingUser.length === 0) {
    const defaultPassword = 'admin123';
    if (isProduction && !bootstrapPassword) {
      throw new Error('Seed: senha default proibida em produção.');
    }
    const passwordHash = await bcrypt.hash(bootstrapPassword || defaultPassword, 10);
    const [user] = await db
      .insert(schema.users)
      .values({
        name: 'Administrator',
        email: adminEmail,
        passwordHash,
        isActive: true,
      })
      .returning();
    console.log(`Created admin user: ${adminEmail}`);

    if (adminRole) {
      await db
        .insert(schema.userRoles)
        .values({
          userId: user.id,
          roleId: adminRole.id,
        });
      console.log(`Assigned Admin role to user`);
    }
  } else {
    console.log(`Admin user already exists: ${adminEmail}`);
  }

  console.log('Seed completed!');
}

seed().catch(console.error);
