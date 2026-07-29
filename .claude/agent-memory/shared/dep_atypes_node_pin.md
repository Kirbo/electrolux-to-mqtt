---
name: types-node-tracks-the-node-major-automatically
description: A version range cannot stop pnpm update --latest; updateConfig.ignoreDependencies plus sync-versions.sh is what actually holds @types/node to the runtime major
metadata: 
  node_type: memory
  type: project
  originSessionId: 8e79790b-579f-46f5-90c1-46337a5c35c3
  modified: 2026-07-29T12:55:58.477Z
---

`@types/node` must never lead the Node runtime major (`mise.toml [tools] node`, `engines.node`, `.nvmrc`). Types ahead of the runtime describe APIs that don't exist at execution time — it typechecks, then fails in prod.

**A version range does NOT enforce this.** Verified 2026-07-29: with the spec set to an explicit `>=24.0.0 <25.0.0`, `pnpm update --latest` rewrote it to `^26.1.2`. `--latest` ignores the declared range by design; a range only constrains plain `pnpm update` / `pnpm install`, which `^24.x` already did.

Two mechanisms actually hold it:

1. **`updateConfig.ignoreDependencies: ['@types/node']`** in **both** `pnpm-workspace.yaml` files (root and `telemetry-backend/`, which needs its own copy — it has its own lockfile and is not a workspace member). Verified: a blanket `pnpm update --latest` left `@types/node` at `^24.13.3` while still bumping biome. Naming the package explicitly (`pnpm update --latest @types/node`) **overrides** the ignore list — don't.
2. **`scripts/sync-versions.sh` is the only writer.** It derives the range from `mise.toml`, rewrites it in both `package.json` files only when the *major* is wrong (a more specific in-major floor like `^24.13.3` is deliberate and still resolves to the newest 24.x, so it is left alone), and re-resolves both lockfiles when the range actually moves.

**Consequence:** `@types/node` shows as permanently "outdated" in `pnpm outdated` (24.x vs 26.x latest). That is the pin working — not a backlog item.

**How to move it:** bump `mise.toml [tools] node`, run `pnpm sync:versions`. Verified end-to-end 2026-07-29 (24 → 26 → 24): `.nvmrc`, both `engines.node`, both `@types/node`, all three Dockerfiles, both compose defaults, the CI alpine literal, and both lockfiles all followed. CI job `versions in sync` re-runs the script and fails on a non-empty `git diff`, so drift cannot land. `updateConfig` does not enter the lockfile's `settings` block, so it carries no `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` risk — confirmed with a real prod image build; see [[dep_override_dockerfile_workspace]].

Node 24 (Krypton) is the current LTS as of 2026-07-29; Alpine 3.24 is the newest 3.x.
