---
name: dep_corepack_node26
description: "Node 26 (LTS 2026-10-28) bundles no Corepack — COREPACK_VERSION in versions.env is installed via npm in images/CI; bump it by hand, pnpm outdated never shows it"
metadata:
  node_type: memory
  type: project
  originSessionId: be568634-8a48-484d-9af1-6fb870a6c20b
  modified: 2026-11-02T10:16:56.487Z
---

Node moved 24 → 26 on 2026-11-02 (Node 26 "Lithium" LTS since 2026-10-28; Node 24 is maintenance until 2028-04-30). Never pin an odd major.

**Corepack is not bundled in Node 25+** (`node:26-alpine` has no `corepack`; `npm` still is). Fix adopted:

- `versions.env` `COREPACK_VERSION` (0.36.0 at adoption; engines `^22.22.2 || ^24.15.0 || >=26`) is the source; package.json `corepackVersion` is a derived copy (release gate) — see [[project_versions_env]].
- CI: every pnpm job runs `sh scripts/bootstrap-pnpm.sh` (npm i -g corepack@pin → `corepack enable` → `corepack install`).
- Dockerfiles (prod builder + purge, local, backend ×2): `npm install --global "corepack@${COREPACK_VERSION:?…}"` from the required build-arg. dhi `-dev` stages have npm (builder already used `npm pkg set`).
- `packageManager` (with its sha512) is derived from `versions.env` `PNPM_VERSION` by sync-versions; Corepack in images/CI reads it.

**Maintenance:** `pnpm outdated` never lists Corepack — compare `COREPACK_VERSION` with `npm view corepack version` on each `/maintain` run. pnpm bumps: edit `PNPM_VERSION` + `pnpm sync:versions` (it runs `pnpm dlx corepack@<pin> use pnpm@<ver>`); bare `corepack use` fails locally (mise leaves a dead `corepack` shim from Node 24).

dhi.io had `26-alpine3.24` + `-dev` (and 3.23) on 2026-11-02; no Alpine 3.25 yet. See [[dep_alpine_hardened_images]], [[dep_atypes_node_pin]].
