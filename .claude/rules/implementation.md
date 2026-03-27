## TDD

Write tests first, then implement. When a change touches `src/`, write or update the corresponding test in `tests/` before writing the production code. Skip TDD only when the change is purely structural (moves, renames, re-exports) with no new logic.

## When config options change (src/config.ts)

Update **all of**:
- `src/config.ts` (`configSchema` Zod schema and/or `envSchema`)
- `config.example.yml` (example values for new/changed options)
- `docker/docker-compose.example.yml` (environment variables in the example service)
- `docker/docker-compose.local.example.yml` (same — local dev example)
- `README.md` (Configuration section, environment variables table)
- `CONTRIBUTING.md` (if the change affects development workflow, coverage thresholds, or project structure)
- `tests/config.test.ts` (schema validation tests — valid and invalid cases)

## When adding or modifying appliance support

Update:
- `src/appliances/<model>.ts` (new appliance class extending `BaseAppliance`)
- `src/appliances/factory.ts` (register new model in the factory)
- `src/appliances/normalizers.ts` (if new normalization logic is needed)
- `src/types/normalized.ts` (if new state fields are introduced)
- `src/types/homeassistant.ts` (if new HA discovery config fields are needed)
- `tests/appliances/<model>.test.ts` (unit tests for all methods)
- `tests/appliances/base.test.ts` (if the `BaseAppliance` interface changed)
- `tests/appliances/factory.test.ts` (factory creates the new model correctly)
- `tests/appliances/normalizers.test.ts` (if normalizer functions changed)
- `README.md` (supported appliances list)

## When modifying API types (`src/types.d.ts`, `src/types/normalized.ts`)

If the user has valid credentials (`config.yml` — `tokens.json` is auto-populated at runtime), run `pnpm test:e2e` and compare the snapshots in `tests/e2e/snapshots/` against the type definitions:
- `appliance-state.json` reported keys → `Appliance['properties']['reported']` fields
- `appliance-info.json` capabilities enum values → raw type unions in `src/types.d.ts`
- Raw type enum values → normalized type unions in `src/types/normalized.ts`

Every value the API can send must be represented in both the raw and normalized types.

## When version-checker or telemetry changes (`src/version-checker.ts`)

Update:
- `src/version-checker.ts` (update checking, telemetry reporting, ntfy.sh notifications)
- `tests/version-checker.test.ts` (unit tests)
- `HOME_ASSISTANT.md` (if MQTT info topic payloads change)
- `README.md` (if user-facing behavior changes)
- `config.example.yml` and docker-compose examples (if `versionCheck.*` config fields change)

## When MQTT or Home Assistant integration changes

Update:
- `src/mqtt.ts` (topic structure, message handling)
- `src/types/homeassistant.ts` (HA discovery payload types)
- Relevant appliance class `generateAutoDiscoveryConfig()` method
- `tests/mqtt.test.ts` and `tests/mqtt-events.test.ts`
- `tests/electrolux.test.ts` (if state publishing or command handling changed)
- `tests/state-differences.test.ts` (if state diffing logic changed)
- `HOME_ASSISTANT.md` (if MQTT topics, payloads, or HA automation examples are affected)
- `README.md` (if MQTT topic structure or HA integration docs are affected)

## When adding any user-facing feature or behavioral change

Update `README.md` in the same pass. This includes but is not limited to:
- New or changed config options
- Changed defaults or behavior
- New appliance support
- New MQTT topics or message formats
- New Docker configuration
- New pnpm scripts

Also update `CONTRIBUTING.md` if the change affects development workflow, project structure, testing conventions, or coverage thresholds.

Do not wait to be asked. If the user can see it or use it, it belongs in README.

## When Docker configuration changes

Update:
- `docker/Dockerfile` and/or `docker/Dockerfile.local`
- `docker/docker-compose.example.yml` (if compose config changed)
- `docker/docker-compose.local.example.yml` (same — local dev example)
- `.dockerignore` (if new files should be excluded)
- `README.md` (Docker section)

## When updating dependencies

- Run `pnpm deps:check` to see outdated packages and vulnerabilities.
- Run `pnpm deps:update` to update all dependencies to latest.
- Always re-run `pnpm check`, `pnpm typecheck`, and `pnpm test` after updating.
- Watch for breaking changes (e.g., Zod v3 -> v4 nested defaults behavior).
- Update `packageManager` field via `corepack use pnpm@latest` if pnpm itself is outdated.

## When telemetry backend changes (`telemetry-backend/`)

Update:
- `telemetry-backend/src/index.ts` (API endpoints, rate limiting, Redis logic)
- `telemetry-backend/Dockerfile` (if build or runtime changes)
- `telemetry-backend/docker-compose.yml` (if compose config changed)
- `telemetry-backend/README.md` (environment variables, API endpoints, deployment)

The telemetry backend is a standalone service with its own `package.json` and `tsconfig.json`. Changes here do not require running the main project's test suite, but do require verifying the Dockerfile builds correctly.
