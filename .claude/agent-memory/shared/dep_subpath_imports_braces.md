---
name: dep_subpath_imports_braces
description: Node runs src/*.ts natively (no build, no tsx); #/* subpath imports map straight to ./src/*; history of why tsc-alias was dropped
metadata:
  type: project
---

**Current (since 2026-11-04):** no compile step. Node 26 strips types itself, so prod runs `node src/index.ts` (prod Dockerfile copies `src/`, HEALTHCHECK imports `./src/health.ts`), `pnpm dev` = `node --watch src/index.ts`, and `tsc` only type-checks (`noEmit`). `package.json` `"imports": {"#/*": "./src/*"}`, so no `development` condition is needed anywhere. tsx and the `build` script are gone.

Constraints that keep `node src/*.ts` working (all enforced by tsconfig):
- `erasableSyntaxOnly` — no enums, namespaces, or constructor parameter properties (a `private readonly x` parameter throws at runtime under type stripping; declare fields and assign them).
- `allowImportingTsExtensions` — relative and `#/` imports name the real file: `./mqtt.ts`, and `#/types.d.ts` for the raw API types (type-only import).
- `verbatimModuleSyntax` — type-only imports must be `import type`; Node erases those, a plain import of a type would fail at load.

**History:** 2026-10-05 `braces` GHSA-vfj7-8cjw-p6xm (no fix) came only via devDep `tsc-alias`; it was removed and the `@/*` paths alias became subpath imports with a `development` condition (src) vs `default` (dist). Native execution made the condition and dist redundant.

**How to apply:** never re-add a path-alias rewriter or a build step for `src/`. Anything that runs the bridge (scripts, smoke tests) runs `node src/index.ts`. `pnpm docker:test` is the check that a file is missing from the image.
