import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { RunContext } from './run-context.ts';

export interface BenchmarkProfile {
  id: string;
  frozenAt: string;
  dataset: {
    contacts: number;
    conversations: number;
    messagesPerConversation: number;
    sectors: number;
  };
  device: {
    name: string;
    cpuThrottle: number;
    memoryGb: number;
  };
  network: {
    name: string;
    latencyMs: number;
    downloadKbps: number | null;
    uploadKbps: number | null;
  };
  vitals: {
    lcpMs: number;
    inpMs: number;
    cls: number;
    jsInitialGzipKib: number;
    cssGzipKib: number;
  };
}

export const BENCHMARK_PROFILE: BenchmarkProfile = {
  id: 'cvg-aaa-bench-v1',
  frozenAt: '2026-09-12',
  dataset: {
    contacts: 200,
    conversations: 50,
    messagesPerConversation: 100,
    sectors: 2,
  },
  device: {
    name: 'Desktop Chrome (Playwright), 4x CPU throttle',
    cpuThrottle: 4,
    memoryGb: 8,
  },
  network: {
    name: 'loopback local, sem throttling de rede',
    latencyMs: 0,
    downloadKbps: null,
    uploadKbps: null,
  },
  vitals: {
    lcpMs: 2500,
    inpMs: 200,
    cls: 0.1,
    jsInitialGzipKib: 120,
    cssGzipKib: 25,
  },
};

export interface FixtureIds {
  sectorA: string;
  sectorB: string;
  adminUser: string;
  agentA: string;
  agentB: string;
  outsider: string;
  contactA: string;
  contactB: string;
  conversationA: string;
  conversationB: string;
  conversationNoSector: string;
  sessionAdmin: string;
  sessionAgentA: string;
  sessionAgentB: string;
}

export const FIXTURE_IDS: FixtureIds = {
  sectorA: '11111111-1111-4111-8111-1111111111a1',
  sectorB: '11111111-1111-4111-8111-1111111111b1',
  adminUser: '22222222-2222-4222-8222-2222222222a1',
  agentA: '22222222-2222-4222-8222-2222222222a2',
  agentB: '22222222-2222-4222-8222-2222222222b2',
  outsider: '22222222-2222-4222-8222-222222222203',
  contactA: '33333333-3333-4333-8333-3333333333a1',
  contactB: '33333333-3333-4333-8333-3333333333b1',
  conversationA: '44444444-4444-4444-8444-4444444444a1',
  conversationB: '44444444-4444-4444-8444-4444444444b1',
  conversationNoSector: '44444444-4444-4444-8444-4444444444c1',
  sessionAdmin: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  sessionAgentA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  sessionAgentB: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
};

export const FIXTURE_TOKENS = {
  admin: 'aaa-fixture-admin-token-0001',
  agentA: 'aaa-fixture-agent-a-token-0002',
  agentB: 'aaa-fixture-agent-b-token-0003',
};

export const FIXTURE_PASSWORDS = {
  admin: 'aaa-admin-password',
  agentA: 'aaa-agent-a-password',
  agentB: 'aaa-agent-b-password',
};

