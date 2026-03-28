## Scope

This checklist is a **minimum baseline**, not an exhaustive list. The review must apply current best practices across every dimension of the project — including but not limited to:

- **Node.js / TypeScript** — idiomatic patterns, modern APIs, strict typing, proper error handling
- **MQTT** — topic structure, QoS correctness, message format consistency, reconnect behavior
- **Home Assistant** — discovery payload correctness, entity naming, device grouping
- **Testing** — meaningful assertions, proper isolation, edge cases, no false positives
- **Security** — OWASP top 10, input validation, credential handling, dependency supply chain
- **Code quality** — readability, maintainability, no dead code, no code smells
- **Performance** — unnecessary allocations, polling efficiency, caching correctness
- **DevOps / CI** — pipeline correctness, Docker build, reproducible builds
- **Telemetry backend** — `telemetry-backend/` service: Dockerfile quality, dependency hygiene, input validation

If something looks wrong or outdated but isn't on the checklist below, flag it anyway. When a finding falls outside the checklist, suggest adding it as a new checklist item so future reviews catch it automatically.

## Checklist

### 1. Automated checks

> **Note:** When invoked via `/audit`, these are already run in the skill's step 1. Start from section 2.

- [ ] `pnpm check` — Biome lint + format on src/ and tests/
- [ ] `pnpm typecheck` — TypeScript strict mode
- [ ] `pnpm test` — all unit tests pass with coverage thresholds met
- [ ] `pnpm sonar` — no SonarQube findings (bugs, vulnerabilities, code smells, cognitive complexity)

### 2. Configuration correctness
- [ ] `configSchema` in `src/config.ts` matches all fields in `config.example.yml`
- [ ] `envSchema` in `src/config.ts` covers all environment variable alternatives
- [ ] Zod validation has appropriate constraints (min/max, regex, defaults)
- [ ] Every config field has a code path that uses it
- [ ] Every config field has test coverage (valid and invalid cases)

### 3. TypeScript patterns
- [ ] All `as` type assertions have a preceding runtime check (`Set.has`, `typeof`, `in` operator, etc.) — grep for ` as ` in `src/`
- [ ] Classes that have a corresponding interface declare `implements` — no silent drift between interface and implementation
- [ ] Retry/reconnect logic uses exponential backoff with a cap (no fixed-delay infinite loops)
- [ ] No function exceeds cognitive complexity 15 (SonarQube limit) — split complex functions into smaller helpers

### 4. Appliance support
- [ ] Every appliance class in `src/appliances/` extends `BaseAppliance` correctly
- [ ] `factory.ts` handles all known device types and models
- [ ] Normalizers produce consistent `NormalizedState` output
- [ ] `transformMqttCommandToApi()` correctly maps all supported commands
- [ ] `deriveImmediateStateFromCommand()` handles all command types
- [ ] `generateAutoDiscoveryConfig()` produces valid HA discovery payloads

### 5. MQTT / Home Assistant integration
- [ ] MQTT topic structure is consistent (`{prefix}/{applianceId}/state`, `/command`)
- [ ] HA auto-discovery payloads conform to HA MQTT discovery spec
- [ ] QoS and retain settings are applied correctly
- [ ] MQTT reconnection and error handling is robust
- [ ] Command messages are validated before forwarding to Electrolux API

### 6. Test coverage
- [ ] Every public function in `src/` has unit tests in `tests/`
- [ ] Every test contains at least one `expect` assertion — no assertion-free tests (SonarQube S2699)
- [ ] Config loading tested: YAML file, environment variables, missing config, invalid values
- [ ] Appliance classes tested: state normalization, command transformation, HA discovery
- [ ] MQTT events tested: connect, disconnect, message, error
- [ ] Edge cases: empty state, malformed API responses, network errors, invalid commands

