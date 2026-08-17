---
name: dockerfile-required-arg-guard
description: "Required build-arg guards use ${VAR:?\"msg\"} but must live in an ARG line, not FROM — FROM tokenizes on spaces before expansion"
metadata: 
  node_type: memory
  type: project
  originSessionId: e573a8ce-9b5b-43e2-8188-bdb634c2e145
  modified: 2026-08-17T16:15:16.681Z
---

All three Dockerfiles + both compose files require `NODE_VERSION` with no default (fail-loudly design, 2026-08-17). The guard syntax has two traps, both hit and verified:

1. The `:?` error message MUST be quoted: `${NODE_VERSION:?"NODE_VERSION build-arg is required"}` — unquoted spaces give `syntax error: missing '}'`.
2. Even quoted, the guard cannot sit in a `FROM` line — FROM splits on whitespace before variable expansion, yielding `FROM requires either one or three arguments`. Put the guard in an ARG indirection instead:

```dockerfile
ARG NODE_VERSION
ARG NODE_IMAGE=node:${NODE_VERSION:?"NODE_VERSION build-arg is required"}-alpine
FROM ${NODE_IMAGE}
```

Compose uses the same modifier and handles spaces fine: `${NODE_VERSION:?NODE_VERSION is not set - activate mise ...}`.

**How to apply:** any new Dockerfile/compose stage gets the same pattern — no version defaults; test both paths (`docker build` without the arg → loud error; `docker build --check --build-arg ...` → clean). `scripts/docker-build-test.sh` and CI pass the arg from `mise.toml [vars]`; see [[dep_alpine_hardened_images]].
