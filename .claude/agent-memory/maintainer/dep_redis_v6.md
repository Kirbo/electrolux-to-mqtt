---
name: redis-v6-upgrade
description: redis v5→v6 in telemetry-backend: RESP3 default, no API changes needed in RedisLike adapter
type: feedback
---

redis v6.0.0 (2026-06) changes default protocol from RESP2 to RESP3. The `RedisLike` adapter
in `telemetry-backend/src/index.ts` wraps the client behind a narrow interface — all methods
(`get`, `set`, `setEx`, `scanIterator`, `eval`, `quit`) work unchanged under RESP3. Type guards
already in place cover the `eval` return type.

Breaking changes in v6: RESP3 default, Node.js >=20 min, `commandTimeout` now defaults to 5000ms,
`keepAliveInitialDelay` now 30s.

**Why:** RESP3 changes reply shapes for some commands (geo, streams, search) but not the basic
string/number ops used by this codebase. The adapter's type isolation means the app surface was
not affected.

**How to apply:** No code changes needed for v5→v6. If ever re-adding geo/stream commands,
check RESP3 reply shape changes. To pin RESP2 explicitly, add `RESP: 2` to `createClient()` options.
Commit type for telemetry-backend-only dep bumps is `chore:` (non-bumping), not `chore(deps):`.
