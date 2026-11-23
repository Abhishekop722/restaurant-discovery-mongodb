import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/server.ts', 'src/infra/seed/cli.ts'],
      reporter: ['text', 'json-summary'],
      // measured across unit + integration; raise as the code grows, never lower to get green
      thresholds: { lines: 85, statements: 85, functions: 85, branches: 80 },
    },
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['test/unit/**/*.test.ts'] },
      },
      {
        // needs Docker: one real MongoDB container shared by all integration tests
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          globalSetup: ['test/integration/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
