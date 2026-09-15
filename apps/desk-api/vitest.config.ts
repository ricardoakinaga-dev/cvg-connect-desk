import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/__tests__/helpers/**'],
    // Os testes de integração compartilham UM PostgreSQL do run (SA-003);
    // rodar arquivos em paralelo criava corridas de limpeza/efeitos entre
    // suítes (FKs de audit/alerts). Serializar por arquivo mantém o banco
    // determinístico sem reduzir cobertura.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/__tests__/**'],
    },
  },
});
