import { db, schema } from './index';
import { and, eq } from 'drizzle-orm';
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
      const [role] = await db
        .insert(schema.roles)
        .values({ name: roleName })
        .returning();
      console.log(`Created role: ${roleName}`);
    } else {
      console.log(`Role already exists: ${roleName}`);
    }
  }

  // 2. Criar permissões básicas
  const permissions = [
    { name: 'chat:read', description: 'Read chat messages' },
    { name: 'chat:write', description: 'Send messages' },
    { name: 'tasks:read', description: 'Read tasks' },
    { name: 'tasks:write', description: 'Create and update tasks' },
    { name: 'notes:read', description: 'Read notes' },
    { name: 'notes:write', description: 'Create notes' },
    { name: 'alerts:read', description: 'Read alerts' },
    { name: 'alerts:write', description: 'Acknowledge and resolve alerts' },
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

  // 3. Associate all permissions to Admin role
  const [adminRole] = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.name, 'Admin'))
    .limit(1);

  if (adminRole) {
    // Get all permission IDs
    const allPerms = await db.select().from(schema.permissions);
    for (const perm of allPerms) {
      const existing = await db
        .select()
        .from(schema.rolePermissions)
        .where(
          and(eq(schema.rolePermissions.roleId, adminRole.id), eq(schema.rolePermissions.permissionId, perm.id))
        )
        .limit(1);
      
      if (existing.length === 0) {
        await db
          .insert(schema.rolePermissions)
          .values({ roleId: adminRole.id, permissionId: perm.id });
        console.log(`Assigned permission ${perm.name} to Admin`);
      }
    }
  }

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
