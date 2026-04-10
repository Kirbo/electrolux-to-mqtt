---
name: maintain
description: Update dependencies, fix vulnerabilities, resolve breakage
disable-model-invocation: true
---

Update all dependencies and fix any issues.

## Checklist

### 1. Dependency audit
- [ ] `pnpm deps:check` — list outdated packages and vulnerabilities

### 2. Update dependencies
- [ ] `pnpm deps:update` — update all to latest
- [ ] Watch for breaking changes (major bumps)
- [ ] Verify peer dependency compatibility for major bumps

### 3. Docker base image
- [ ] Check latest Node.js LTS → update `.nvmrc`, `package.json` `engines`, `docker/Dockerfile` `NODE_VERSION`
- [ ] Check latest Alpine for `dhi.io/node` → update Alpine suffix
- [ ] If changed, update `docker/Dockerfile.local` to match

### 4. Update pnpm
- [ ] `corepack use pnpm@latest`

### 5. Verify and fix
- [ ] Run CLAUDE.md § Verification. Fix breakage and re-run until clean.
