---
name: dockerignore-is-an-allowlist
description: .dockerignore excludes everything then re-includes; anything that must reach an image needs an explicit !entry or the build breaks
metadata: 
  node_type: memory
  type: project
  originSessionId: 8e79790b-579f-46f5-90c1-46337a5c35c3
  modified: 2026-07-29T13:21:53.004Z
---

`.dockerignore` was converted from a denylist to an **allowlist** on 2026-07-29: `*` first, then `!src`, `!package.json`, … Docker applies last-match-wins, so ordering is exclude-all → re-include → re-exclude junk nested inside the re-included directories.

**The failure mode is inverted — know which way it bites.** A denylist fails *open*: `.semrel` grew to ~85 MB of semantic-release cache and shipped into every build context because nobody remembered to exclude it. The allowlist fails *closed*: **adding a file or directory that must reach an image requires an explicit `!entry`**, or it is silently absent from the context. Usually the build fails loudly; the dangerous case is a file only read at *runtime*, where the image builds fine and breaks in production.

So: **whenever you add something that should exist in an image, add it to `.dockerignore` in the same change.**

**All three Dockerfiles share the repo-root context**, so the list is the union of their needs — `docker/Dockerfile` (prod, `COPY . .` + `pnpm run build`), `docker/Dockerfile.local` (dev, `COPY . .` + `pnpm dev`), and `telemetry-backend/Dockerfile` (root `package.json` copied as `application.json`, plus `telemetry-backend/`).

**`.npmrc` must stay allowlisted.** It sets `engine-strict=true`, which enforces `engines.node` during the in-image `pnpm install`. Dropping it silently removes that guard — the build still succeeds, which is exactly why it would go unnoticed.

**Verify with `pnpm docker:test`** (`scripts/docker-build-test.sh`, added 2026-07-29). It builds all three images and smoke-runs each offline with no config, asserting the app reaches config validation with no missing-module error — which proves every file the image needs actually made it in. CI job `docker build test` (test stage, every branch, `.dockerignore` in its `changes:` list) runs the same script before any release. Locally the prod image falls back to a stock base because `dhi.io` returns 401 without entitlement; CI logs into dhi.io so it tests the real hardened image.

To inspect what actually reaches the daemon:

```sh
printf 'FROM alpine\nWORKDIR /p\nCOPY . .\nRUN ls -A1 && du -sh .\n' > /tmp/ctx.Dockerfile
docker build --no-cache -f /tmp/ctx.Dockerfile -t ctx-probe .
```

Context went 85.6 MB → 476 KB. Verified 2026-07-29: backend image, `Dockerfile.local`, and a prod-builder simulation all build; `dist/index.js` is emitted and `tsc-alias` rewrites the `@/` aliases. See [[dep_override_dockerfile_workspace]] for the related rule that `pnpm-workspace.yaml` must reach every frozen-install stage.
