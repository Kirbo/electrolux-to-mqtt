import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      thresholds: { lines: 90, functions: 90, branches: 80 },
      exclude: ['tests/**'],
    },
  },
})
