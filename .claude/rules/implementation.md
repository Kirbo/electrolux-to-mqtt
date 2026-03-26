## When config options change (src/config.ts)

Update **all of**:
- `src/config.ts` (`configSchema` Zod schema and/or `envSchema`)
- `config.example.yml` (example values for new/changed options)
- `docker/docker-compose.example.yml` (environment variables in the example service)
- `docker/docker-compose.local.example.yml` (same — local dev example)
- `README.md` (Configuration section, environment variables table)
- `tests/config.test.ts` (schema validation tests — valid and invalid cases)

All example files must stay in sync — if a config option appears in one example, it must appear in all of them.

## When adding or modifying appliance support

Update:
- `src/appliances/<model>.ts` (new appliance class extending `BaseAppliance`)
- `src/appliances/factory.ts` (register new model in the factory)
- `src/appliances/normalizers.ts` (if new normalization logic is needed)
- `src/types/normalized.ts` (if new state fields are introduced)
- `src/types/homeassistant.ts` (if new HA discovery config fields are needed)
- `tests/appliances/<model>.test.ts` (unit tests for all methods)
- `tests/appliances/factory.test.ts` (factory creates the new model correctly)
- `tests/appliances/normalizers.test.ts` (if normalizers changed)
- `README.md` (supported appliances list)

## When modifying API types (`src/types.d.ts`, `src/types/normalized.ts`)

If the user has valid credentials (`config.yml` + `tokens.json`), run `pnpm test:e2e` and compare the snapshots in `tests/e2e/snapshots/` against the type definitions:
- `appliance-state.json` reported keys → `Appliance['properties']['reported']` fields
- `appliance-info.json` capabilities enum values → raw type unions in `src/types.d.ts`
- Raw type enum values → normalized type unions in `src/types/normalized.ts`

Every value the API can send must be represented in both the raw and normalized types.

## When MQTT or Home Assistant integration changes

Update:
- `src/mqtt.ts` (topic structure, message handling)
- `src/types/homeassistant.ts` (HA discovery payload types)
- Relevant appliance class `generateAutoDiscoveryConfig()` method
- `tests/mqtt.test.ts` and `tests/mqtt-events.test.ts`
- `README.md` (if MQTT topic structure or HA integration docs are affected)

## When adding any user-facing feature or behavioral change

Update `README.md` in the same pass. This includes but is not limited to:
- New or changed config options
- Changed defaults or behavior
- New appliance support
- New MQTT topics or message formats
- New Docker configuration
- New npm scripts

Do not wait to be asked. If the user can see it or use it, it belongs in README.

## When Docker configuration changes

Update:
- `docker/Dockerfile` and/or `docker/Dockerfile.local`
- `docker/docker-compose.example.yml` (if compose config changed)
- `.dockerignore` (if new files should be excluded)
- `README.md` (Docker section)

## When updating dependencies

- Run `pnpm deps:check` to see outdated packages and vulnerabilities.
- Run `pnpm deps:update` to update all dependencies to latest.
- Always re-run `pnpm check`, `pnpm typecheck`, and `pnpm test` after updating.
- Watch for breaking changes (e.g., Zod v3 -> v4 nested defaults behavior).
- Update `packageManager` field via `corepack use pnpm@latest` if pnpm itself is outdated.

## No empty directories

- Do not create placeholder/empty directories. Only create directories when adding files to them.
- Clean up directories that become empty after file removals.
