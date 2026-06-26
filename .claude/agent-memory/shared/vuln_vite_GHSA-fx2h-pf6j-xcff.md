---
name: vuln-vite-GHSA-fx2h-pf6j-xcff
description: vite vulns GHSA-fx2h-pf6j-xcff (high) + GHSA-v6wh-96g9-6wx3 (moderate) — fixed in telemetry-backend by adding vite as direct devDep
metadata:
  type: project
---

Fixed vite GHSA-fx2h-pf6j-xcff (server.fs.deny bypass, high) + GHSA-v6wh-96g9-6wx3 (NTLMv2 hash via launch-editor, moderate) in `telemetry-backend/`.

Root package was unaffected (already had vite@^8.0.16 as direct dep).

**Why override in pnpm-workspace.yaml didn't work:** vite is a *peer dependency* of vitest (not a transitive dep). pnpm overrides only apply to direct/transitive resolution, not peer dep resolution. The override was in the workspace file but pnpm still resolved vite@8.0.8.

**Fix:** Added `vite: "^8.0.16"` as direct devDependency in `telemetry-backend/package.json`. This forces vitest's peer dep to resolve to >=8.0.16. The vite-as-override-in-workspace-yaml approach was cleaned up (comment removed).

Remove once vitest bumps its own vite dep floor past 8.0.15.
