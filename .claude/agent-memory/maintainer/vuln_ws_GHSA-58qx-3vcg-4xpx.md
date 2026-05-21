---
name: vuln-ws-GHSA-58qx-3vcg-4xpx
description: ws uninitialized memory disclosure fixed via pnpm-workspace.yaml overrides (not package.json)
metadata:
  type: project
---

ws@<8.20.1 has uninitialized memory disclosure (GHSA-58qx-3vcg-4xpx, moderate). Transitive via `mqtt>ws`.

Fix applied May 2026: `overrides.ws = ">=8.20.1"` in both `pnpm-workspace.yaml` (root) and `telemetry-backend/pnpm-workspace.yaml`. ws@8.20.1 is the patched version.

**Why:** mqtt's declared dep `^8.18.3` resolved to vulnerable version in lockfile; direct upgrade of mqtt not possible since latest mqtt still uses same constraint. pnpm.overrides in package.json was deprecated/ignored in pnpm 11 — migrated to pnpm-workspace.yaml in commit 21009b8 (May 2026).

**How to apply:** Keep override in place until mqtt bumps its dep floor past 8.20.1 and lockfile naturally resolves to >=8.20.1. Then remove from both pnpm-workspace.yaml files. Check: `grep '"ws"' node_modules/mqtt/package.json`.
