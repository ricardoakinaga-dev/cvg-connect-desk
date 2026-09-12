import 'dotenv/config';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';

const rootEnv = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || '4330',
  REALTIME_PORT: process.env.REALTIME_PORT || '4930',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:56379',
  VITE_API_URL: process.env.VITE_API_URL || 'http://localhost:4330',
  VITE_REALTIME_URL: process.env.VITE_REALTIME_URL || 'ws://localhost:4930',
  EVOLUTION_API_URL: process.env.EVOLUTION_API_URL || 'http://localhost:8082',
};

const children: ReturnType<typeof spawn>[] = [];
let shuttingDown = false;

function getRequiredDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      [
        '[e2e-stack] DATABASE_URL is required.',
        'Run `pnpm e2e:stack:up` first or create a .env with a local PostgreSQL URL.',
      ].join(' ')
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error(
      `[e2e-stack] DATABASE_URL is invalid: ${databaseUrl}. Expected a PostgreSQL connection string such as postgresql://user:pass@localhost:5432/db`
    );
  }

  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) {
    throw new Error(
      `[e2e-stack] DATABASE_URL must use the postgres/postgresql scheme. Received protocol "${parsed.protocol}".`
    );
  }

  if (!parsed.hostname) {
    throw new Error('[e2e-stack] DATABASE_URL must include a hostname for PostgreSQL.');
  }

  return parsed;
}

function spawnManaged(command: string, args: string[], label: string, extraEnv: NodeJS.ProcessEnv = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...rootEnv,
      ...extraEnv,
    },
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM') {
      console.error(`[e2e-stack] ${label} exited unexpectedly with code ${code ?? 'null'} signal ${signal ?? 'null'}`);
      shutdown(1);
    }
  });

  children.push(child);
  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    if (child.pid && !child.killed) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // Ignore missing process groups during shutdown.
      }
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (child.pid && !child.killed) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // Ignore lingering process groups during forced shutdown.
        }
      }
    }
    process.exit(exitCode);
  }, 1_000).unref();
}

async function runChecked(command: string, args: string[], label: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: rootEnv,
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

async function waitForHttp(url: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`Unexpected status ${response.status} for ${url}`);
    } catch (error) {
      lastError = error;
    }

    await delay(1_000);
  }

  throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for ${url}`);
}

async function waitForTcp(host: string, port: number, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port });
      socket.once('connect', () => {
        socket.end();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });

    if (connected) {
      return;
    }

    await delay(1_000);
  }

  throw new Error(`Timed out waiting for tcp://${host}:${port}`);
}

async function ensureBootstrapAdmin() {
  // E2E usa banco efêmero dedicado (smoke stack com volume descartado).
  // Credenciais parametrizáveis via env; defaults apenas para ambiente de teste isolado.
  const adminEmail = process.env.ADMIN_BOOTSTRAP_EMAIL || 'admin@cvg.com';
  const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD || 'admin123';
  const { default: bcrypt } = await import('bcryptjs');
  const adminPasswordHash = await bcrypt.hash(adminPassword, 10);

  let [adminRole] = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.name, 'Admin'))
    .limit(1);

  if (!adminRole) {
    [adminRole] = await db
      .insert(schema.roles)
      .values({ name: 'Admin', description: 'Administrator role for E2E smoke tests' })
      .returning();
  }

  let [adminUser] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, adminEmail))
    .limit(1);

  if (!adminUser) {
    [adminUser] = await db
      .insert(schema.users)
      .values({
        name: 'Administrator',
        email: adminEmail,
        passwordHash: adminPasswordHash,
        isActive: true,
      })
      .returning();
  } else {
    await db
      .update(schema.users)
      .set({
        name: 'Administrator',
        passwordHash: adminPasswordHash,
        isActive: true,
      })
      .where(eq(schema.users.id, adminUser.id));
  }

  const userRole = await db
    .select()
    .from(schema.userRoles)
    .where(and(eq(schema.userRoles.userId, adminUser.id), eq(schema.userRoles.roleId, adminRole.id)))
    .limit(1);

  if (userRole.length === 0) {
    await db.insert(schema.userRoles).values({
      userId: adminUser.id,
      roleId: adminRole.id,
    });
  }

  const activeSectors = await db
    .select({ id: schema.sectors.id })
    .from(schema.sectors)
    .where(eq(schema.sectors.isActive, true));

  for (const sector of activeSectors) {
    const existingAccess = await db
      .select()
      .from(schema.userSectors)
      .where(and(eq(schema.userSectors.userId, adminUser.id), eq(schema.userSectors.sectorId, sector.id)))
      .limit(1);

    if (existingAccess.length === 0) {
      await db.insert(schema.userSectors).values({
        userId: adminUser.id,
        sectorId: sector.id,
        accessLevel: 'admin',
      });
    }
  }
}

async function main() {
  const shutdownHandler = () => shutdown(0);
  process.on('SIGINT', shutdownHandler);
  process.on('SIGTERM', shutdownHandler);
  process.on('uncaughtException', error => {
    console.error('[e2e-stack] Uncaught exception:', error);
    shutdown(1);
  });
  process.on('unhandledRejection', error => {
    console.error('[e2e-stack] Unhandled rejection:', error);
    shutdown(1);
  });

  const databaseUrl = getRequiredDatabaseUrl();
  console.log(
    `[e2e-stack] Using PostgreSQL at ${databaseUrl.hostname}:${databaseUrl.port || '5432'} from DATABASE_URL`
  );

  console.log('[e2e-stack] Starting Evolution API mock');
  spawnManaged('pnpm', ['exec', 'tsx', 'e2e/support/mock-evolution-server.ts'], 'e2e-mock-evolution', {
    EVOLUTION_MOCK_PORT: '8082',
  });
  await waitForHttp('http://localhost:8082/health');

  console.log('[e2e-stack] Applying migrations');
  try {
    await runChecked('pnpm', ['--filter', '@cvg/database', 'db:migrate'], 'database migrations');
  } catch (error) {
    throw new Error(
      [
        '[e2e-stack] database migrations failed.',
        'Confirm the smoke infra is up with `pnpm e2e:stack:up` and that DATABASE_URL points to the local smoke PostgreSQL.',
      ].join(' '),
      { cause: error as Error }
    );
  }

  console.log('[e2e-stack] Ensuring admin smoke user');
  await ensureBootstrapAdmin();

  console.log('[e2e-stack] Starting desk-api');
  spawnManaged('pnpm', ['--filter', '@cvg/desk-api', 'exec', 'tsx', 'src/index.ts'], 'desk-api');
  await waitForHttp('http://localhost:4330/health');

  console.log('[e2e-stack] Starting realtime-service');
  spawnManaged('pnpm', ['--filter', '@cvg/realtime-service', 'exec', 'tsx', 'src/index.ts'], 'realtime-service');
  await waitForTcp('localhost', 4930);

  console.log('[e2e-stack] Starting desk-web');
  spawnManaged('pnpm', ['--filter', '@cvg/desk-web', 'exec', 'vite', '--host', '0.0.0.0', '--port', '4173'], 'desk-web');
  await waitForHttp('http://localhost:4173/login');

  console.log('[e2e-stack] E2E stack ready');

  await new Promise<void>(() => {});
}

main().catch((error) => {
  console.error('[e2e-stack] Failed to start stack:', error);
  shutdown(1);
});
