import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['packages/*/test/**/*.test.ts', 'examples/vitest/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      reporter: ['text'],
      // A floor, from what the suite measured. It goes up, never down.
      thresholds: { statements: 80, branches: 70, functions: 80, lines: 82 },
    },
  },
})
