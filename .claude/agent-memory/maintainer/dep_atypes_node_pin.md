---
name: @types/node pin to v24
description: @types/node must be pinned to ^24 to match Node 24 LTS engines constraint; pnpm update --latest drifts it to ^25
type: feedback
---

`@types/node` must be kept at `^24` to match `engines.node: >=24.0.0 <25.0.0` and `.nvmrc: 24`.

`pnpm update --latest` will silently bump it to `^25.x` (latest overall). After running `deps:update`, always verify `@types/node` range in both `package.json` files.

**Why:** Node 25 is not LTS. Project is intentionally locked to Node 24 LTS per `engines` constraint added in commit dc9b355. @types/node v25 types may reference Node 25-only APIs not available at runtime.

**How to apply:** If `@types/node` drifts to ^25 after a `pnpm update --latest` run, re-edit both `package.json` files to `^24` and run `pnpm install` (not `--latest`). The correct resolved version is `24.12.2` (or latest 24.x at time of install).
