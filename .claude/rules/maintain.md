## Scope

Keep the project's dependencies, tooling, and package manager up to date. Fix any breakage introduced by updates.

## Checklist

### 1. Dependency audit
- [ ] `pnpm deps:check` — list outdated packages and known vulnerabilities

### 2. Update dependencies
- [ ] `pnpm deps:update` — update all dependencies to latest
- [ ] Watch for breaking changes (e.g., major version bumps changing API surface)
- [ ] For major version bumps, verify peer dependency compatibility of dependent packages

### 3. Check Docker base image
- [ ] Verify the latest Node.js LTS version and update `.nvmrc`, `package.json` `engines`, and `docker/Dockerfile` `NODE_VERSION` arg if a new LTS is available
- [ ] Verify the latest Alpine version available for the `dhi.io/node` hardened image and update the Alpine suffix in `docker/Dockerfile` (e.g., `alpine3.23`) if a newer version is available
- [ ] If either changed, also update `docker/Dockerfile.local` to match

### 4. Update pnpm
- [ ] `corepack use pnpm@latest` — update pnpm to latest (idempotent, always run)

### 5. Verify
- [ ] `pnpm check` — Biome lint + format
- [ ] `pnpm typecheck` — TypeScript strict mode
- [ ] `pnpm test` — all unit tests pass with coverage thresholds met
- [ ] `pnpm sonar` — no SonarQube findings (bugs, vulnerabilities, code smells, cognitive complexity)

### 6. Fix breakage
- [ ] If any check in step 5 fails, fix the issue and re-run until all checks pass
