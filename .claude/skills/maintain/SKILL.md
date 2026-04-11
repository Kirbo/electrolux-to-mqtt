---
name: maintain
description: Update dependencies, fix vulnerabilities, resolve breakage
disable-model-invocation: true
context: fork
agent: maintainer
model: sonnet
effort: medium
---

Update all deps. Fix issues.

## Checklist

### 1. Dependency audit
- [ ] `pnpm deps:check` — list outdated + vulns

### 2. Update dependencies
- [ ] `pnpm deps:update` — bump all latest
- [ ] Watch breaking changes (major bumps)
- [ ] Verify peer dep compat for major bumps

### 3. Docker base image
- [ ] Check https://hub.docker.com/hardened-images/catalog/dhi/node/images for latest LTS Node + Alpine tag (e.g. `24-alpine3.23`)
- [ ] **Node LTS major bumped** → update **major version only** (no minor/patch) in every location:
  - `.nvmrc` → `<major>`
  - `package.json` `engines.node` → `>=<major>`
  - `docker/Dockerfile` `ARG NODE_VERSION` → `<major>-alpine<X.Y>`
  - `docker/Dockerfile.local` `ARG NODE_VERSION` → `<major>`
  - `docker/docker-compose.local.yml` + `docker/docker-compose.local.example.yml` `NODE_VERSION:-<major>`
  - `telemetry-backend/Dockerfile` `ARG NODE_VERSION` → `<major>`
  - `telemetry-backend/docker-compose.yml` `NODE_VERSION:-<major>`
- [ ] **Alpine version bumped** → update in every location:
  - `docker/Dockerfile` `ARG NODE_VERSION` → `<major>-alpine<X.Y>`
  - `.gitlab-ci.yml` `echo "NODE_VERSION=$(cat .nvmrc)-alpine<X.Y>"` line

### 4. Update pnpm
- [ ] `corepack use pnpm@latest`

### 5. Verify and fix
- [ ] Run CLAUDE.md § Verification. Fix breakage, re-run til clean.