export function deterministicUuid(kind: string, index: number): string {
  const hex = createHash('sha1').update(`cvg-aaa-bench:${kind}:${index}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface SeedSummary {
  profile: 'minimal' | 'benchmark';
  counts: Record<string, number>;
}

async function databaseModule(ctx: RunContext) {
  process.env.DATABASE_URL = ctx.databaseUrl;
  // Resolucao relativa ao repo: e2e/ nao e workspace package e o host nao
  // hoista @cvg/*; import bare falharia fora dos pacotes do workspace.
  const module = await import('../../../packages/database/src/index.ts');
  return module as typeof import('../../../packages/database/src/index');
}

export async function seedMinimalFixture(ctx: RunContext): Promise<SeedSummary> {
  const { db, schema } = await databaseModule(ctx);
  const { eq, and } = await import('drizzle-orm');
  // bcryptjs e dependencia do pacote database, nao do root; resolve ancorado
  // no workspace para funcionar fora dos pacotes (e2e/ nao e workspace package).
  const requireFromDatabase = createRequire(join(ctx.repoRoot, 'packages', 'database', 'package.json'));
  const bcrypt = requireFromDatabase('bcryptjs') as { hash(data: string, salt: number): Promise<string> };
  const ids = FIXTURE_IDS;

  const now = Date.now();
  const future = new Date(now + 30 * 24 * 60 * 60 * 1000);
  const idleDeadline = new Date(now + 24 * 60 * 60 * 1000);
  const tokenHash = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

  await db.insert(schema.sectors).values([
    { id: ids.sectorA, name: 'Setor A (fixture)', code: 'AAA-A', color: '#4361ee', icon: '🅰' },
    { id: ids.sectorB, name: 'Setor B (fixture)', code: 'AAA-B', color: '#e63946', icon: '🅱' },
  ]).onConflictDoNothing();

  const adminHash = await bcrypt.hash(FIXTURE_PASSWORDS.admin, 4);
  const agentAHash = await bcrypt.hash(FIXTURE_PASSWORDS.agentA, 4);
  const agentBHash = await bcrypt.hash(FIXTURE_PASSWORDS.agentB, 4);

  await db.insert(schema.users).values([
    { id: ids.adminUser, name: 'AAA Admin', email: 'aaa-admin@cvg.test', passwordHash: adminHash, isActive: true },
    { id: ids.agentA, name: 'AAA Agente A', email: 'aaa-agente-a@cvg.test', passwordHash: agentAHash, isActive: true },
    { id: ids.agentB, name: 'AAA Agente B', email: 'aaa-agente-b@cvg.test', passwordHash: agentBHash, isActive: true },
    { id: ids.outsider, name: 'AAA Sem Setor', email: 'aaa-sem-setor@cvg.test', passwordHash: agentAHash, isActive: true },
  ]).onConflictDoNothing();

  for (const roleName of ['Admin', 'Agent']) {
    await db.insert(schema.roles).values({ name: roleName, description: `Fixture role ${roleName}` }).onConflictDoNothing();
  }

  const [adminRole] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'Admin')).limit(1);
  const [agentRole] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'Agent')).limit(1);

  if (adminRole && agentRole) {
    await db.insert(schema.userRoles).values([
      { userId: ids.adminUser, roleId: adminRole.id },
      { userId: ids.agentA, roleId: agentRole.id },
      { userId: ids.agentB, roleId: agentRole.id },
      { userId: ids.outsider, roleId: agentRole.id },
    ]).onConflictDoNothing();
  }

  await db.insert(schema.userSectors).values([
    { userId: ids.adminUser, sectorId: ids.sectorA, accessLevel: 'admin' },
    { userId: ids.adminUser, sectorId: ids.sectorB, accessLevel: 'admin' },
    { userId: ids.agentA, sectorId: ids.sectorA, accessLevel: 'write' },
    { userId: ids.agentB, sectorId: ids.sectorB, accessLevel: 'write' },
  ]).onConflictDoNothing();

  await db.insert(schema.sessions).values([
    {
      id: ids.sessionAdmin,
      userId: ids.adminUser,
      token: tokenHash(FIXTURE_TOKENS.admin),
      tokenHash: tokenHash(FIXTURE_TOKENS.admin),
      lastSeenAt: new Date(now),
      expiresAt: idleDeadline,
      absoluteExpiresAt: future,
    },
    {
      id: ids.sessionAgentA,
      userId: ids.agentA,
      token: tokenHash(FIXTURE_TOKENS.agentA),
      tokenHash: tokenHash(FIXTURE_TOKENS.agentA),
      lastSeenAt: new Date(now),
      expiresAt: idleDeadline,
      absoluteExpiresAt: future,
    },
    {
      id: ids.sessionAgentB,
      userId: ids.agentB,
      token: tokenHash(FIXTURE_TOKENS.agentB),
      tokenHash: tokenHash(FIXTURE_TOKENS.agentB),
      lastSeenAt: new Date(now),
      expiresAt: idleDeadline,
      absoluteExpiresAt: future,
    },
  ]).onConflictDoNothing();

  const [tutor] = await db.insert(schema.tutors)
    .values({ id: deterministicUuid('tutor', 1), name: 'Tutor Fixture A', phone: '+5511900000001' })
    .onConflictDoNothing()
    .returning();

  await db.insert(schema.patients)
    .values({ id: deterministicUuid('patient', 1), name: 'Paciente Fixture A', species: 'canino', tutorId: tutor?.id })
    .onConflictDoNothing();

  await db.insert(schema.contacts).values([
    { id: ids.contactA, externalId: 'aaa-contact-a', phone: '+5511900000011', name: 'Contato Setor A' },
    { id: ids.contactB, externalId: 'aaa-contact-b', phone: '+5511900000012', name: 'Contato Setor B' },
  ]).onConflictDoNothing();

  await db.insert(schema.contactSectors).values([
    { contactId: ids.contactA, sectorId: ids.sectorA },
    { contactId: ids.contactB, sectorId: ids.sectorB },
  ]).onConflictDoNothing();

  await db.insert(schema.conversations).values([
    {
      id: ids.conversationA,
      contactId: ids.contactA,
      sectorId: ids.sectorA,
      assignedUserId: ids.agentA,
      status: 'open',
      currentHandler: 'human',
      externalConversationId: 'aaa-conv-a',
    },
    {
      id: ids.conversationB,
      contactId: ids.contactB,
      sectorId: ids.sectorB,
      assignedUserId: ids.agentB,
      status: 'open',
      currentHandler: 'human',
      externalConversationId: 'aaa-conv-b',
    },
    {
      id: ids.conversationNoSector,
      contactId: ids.contactA,
      assignedUserId: null,
      status: 'pending',
      currentHandler: 'bot',
      externalConversationId: 'aaa-conv-nosector',
    },
  ]).onConflictDoNothing();

  await db.insert(schema.messages).values([
    { id: deterministicUuid('message', 1), conversationId: ids.conversationA, direction: 'inbound', content: '[fixture] inbound A1', sender: '+5511900000011', status: 'delivered', externalMessageId: 'aaa-msg-a1' },
    { id: deterministicUuid('message', 2), conversationId: ids.conversationA, direction: 'outbound', content: '[fixture] outbound A2', senderType: 'agent', status: 'sent', externalMessageId: 'aaa-msg-a2' },
    { id: deterministicUuid('message', 3), conversationId: ids.conversationB, direction: 'inbound', content: '[fixture] inbound B1', sender: '+5511900000012', status: 'delivered', externalMessageId: 'aaa-msg-b1' },
  ]).onConflictDoNothing();

  const counts = {
    sectors: Number((await db.select().from(schema.sectors)).length),
    users: Number((await db.select().from(schema.users)).length),
    contacts: Number((await db.select().from(schema.contacts)).length),
    conversations: Number((await db.select().from(schema.conversations)).length),
    messages: Number((await db.select().from(schema.messages)).length),
  };

  void and;
  return { profile: 'minimal', counts };
}

export async function seedBenchmarkDataset(ctx: RunContext): Promise<SeedSummary> {
  const { db, schema } = await databaseModule(ctx);
  const profile = BENCHMARK_PROFILE;

  await seedMinimalFixture(ctx);

  const contactBatch: Array<typeof schema.contacts.$inferInsert> = [];
  const conversationBatch: Array<typeof schema.conversations.$inferInsert> = [];
  const messageBatch: Array<typeof schema.messages.$inferInsert> = [];

  for (let i = 0; i < profile.dataset.contacts; i += 1) {
    contactBatch.push({
      id: deterministicUuid('bench-contact', i),
      externalId: `bench-contact-${i}`,
      phone: `+55119${String(90000000 + i).padStart(8, '0')}`,
      name: `Bench Contact ${i}`,
    });
  }

  for (let i = 0; i < profile.dataset.conversations; i += 1) {
    const conversationId = deterministicUuid('bench-conversation', i);
    conversationBatch.push({
      id: conversationId,
      contactId: deterministicUuid('bench-contact', i % profile.dataset.contacts),
      sectorId: i % 2 === 0 ? FIXTURE_IDS.sectorA : FIXTURE_IDS.sectorB,
      status: 'open',
      currentHandler: 'bot',
      externalConversationId: `bench-conv-${i}`,
    });

    for (let m = 0; m < profile.dataset.messagesPerConversation; m += 1) {
      messageBatch.push({
        id: deterministicUuid(`bench-message-${i}`, m),
        conversationId,
        direction: m % 2 === 0 ? 'inbound' : 'outbound',
        content: `[bench] conversation ${i} message ${m} ${'lorem ipsum dolor sit amet '.repeat(4)}`.slice(0, 480),
        status: 'delivered',
        externalMessageId: `bench-msg-${i}-${m}`,
      });
    }
  }

  const batchSize = 500;
  for (let i = 0; i < contactBatch.length; i += batchSize) {
    await db.insert(schema.contacts).values(contactBatch.slice(i, i + batchSize)).onConflictDoNothing();
  }
  for (let i = 0; i < conversationBatch.length; i += batchSize) {
    await db.insert(schema.conversations).values(conversationBatch.slice(i, i + batchSize)).onConflictDoNothing();
  }
  for (let i = 0; i < messageBatch.length; i += batchSize) {
    await db.insert(schema.messages).values(messageBatch.slice(i, i + batchSize)).onConflictDoNothing();
  }

  return {
    profile: 'benchmark',
    counts: {
      contacts: contactBatch.length,
      conversations: conversationBatch.length,
      messages: messageBatch.length,
    },
  };
}

export async function seedFixtureByProfile(ctx: RunContext): Promise<SeedSummary> {
  const profile = (process.env.AAA_FIXTURE_PROFILE || 'minimal').toLowerCase();
  if (profile === 'benchmark') {
    return await seedBenchmarkDataset(ctx);
  }
  if (profile !== 'minimal') {
    throw new Error(`AAA_FIXTURE_PROFILE invalido: "${profile}" (use minimal|benchmark).`);
  }
  return await seedMinimalFixture(ctx);
}
