---
name: dep_subpath_imports_braces
description: tsc-alias dropped for Node subpath imports (#/*) to remove the unfixable braces GHSA-vfj7-8cjw-p6xm tree; how the conditions wiring works
metadata:
  type: project
---

2026-10-05: `braces` GHSA-vfj7-8cjw-p6xm (high) had no patched release (3.0.3 is latest, unmaintained since 2024). Its only path was devDep `tsc-alias` → chokidar 3 / globby 11 → fast-glob → micromatch → braces, and the CI `audit` job hard-fails on it. We removed tsc-alias instead of ignoring the advisory. The `@/*` tsconfig `paths` alias became Node subpath imports:

- `package.json` `"imports": {"#/*": {"development": "./src/*", "default": "./dist/*"}}`. Prod `node dist/index.js` takes `default`. That needs `package.json` next to `dist/`, which the prod image already copies.
- `tsconfig.json` `customConditions: ["development"]`. TS can map `dist`→`src` on its own, but `tsconfig.tests.json` overrides `rootDir: "."`, which breaks that mapping, so the explicit condition is required.
- `pnpm dev` = `tsx watch --conditions=development …`. The flag must come **after** `watch` (`tsx --conditions=… watch` treats `watch` as a file). Without the flag, tsx resolves `#/` to `dist/` and loads stale or missing builds.
- vitest keeps a plain `'#/'` → `src/` alias.

**Why:** a vulnerable dev-only transitive with no fix still blocks CI. Removing the dependency was cleaner than an ignore entry with an expiry date.

**How to apply:** anything that runs `src/` directly (new scripts, the `docker-build-test.sh` local smoke override) must pass `--conditions=development`. `pnpm docker:test local` caught the stale smoke command. Never re-add a path-alias rewriter.
