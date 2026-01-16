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
      ],
      thresholds: {
        lines: 35,
        functions: 55,
        branches: 60,
        statements: 35,
      },
    },
  },
})
