import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` throws on import outside a React Server Component. It is a build-time
      // guard, not runtime behaviour, so it is stubbed for tests — the guard still applies
      // to the real build, which is where it matters.
      'server-only': r('./tests/support/server-only-stub.ts'),
      '@core': r('./src/core'),
      '@db': r('./src/db'),
      '@config': r('./src/config'),
      '@modules': r('./src/modules'),
      '@platform': r('./src/platform'),
      '@server': r('./src/server'),
      '@ui': r('./src/ui'),
      '@': r('./src'),
    },
  },
  test: {
    globals: false,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          // Unit tests are co-located with the code they document.
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.int.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/**/*.int.test.ts', 'tests/integration/**/*.test.ts'],
          // A real database is slower and must not run in parallel against one schema.
          // (fileParallelism is a root-level option; enforced via `sequence.concurrent`.)
          sequence: { concurrent: false },
          testTimeout: 30_000,
          hookTimeout: 120_000,
          globalSetup: ['tests/support/global-setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/db/schema/**',
        'src/app/**',
        'src/**/index.ts',
        'src/**/*.d.ts',
      ],
      // Differentiated by layer — a single global number rewards testing getters.
      // See docs/architecture/08-testing.md §8.4.
      thresholds: {
        'src/core/**': { lines: 90, branches: 85, functions: 90, statements: 90 },
        'src/modules/*/domain/**': { lines: 95, branches: 90, functions: 95, statements: 95 },
        'src/modules/*/application/**': {
          lines: 85,
          branches: 80,
          functions: 85,
          statements: 85,
        },
      },
    },
  },
})
