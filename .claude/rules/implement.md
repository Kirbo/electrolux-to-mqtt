---
paths:
  - "src/**"
  - "tests/**"
  - "docker/**"
  - "telemetry-backend/**"
---

## Rules

- Write tests first when touching `src/`. Skip for purely structural changes. Every test must have at least one `expect`.
- User-facing changes → update `README.md` and `CONTRIBUTING.md`.
- Numeric schemas: `.positive()` / `.min(1)` for positive, `.int()` for whole, `.int().min(1).max(65535)` for ports.

## File checklists

### Config (`src/config.ts`)
`config.example.yml`, `docker/docker-compose.example.yml` (env vars), `docker/docker-compose.local.example.yml`, `tests/config.test.ts` (valid + invalid cases)

### Appliance support
`src/appliances/<model>.ts`, `factory.ts`, `normalizers.ts`*, `src/types/normalized.ts`*, `src/types/homeassistant.ts`*, `tests/appliances/<model>.test.ts`, `base.test.ts`*, `factory.test.ts`, `normalizers.test.ts`*
(*if interface/logic changed)

### API types (`src/types.d.ts`, `src/types/normalized.ts`)
Run E2E snapshot validation (see `/audit` checklist § 11).

### Version-checker (`src/version-checker.ts`)
`tests/version-checker.test.ts`, `HOME_ASSISTANT.md`*, `config.example.yml` + compose examples*
(*if payloads/config changed)

### MQTT / HA integration
`src/mqtt.ts`, `src/types/homeassistant.ts`, relevant appliance `generateAutoDiscoveryConfig()`, `tests/mqtt.test.ts`, `tests/mqtt-events.test.ts`, `tests/electrolux.test.ts`*, `tests/state-differences.test.ts`*, `HOME_ASSISTANT.md`*
(*if relevant behavior changed)

### Docker
`docker/Dockerfile` / `Dockerfile.local`, `.dockerignore`*, compose examples*
(*if needed)

### Telemetry backend (`telemetry-backend/`)
Rate limiting must run **before** input validation.
Behavior changes require tests in `telemetry-backend/tests/` (uses Vitest + the in-memory `FakeRedis` helper).
If build/compose changed: update `Dockerfile`, `docker-compose.yml`, `README.md`.
