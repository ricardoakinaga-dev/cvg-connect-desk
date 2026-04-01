import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@cvg/database': path.resolve(__dirname, '../../packages/database/src/index.ts'),
      '@cvg/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@cvg/auth': path.resolve(__dirname, '../auth/src/index.ts'),
    },
  },
});
