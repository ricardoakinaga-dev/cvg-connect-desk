import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    hookTimeout: 30_000,
    include: ['src/**/*.test.ts'],
    exclude: ['src/__tests__/helpers/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/__tests__/**'],
    },
  },
});
