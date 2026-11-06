import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'examples/vitest/test/**/*.test.ts', 'scripts/*.test.mjs'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      // lcov is what CI uploads to Codecov.
      reporter: ['text', 'lcov'],
      // A floor, from what the suite measured. It goes up, never down.
      thresholds: { statements: 80, branches: 70, functions: 80, lines: 82 },
    },
  },
});
