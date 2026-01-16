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
      reporter: ['text', 'json', 'html', 'cobertura'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/types/',
        'tests/',
        'src/init.ts', // Initialization script
        'src/index.ts', // Main entry point (integration tested separately)
        'package.json',
      ],
      // Coverage thresholds balanced for mixed legacy + new code
      // - Legacy code (electrolux.ts, mqtt.ts): lower coverage expected
      // - New code (appliances/*): comprehensive test coverage (85%+)
      // - Overall: baseline to prevent regression
      thresholds: {
        lines: 35,
        functions: 50,
        branches: 35,
        statements: 35,
      },
    },
  },
})
