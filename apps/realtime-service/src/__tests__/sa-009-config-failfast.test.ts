import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * SA-009/AC1 — configuração ausente falha CEDO, com mensagem sem segredo.
 *
 * Executa um subprocesso que importa `@cvg/database` em NODE_ENV=production sem
 * DATABASE_URL. O processo deve encerrar com código != 0 e explicar a variável
 * ausente, sem imprimir credenciais.
 */
describe('SA-009 — fail-fast de configuração do banco', () => {
  const repoRoot = resolve(__dirname, '../../../..');

  it('NODE_ENV=production sem DATABASE_URL encerra com erro claro', () => {
    const env = { ...process.env, NODE_ENV: 'production' };
    delete env.DATABASE_URL;
    const result = spawnSync(
      'pnpm',
      ['exec', 'tsx', '-e', "import '@cvg/database'; console.log('SHOULD_NOT_REACH');"],
      { cwd: repoRoot, encoding: 'utf8', env, timeout: 60_000 },
    );

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(result.status).not.toBe(0);
    expect(output).toContain('DATABASE_URL ausente');
    expect(output).not.toContain('SHOULD_NOT_REACH');
    expect(output).not.toMatch(/postgresql:\/\/[^:]+:[^@]+@/);
  });

  it('NODE_ENV=test mantém o fallback de desenvolvimento', () => {
    const env = { ...process.env, NODE_ENV: 'test' };
    delete env.DATABASE_URL;
    const result = spawnSync(
      'pnpm',
      ['exec', 'tsx', '-e', "import '@cvg/database'; console.log('FALLBACK_OK');"],
      { cwd: repoRoot, encoding: 'utf8', env, timeout: 60_000 },
    );

    expect(result.status).toBe(0);
    expect(`${result.stdout ?? ''}${result.stderr ?? ''}`).toContain('FALLBACK_OK');
  });
});
