import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@/': fileURLToPath(new URL('./src/', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    env: {
      VITEST: 'true',
      LOG_LEVEL: 'silent',
    },
    setupFiles: ['./vitest.setup.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'telemetry-backend/**', // Separate package — run via `cd telemetry-backend && pnpm test`
    ],
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
        'telemetry-backend/**', // Separate package with its own test suite
        'package.json',
      ],
      // Thresholds locked at slightly below current measured coverage so a
      // regression (deleted test, weakened assertion) trips CI fast. Bump these
      // when coverage genuinely improves; don't lower for "flexibility" — that
      // re-introduces the slow-drift slack that caused the earlier 80% branch
      // floor to mask gains. E2E tests run separately and are excluded.
      thresholds: {
        lines: 96,
        functions: 96,
        branches: 90,
        statements: 96,
      },
    },
  },
})
