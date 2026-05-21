---
name: vuln-ws-GHSA-58qx-3vcg-4xpx
description: ws uninitialized memory disclosure fixed via pnpm.overrides in package.json
metadata:
  type: project
---

ws@<8.20.1 has uninitialized memory disclosure (GHSA-58qx-3vcg-4xpx, moderate). Transitive via `mqtt>ws`.

Fix applied May 2026: added `pnpm.overrides.ws = ">=8.20.1"` to root `package.json`. ws@8.20.1 is the patched version.

**Why:** mqtt's declared dep `^8.18.3` resolved to 8.20.0 (vulnerable) in lockfile; direct upgrade of mqtt not possible since latest mqtt still uses same constraint.

**How to apply:** Keep override in place until mqtt bumps its dep floor past 8.20.1 and lockfile naturally resolves to >=8.20.1. Then remove the override.