### 7. Doc/code sync
- [ ] Docker compose example files (`docker/docker-compose.example.yml`, `docker/docker-compose.local.example.yml`) include all current config/env options
- [ ] Environment variables documented match what `envSchema` in `src/config.ts` reads
- [ ] `package.json` scripts match README development section
- [ ] `engines` field matches README requirements section
- [ ] Supported appliances list in README matches actual appliance classes
- [ ] `HOME_ASSISTANT.md` MQTT topic payloads and automation examples match actual implementation
- [ ] `CONTRIBUTING.md` coverage thresholds match `vitest.config.ts` thresholds
- [ ] `CONTRIBUTING.md` project structure and development workflow match actual codebase

### 8. Configuration files
- [ ] `biome.jsonc` includes scope matches `check`/`lint` script scope
- [ ] `tsconfig.json` strict settings enabled
- [ ] `vitest.config.ts` coverage excludes match actual project structure (no phantom paths)
- [ ] `vitest.config.ts` coverage thresholds are maintained or improved
- [ ] `vitest.setup.ts` global test setup is correct (mocks, utilities)
- [ ] `.nvmrc`, `package.json` `engines` field, and Docker build args agree on the Node.js version
- [ ] `.semrelrc` release configuration is correct (if release behavior changed)
- [ ] CI pipeline stages match local development workflow
- [ ] Docker builds produce correct, minimal images (including `telemetry-backend/Dockerfile`)

### 9. Security
- [ ] Credentials (API keys, passwords, tokens) are never logged
- [ ] `config.yml` is in `.gitignore` (`tokens.json` is auto-populated from credentials in `config.yml` at runtime — no manual creation needed)
- [ ] Docker images don't include dev dependencies or source maps
- [ ] `.dockerignore` excludes secrets (`config.yml`, `tokens.json`, `.env`) from the build context
- [ ] Production Dockerfile uses hardened `dhi.io/node` base images (not standard Node images)
- [ ] Environment variable fallbacks don't expose defaults for sensitive fields

### 10. Telemetry backend (`telemetry-backend/`)
- [ ] Dockerfile uses multi-stage build and strips dev dependencies
- [ ] No hardcoded secrets or unsafe defaults in `src/index.ts`
- [ ] Input validation on all API endpoints (userHash, version)
- [ ] Rate limiting configured and functional on mutation endpoints (POST). Read-only endpoints (GET) intentionally have no rate limiting since they serve cached responses.
- [ ] Rate limiting runs before input validation (malformed requests must still consume rate limit quota to prevent flooding)
- [ ] `express.json()` has a payload size limit configured
- [ ] `docker-compose.yml` environment variables match what `src/index.ts` reads
- [ ] `README.md` documents all environment variables

### 11. E2E snapshot validation

> **Pre-check:** Run `test -f config.yml && echo "CREDENTIALS_AVAILABLE" || echo "NO_CREDENTIALS"`. If `CREDENTIALS_AVAILABLE`, run all items below. If `NO_CREDENTIALS`, skip this section.

- [ ] Run `pnpm test:e2e` — all tests pass
- [ ] For each model directory in `tests/e2e/snapshots/{model}/` (e.g. `comfort600/`):
  - [ ] Compare `appliance-state.json` reported keys against `Appliance['properties']['reported']` in `src/types.d.ts` — types must cover all keys the API reports
  - [ ] Compare `appliance-info.json` capabilities values against `ApplianceInfo['capabilities']` in `src/types.d.ts` — types must include all API-reported enum variants (e.g., linkQualityIndicator, mode, fanSpeedSetting)
  - [ ] Compare API enum values against normalized types in `src/types/normalized.ts` — types must include a normalized variant for every raw API value (e.g., `VERY_POOR` → `'very_poor'`)
  - [ ] Compare mode trigger constraints (fan speed access/values, temperature ranges) against the appliance class's `validateCommand()` behavior and unit test mock data
- [ ] Compare `tests/e2e/snapshots/appliances-list.json` structure against `ApplianceStub` type — type must cover all fields the API returns
