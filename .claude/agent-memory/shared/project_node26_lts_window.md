---
name: node-26-lts-window-october-2026
description: Node 26 becomes LTS on 2026-10-28 and Node 24 drops to maintenance 2026-10-20; that is when to bump mise.toml
metadata: 
  node_type: memory
  type: project
  originSessionId: 8e79790b-579f-46f5-90c1-46337a5c35c3
  modified: 2026-07-29T13:00:53.472Z
---

The project pins `mise.toml [tools] node = "24"`. Node 24 (Krypton) is the active LTS **until October 2026**; Node 26 is Current, not LTS, until then.

Dates from the official schedule (`https://raw.githubusercontent.com/nodejs/Release/main/schedule.json`), read 2026-07-29:

- **2026-10-20** — Node 24 drops to maintenance (security fixes only). Supported until 2028-04-30, so this is a signal, not a deadline.
- **2026-10-28** — **Node 26 becomes LTS.** This is the date to bump.
- Node 25 was never LTS (odd major) and went EOL 2026-06-01. Never pin an odd major.

**When the window opens, verify before acting** — don't trust this file's dates blindly:

```sh
curl -s https://nodejs.org/dist/index.json | node -e "const a=JSON.parse(require('fs').readFileSync(0,'utf8'));
  const v=a.find(r=>r.version.startsWith('v26.')); console.log(v.version, v.lts)"   # lts must be a codename, not false
```

**Then:** edit `mise.toml` to `node = "26"` and run `pnpm sync:versions`. That single run carries `.nvmrc`, both `engines.node`, both `devDependencies['@types/node']`, `docker/Dockerfile` + `Dockerfile.local`, both compose `NODE_VERSION` defaults, `telemetry-backend/Dockerfile`, the `.gitlab/ci/01_init.yml` alpine literal, and re-resolves both lockfiles. Verified end-to-end 24 → 26 → 24 on 2026-07-29. See [[dep_atypes_node_pin]] for why `@types/node` needs the script rather than a version range.

**Expect one wrinkle:** a major bump flattens a specific in-major floor — `@types/node` goes `^24.13.3` → `^26.0.0`. Correct behaviour (the script only preserves floors *within* the same major), just not floor-preserving across majors.

**BLOCKER to fix before the bump — Corepack is not bundled in Node 25+.** Verified 2026-07-29: `node:24-alpine` has `corepack`, `node:26-alpine` does **not**. The Node TSC voted to stop distributing it; it still exists, just as a separate install. This repo bootstraps pnpm through it in **12 call sites across the three Dockerfiles** and **14 across `.gitlab/ci/*.yml`** (`corepack enable && corepack install`), all of which fail on Node 26 with "corepack: not found".

`npm` *is* still bundled (npm 11.17.0 in `node:26-alpine`), so the minimal fix keeps the existing `packageManager`-driven flow and just installs the bootstrapper first:

```dockerfile
RUN npm i -g corepack@latest && corepack enable && corepack install
```

Keep `packageManager` in `package.json` either way — it is the version source of truth, carries an integrity hash, and both the Dockerfiles and CI read it. Do NOT move the pnpm version into `mise.toml`: mise is not present inside the images or CI runners.

**Do at the same time:** re-check the Alpine pin (`[env] ALPINE_VERSION`, currently 3.24 — the newest 3.x as of 2026-07-29) and the hardened base tag in the dhi.io catalog; see [[dep_alpine_hardened_images]]. Node 26 will need a `26-alpine<ver>` hardened tag to exist before `docker/Dockerfile` can build.

Delete this memory once the bump has landed.
