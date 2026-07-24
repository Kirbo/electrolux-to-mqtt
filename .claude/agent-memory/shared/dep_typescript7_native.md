---
name: dep-typescript7-native
description: TypeScript 7 (native/Go compiler) adopted 2026-07-24 — what to re-verify on future TS bumps
metadata: 
  node_type: memory
  type: project
  originSessionId: e47e8080-7ddc-47fb-af08-acb5e9a74409
  modified: 2026-07-24T18:44:12.364Z
---

TypeScript 7 is the native (Go-port, "tsgo") compiler rewrite. 7.0.2 was adopted in both `package.json` files on 2026-07-24, the day it hit npm, after full local verification passed on first try: both root tsconfigs (`tsconfig.json` + `tsconfig.tests.json`), `pnpm build` (`tsc && tsc-alias` — alias rewriting confirmed in `dist/`), root + backend test suites, and `telemetry-backend` `tsconfig.build.json`.

**Why:** ships per-platform static Go binaries as optional/regular deps (`@typescript/typescript-linux-x64`, `-linux-arm64`, …) — no cgo/glibc dependency, so Alpine (musl) Docker builds work like esbuild's binaries do. tsc-alias 1.9.1 works unchanged (it post-processes emitted JS, no TS API dependency).

**How to apply:** on future TS majors, re-verify the same checklist: both root tsconfigs, tsc-alias output, backend build, and Docker CI (multi-arch needs linux-x64 + linux-arm64 binaries present in the lockfile). Related: [[dep-atypes-node-pin]] (@types/node stays pinned to the Node runtime major regardless of TS version).
