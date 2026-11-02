---
name: dep_corepack_node26
description: "Node 26 (LTS 2026-10-28) bundles no Corepack — pinned \"corepackVersion\" in package.json is installed via npm in images/CI; bump it by hand, pnpm outdated never shows it"
metadata:
  node_type: memory
  type: project
  originSessionId: be568634-8a48-484d-9af1-6fb870a6c20b
  modified: 2026-11-02T10:16:56.487Z
---

Node moved 24 → 26 on 2026-11-02 (Node 26 "Lithium" LTS since 2026-10-28; Node 24 is maintenance until 2028-04-30). Never pin an odd major.

**Corepack is not bundled in Node 25+** (`node:26-alpine` has no `corepack`; `npm` still is). Fix adopted:

- Root `package.json` top-level `"corepackVersion"` (0.36.0 at adoption; engines `^22.22.2 || ^24.15.0 || >=26`) is the single source of truth.
- CI: every pnpm job runs `sh scripts/bootstrap-pnpm.sh` (npm i -g corepack@pin → `corepack enable` → `corepack install`).
- Dockerfiles (prod builder + purge, local, backend ×2): inline `npm install --global "corepack@$(node -p "require('./package.json').corepackVersion")"` — the script is not in their context before install. dhi `-dev` stages have npm (builder already used `npm pkg set`).
- `packageManager` (with its sha512) stays the pnpm source of truth.

**Maintenance:** `pnpm outdated` never lists Corepack — compare `corepackVersion` with `npm view corepack version` on each `/maintain` run. **Local pnpm self-update** is now `pnpm dlx "corepack@<corepackVersion>" use pnpm@latest`; bare `corepack use` fails (mise leaves a dead `corepack` shim from Node 24).

dhi.io had `26-alpine3.24` + `-dev` (and 3.23) on 2026-11-02; no Alpine 3.25 yet. See [[dep_alpine_hardened_images]], [[dep_atypes_node_pin]].
