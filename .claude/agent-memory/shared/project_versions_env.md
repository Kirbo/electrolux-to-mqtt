---
name: project_versions_env
description: versions.env is the single version source since 2026-11-02 (ppt-style); package.json carries derived copies only so image-affecting bumps hit the release gate
metadata:
  node_type: memory
  type: project
  originSessionId: be568634-8a48-484d-9af1-6fb870a6c20b
  modified: 2026-11-02T10:28:16.333Z
---

Since 2026-11-02 (user request: "single source like ~/Projects/postgresql-postgis-timescaledb or switchboard"), **`versions.env`** at the repo root holds every toolchain/base-image version: `NODE_VERSION` (exact since 2026-11-06; was `NODE_MAJOR`) + `NODE_DHI_DIGEST`/`NODE_DHI_DEV_DIGEST`/`NODE_STOCK_DIGEST`, `ALPINE_VERSION`, `COREPACK_VERSION`, `PNPM_VERSION`, `FNOX_VERSION`, `AGE_VERSION` (+ CI sha256 pins), `GIT_CLIFF_VERSION` (SOPS_VERSION was dropped with the fnox migration). It replaced package.json `engines.node`/`alpineVersion`/`corepackVersion`/`packageManager` + `mise.toml` pins + `scripts/{node-major,alpine-version,tool-version}.sh`.

**Why it is shaped this way (user decisions, 2026-11-02):**
- versions.env over mise.toml: plain KEY=value is sourceable by sh, a GitLab dotenv, compose interpolation and mise `_.file` — no TOML parsing in CI.
- **Release gate via package.json**, not versions.env: `sync-versions.sh` writes derived copies (`engines.node`, `@types/node`, `packageManager` with Corepack's hash, `alpineVersion`, `corepackVersion`, `nodeImageDigest`, `nodeDevImageDigest`) into package.json, which `.rules_code_changes` gates. So Node/Alpine/Corepack/pnpm bumps and prod base-digest refreshes cut a release; fnox/age/git-cliff bumps do not (a release sends users an ntfy update notice). Don't add versions.env to the release gate.
- Same names everywhere: Dockerfiles/compose take build-args `NODE_VERSION`/`ALPINE_VERSION`/`NODE_*_DIGEST`/`COREPACK_VERSION` (no defaults); CI's node job image is `NODE_CI_IMAGE` (`node:<ver>-alpine<alp>@<NODE_STOCK_DIGEST>`, built in `initialise variables`).
- Since 2026-11-06 (standardization pass): exact Node + digest-pinned images + committed `mise.lock` (NOT `[settings] locked = true`: as a project setting it also locks the user's global `latest` tools inside the repo dir — they stop resolving; use `mise install --locked`). `scripts/check-version-sync.mjs` (run by sync-versions.sh) holds mise.toml/mise.lock, the Dockerfile FROMs and the CI node images to versions.env; `scripts/node-images.sh pin|check` refreshes/validates the digests (check runs in CI `docker build test`).

**Gotchas hit:**
- mise `[tools] node = "{{ env.NODE_VERSION }}"` works with `[env] _.file = "versions.env"` (no `exec()` needed).
- A compose `${VAR:?msg}` whose msg contains `: ` turns the `- KEY=…` list item into a YAML map ("args.[0]: unexpected type map"). Keep `: ` out of those messages.
- versions.env is *sourced as shell*; `sync-versions.sh` rejects anything but comments/blank/`KEY=[A-Za-z0-9._:-]+` (`:` added for the `sha256:` digests).
- Without pnpm (CI drift job, bare alpine) sync-versions writes a hash-less `pnpm@X` so `git diff` flags the drift.

Related: [[dep_corepack_node26]], [[dep_atypes_node_pin]], [[dep_alpine_hardened_images]].
