import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    testTimeout: 30_000,
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*'],
      // App/main/ErrorBoundary are composition/bootstrap seams exercised by the
      // browser smoke suite; page and API behavior remains in this unit gate.
      exclude: [
        'src/**/*.d.ts',
        'src/__tests__/**',
        'src/App.tsx',
        'src/main.tsx',
        'src/components/ErrorBoundary.tsx',
        'src/components/layout/Layout.tsx',
      ],
    },
  },
});
