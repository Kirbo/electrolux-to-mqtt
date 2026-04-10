---
name: audit
description: Comprehensive codebase audit — lint, typecheck, tests, then manual review
disable-model-invocation: true
---

Run a comprehensive review of the codebase. This checklist is a minimum baseline — flag unlisted issues and suggest new checklist items.

## Ground rules

- Every finding must be confirmed by reading actual file content — no assumptions.
- Check findings against CLAUDE.md rules before flagging — documented conventions are intentional.
- Test imports count as external usage (exports used only by tests are not dead).

## Steps

1. Run in parallel: `pnpm check`, `pnpm typecheck`, `pnpm test`
2. Work through the checklist below from § 2 (step 1 covers § 1).
3. Fix all findings. Re-run verification (CLAUDE.md § Verification).
4. Propose new rules/checklist items for any gap found.

## Checklist

### 1. Automated checks
- [ ] `pnpm check` — Biome lint + format
- [ ] `pnpm typecheck` — TypeScript strict mode
- [ ] `pnpm test` — all tests pass with coverage thresholds
- [ ] `pnpm sonar` — no SonarQube findings

### 2. Configuration
- [ ] `configSchema` matches `config.example.yml`
- [ ] `envSchema` covers all env var alternatives
- [ ] Zod constraints appropriate (min/max, regex, defaults)
- [ ] Every config field used and tested (valid + invalid)

### 3. TypeScript patterns
- [ ] `as` assertions have runtime checks — grep ` as ` in `src/`
- [ ] Classes with interfaces declare `implements`
- [ ] Retry logic uses exponential backoff with cap
- [ ] No function exceeds cognitive complexity 15

### 4. Appliance support
- [ ] All classes extend `BaseAppliance`; `factory.ts` handles all types
- [ ] Normalizers produce consistent `NormalizedState`
- [ ] `transformMqttCommandToApi()` maps all commands
- [ ] `deriveImmediateStateFromCommand()` handles all types
- [ ] `generateAutoDiscoveryConfig()` produces valid payloads

### 5. MQTT / HA
- [ ] Topic structure consistent (`{prefix}/{applianceId}/state`, `/command`)
- [ ] HA discovery payloads conform to spec
- [ ] QoS/retain correct; reconnection robust
- [ ] Commands validated before forwarding to API

### 6. Tests
- [ ] Every public function has unit tests
- [ ] Every test has `expect` assertion
- [ ] Config: YAML, env vars, missing, invalid
- [ ] Appliances: normalization, commands, HA discovery
- [ ] MQTT events: connect, disconnect, message, error
- [ ] Edge cases: empty state, malformed responses, network errors

### 7. Doc/code sync
- [ ] Compose examples include all config/env options
- [ ] Documented env vars match `envSchema`
- [ ] `package.json` scripts/engines match README
- [ ] README appliance list matches classes
- [ ] `HOME_ASSISTANT.md` matches implementation
- [ ] `CONTRIBUTING.md` thresholds/structure match codebase

### 8. Config files
- [ ] `biome.jsonc` scope matches scripts
- [ ] `tsconfig.json` strict enabled
- [ ] `vitest.config.ts` excludes/thresholds correct
- [ ] `.nvmrc`/`engines`/Docker args agree on Node version
- [ ] `.semrelrc` correct; CI matches local workflow
- [ ] Docker builds minimal (incl. `telemetry-backend/`)

### 9. Security
- [ ] Credentials never logged
- [ ] `config.yml` in `.gitignore` (`tokens.json` auto-generated at runtime)
- [ ] Docker images exclude dev deps (`--prod`)
- [ ] `.dockerignore` excludes secrets
- [ ] Production uses `dhi.io/node` hardened images
- [ ] Env var fallbacks don't expose sensitive defaults

### 10. Telemetry backend
- [ ] Multi-stage Dockerfile, dev deps stripped
- [ ] No hardcoded secrets/unsafe defaults
- [ ] Input validation on all endpoints
- [ ] Rate limiting on POST (before validation); GET skips (cached)
- [ ] `express.json()` has size limit
- [ ] `docker-compose.yml` env vars match code; `README.md` complete

### 11. E2E snapshots

> Skip if `config.yml` doesn't exist.

- [ ] `pnpm test:e2e` passes
- [ ] Per model in `tests/e2e/snapshots/{model}/`:
  - [ ] State keys covered by `Appliance['properties']['reported']`
  - [ ] Capability values covered by `ApplianceInfo['capabilities']`
  - [ ] Enum values have normalized variants in `normalized.ts`
  - [ ] Mode constraints match `validateCommand()` + test data
- [ ] `appliances-list.json` matches `ApplianceStub` type
