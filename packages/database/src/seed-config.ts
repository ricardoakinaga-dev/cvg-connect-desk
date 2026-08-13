const DEFAULT_ADMIN_EMAIL = 'admin@cvg.com';
const DEFAULT_ADMIN_PASSWORD = 'admin123';

export interface SeedAdminCredentials {
  email: string;
  password: string;
}

export function resolveSeedAdminCredentials(
  environment: Record<string, string | undefined> = process.env,
): SeedAdminCredentials {
  const email = (environment.SEED_ADMIN_EMAIL || environment.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = environment.SEED_ADMIN_PASSWORD || environment.ADMIN_PASSWORD || '';

  if (!email || !password) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required to run the database seed');
  }

  if (email === DEFAULT_ADMIN_EMAIL || password === DEFAULT_ADMIN_PASSWORD) {
    throw new Error('Default bootstrap credentials are not allowed; provide rotated seed credentials');
  }

  if (!email.includes('@') || password.length < 12) {
    throw new Error('SEED_ADMIN_EMAIL must be valid and SEED_ADMIN_PASSWORD must have at least 12 characters');
  }

  return { email, password };
}
