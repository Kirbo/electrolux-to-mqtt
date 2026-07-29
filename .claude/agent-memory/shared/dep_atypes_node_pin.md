---
name: types-node-tracks-the-node-major-automatically
description: sync-versions.sh owns the @types/node range in both package.json files; no longer a manual re-pin after deps:update
metadata: 
  node_type: memory
  type: project
  originSessionId: 8e79790b-579f-46f5-90c1-46337a5c35c3
  modified: 2026-07-29T11:54:12.813Z
---

`@types/node` must never lead the Node runtime major (`mise.toml [tools] node`, `engines.node`, `.nvmrc`). As of 2026-07-29 this is **automated** — it is no longer a manual step.

`scripts/sync-versions.sh` rewrites `devDependencies['@types/node']` to `^<NODE>.0.0` in **both** `package.json` files (root + `telemetry-backend/`), alongside the `engines.node` range it already owned. Both `deps:update` scripts re-run the sync between `pnpm update --latest` and `pnpm install`, so the lockfiles re-resolve against the corrected range in one pass.

**Why:** `pnpm update --latest` resolves `@types/node` to the newest release line (^25, ^26, …) regardless of the runtime pin. Types ahead of the runtime describe APIs that don't exist at execution time — it typechecks, then fails in prod. This drifted repeatedly and was re-pinned by hand each time; making the sync script own it removes the human step.

**How to apply:** Don't hand-edit the `@types/node` range — change `mise.toml [tools] node` and run `pnpm sync:versions`. CI job `versions in sync` re-runs the script and fails on a non-empty `git diff`, so drift can't land. If `@types/node` is ever found ahead of the runtime major, the sync didn't run rather than the pin being wrong. See [[project_repo_layout]].

Node 24 (Krypton) is the current LTS as of 2026-07-29 — Node 25 and 26 are non-LTS.
