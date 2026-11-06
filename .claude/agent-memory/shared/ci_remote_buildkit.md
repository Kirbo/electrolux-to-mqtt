---
name: ci-remote-buildkit
description: Since 2026-11-06 CI jobs have no Docker engine — buildx remote builder to the Mac Mini's BuildKit servers over mTLS, $MAC_DOCKER runner routing, and pnpm docker:test smoke-runs as a BuildKit RUN step; non-obvious gotchas of that design
metadata:
  type: project
---

The owner removed the Docker socket from the Mac Mini's shared runner (any job could control the whole engine). Design + rules: `docs/CONTRIBUTING.md` § CI runners and BuildKit, `/maintain` § CI images and BuildKit.

**Gotchas hit while building it (2026-11-06):**
- The hardened `dhi.io/node` runtime has **no /bin/sh** → the smoke step is exec-form `RUN --network=none ["node", …]` and the harness (`docker/build-test/smoke.mjs`) is plain Node, capturing stdout+stderr via a shared fd (`stdio: ['ignore', fd, fd]`) like `docker run 2>&1`.
- The smoke step does not see the image config, so it cannot apply ENTRYPOINT/CMD itself: the script parses the Dockerfile's last exec-form `CMD` and fails on any `ENTRYPOINT`. A base-image ENTRYPOINT is invisible to it — fine today (the old `docker run` test, which did apply it, passed with `node …` commands on both bases), a fidelity gap to remember.
- BuildKit build checks warn `SecretsUsedInArgOrEnv` for an ARG named `*TOKEN*` → the cache-bust arg is `SMOKE_RUN_ID`, not `SMOKE_TOKEN`.
- `docker buildx bake` needs `--allow fs.write=…` for a local output OUTSIDE the working directory → results go to the gitignored `.docker-build-test/` in the repo instead.
- Build ARGs are env vars inside RUN — the harness strips `SMOKE_*` from the checks' environment.
- The Mac Mini's `/bin/bash` is 3.2 (no `mapfile`, no `${x,,}`); the script was proven there.
- Proven on the Mac (a capped docker-container builder AND Docker Desktop's default docker-driver builder — bake `target:` linked contexts + `type=local` work on both): pass for all three images, `src/health.ts` excluded from the context → `ERR_MODULE_NOT_FOUND` + legacy HEALTHCHECK exit 1, wrong marker → fail, second run shows the smoke `RUN` executing while the image layers are `CACHED`.
- `--network host` on the old `docker build` calls was dropped: plain BuildKit networking installs fine; host networking needs the `network.host` entitlement the remote servers don't grant.
