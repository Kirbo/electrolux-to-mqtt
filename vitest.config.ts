import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      VITEST: 'true',
    },
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov', 'cobertura'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/types/',
        'tests/',
        'src/index.ts', // Main entry point (integration tested separately)
        'package.json',
      ],
      // Coverage thresholds set to maintain high test quality
      // Current coverage: ~80% statements/lines, ~65% branches, ~86% functions
      // Thresholds set slightly below current values to allow flexibility
      // Disabled for E2E tests which only test real API integration
      thresholds: {
        lines: 75,
        functions: 80,
        branches: 60,
        statements: 75,
      },
    },
  },
})
