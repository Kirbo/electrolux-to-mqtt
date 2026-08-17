---
name: dep-vitest-domock-race
description: vitest 4 — vi.doMock + dynamic import is racy; use one vi.hoisted mutable mock object instead
metadata: 
  node_type: memory
  type: project
  originSessionId: e47e8080-7ddc-47fb-af08-acb5e9a74409
  modified: 2026-07-24T18:52:30.469Z
---

Under vitest 4 (hit on 4.1.10, July 2026), the pattern `vi.resetModules()` + `vi.doMock('@/config.js', factory)` + `await import('@/module.js')` intermittently resolves the *previously* registered factory instead of the new one — ~75% failure rate running `tests/health.test.ts` alone, but usually passing inside the full suite, so it surfaced first in CI (pipeline #785 blocked the otherwise-successful beta release).

**Why:** doMock registration vs dynamic-import module-graph resolution is order-sensitive in the vitest 4 module runner; re-registering different factories for the same module across tests makes which factory wins timing-dependent.

**How to apply:** don't juggle per-test `vi.doMock` factories. Register ONE `vi.mock` whose factory returns a `vi.hoisted()` mutable object; tests mutate fields (e.g. `mockConfig.default.healthCheck.enabled = false`), call `vi.resetModules()`, then dynamic-import. Restore values in `afterEach`. See tests/health.test.ts (commit 69760f8). Diagnose suspected flakes by running the single file in a loop ~10x — full-suite runs can mask them.
