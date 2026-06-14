---
name: Adding a pnpm override requires pnpm-workspace.yaml in every Dockerfile prod stage
description: New overrides break frozen --prod installs unless each Dockerfile production stage also COPYs pnpm-workspace.yaml
metadata:
  type: project
---

pnpm `overrides` live in `pnpm-workspace.yaml` (pnpm v9+), and a frozen install compares the lockfile's recorded overrides against the current config. Any Dockerfile **production** stage that runs `pnpm install --frozen-lockfile` must therefore COPY `pnpm-workspace.yaml` alongside `package.json` + `pnpm-lock.yaml`, or it fails:

```
ERR_PNPM_LOCKFILE_CONFIG_MISMATCH: The current "overrides" configuration doesn't match the value found in the lockfile
```

The builder stage usually copies the whole dir so it has the file; the slim prod stage cherry-picks manifests and can miss it. The gap is latent until the *first* override is added.

**Why:** the [[vuln_esbuild_GHSA-gv7w-rqvm-qjhr]] override (esbuild>=0.28.1) was the first-ever override in telemetry-backend. `telemetry-backend/Dockerfile` prod stage copied only package.json + pnpm-lock.yaml → CI deploy build broke. `docker/Dockerfile` already copied pnpm-workspace.yaml (it carried the earlier [[vuln_ws_GHSA-58qx-3vcg-4xpx]] `ws` override) so the root image was fine.

**How to apply:** when adding/removing any pnpm override, grep every `Dockerfile*` for `pnpm install --frozen-lockfile` and confirm each such stage COPYs `pnpm-workspace.yaml`. Verify with an actual `docker build`, not just `pnpm test` — the failure only surfaces in the slim prod stage.
