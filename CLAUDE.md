# CLAUDE.md

## Project

Electrolux-to-MQTT bridge — TypeScript service that connects Electrolux appliances to Home Assistant via MQTT auto-discovery. Uses pnpm, Biome, Vitest. Includes a standalone `telemetry-backend/` service for anonymous usage statistics.

## Rules

### TypeScript
- Never use `any`. Use `unknown` + type guards. No `as` without runtime check. No `// @ts-ignore`. No non-null assertions (`!`) — use type guards or optional chaining.
- Keep `strict: true` and `noUncheckedIndexedAccess: true`.
- State/config files read from disk must be validated, not blindly cast.

### Code quality
- No `console.log` in the main project (`src/`) — use `src/logger.ts` (pino). Exception: `console.*` is acceptable in `src/config.ts`, `src/init.ts`, and `src/logger.ts` for bootstrap messages that run before the pino logger is initialized. (`telemetry-backend/` is a separate service and uses `console.*` directly.)
- No silent error swallowing (empty `catch {}`) unless the fallback behavior is documented. No try/catch fallback patterns (try A, catch and silently retry B).
- Retry loops must use exponential backoff with a maximum delay. No unbounded fixed-delay infinite retries.
- No hardcoded secrets outside test fixtures.
- No dead exports — if a function/type is exported but never imported outside its own module, remove it. Test files (`tests/`) count as external importers — a function exported solely for testing is not dead.
- No dead fields in interfaces/types. If a field is not read anywhere, remove it.
- No dead type variants — if a union type includes a variant that no code path ever produces, remove it. Exception: raw API type unions in `src/types.d.ts` that reflect known API values (confirmed via E2E snapshots) must be kept even if no code path currently handles them — they document real API behavior.
- Every config/schema field must be functional — never expose an option that has no implementation.
- No empty directories. Only create directories when adding files to them. Clean up directories that become empty after file removals.

### Tooling
- Always use `pnpm`. Never `npm`, `yarn`, or `npx` — use `pnpm dlx` instead of `npx`.
- Biome for linting/formatting. No ESLint or Prettier. Single quotes, semicolons only as needed (matching `biome.jsonc` `quoteStyle: "single"`, `semicolons: "asNeeded"`).
- Always use `Number.parseInt` / `Number.parseFloat`, never the global forms.

### Schemas
- Numeric schema fields that must be positive must use `.positive()` (or `.min(1)`). Numeric schema fields that must be whole numbers must also use `.int()`. Port-like fields must use `.int().min(1).max(65535)`.

### Conventions
- Conventional Commits. Semantic Versioning. Release config lives in `.semrelrc`.
- `.gitignore` must cover all generated/cached artifacts including CI-specific directories (e.g., `.pnpm-store/`).

### Sync
- All example files must stay in sync: `config.example.yml`, `docker/docker-compose.example.yml`, `docker/docker-compose.local.example.yml`. When a config option is added or changed, update every example.
- `CONTRIBUTING.md` must stay in sync with actual coverage thresholds (`vitest.config.ts`), project structure, and development workflow.
- `HOME_ASSISTANT.md` must stay in sync with MQTT topic payloads and HA automation examples.
- README project structure must match the actual directory layout — no phantom paths.
- `.nvmrc`, `package.json` `engines` field, and Docker build args must agree on the required Node.js version.

### Docker
- Production Dockerfile (`docker/Dockerfile`) uses hardened `dhi.io/node` base images. Do not change to standard Node images. `Dockerfile.local` uses standard Alpine for development.

### Domain
- Appliance classes must extend `BaseAppliance` and be registered in the factory.
- Home Assistant auto-discovery payloads must conform to the HA MQTT discovery specification. `name: ''` in discovery payloads is intentional — HA convention where the entity inherits the device name.
- HA state templates and normalized state use **lowercase** values (e.g., `'auto'`, `'on'`, `'fan_only'`). HA command templates send **uppercase** (e.g., `'AUTO'`, `'ON'`). Incoming MQTT commands must be normalized to lowercase before merging with cached state or publishing feedback.
- MQTT topic structure must be consistent and documented.

### Config schema architecture
- `envSchema` handles pre-processing (coercion, defaults). Final validation (URL format, enum values, regex) happens through `configSchema`. Constraints do not need to be duplicated in both schemas.

### Telemetry backend
- Rate limiting must run **before** input validation — malformed requests must still consume rate limit quota to prevent flooding.

## Verification

After any code change:
1. Run `pnpm check` — fix any findings (lint + format via Biome).
2. If `src/`, `tests/`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `vitest.setup.ts`, or `biome.jsonc` changed:
   - Run `pnpm typecheck` — fix any type errors.
   - Run `pnpm test` — all tests must pass.
3. Skip typecheck/test for documentation-only or config-only changes (`.md`, `.claude/`, `.gitlab-ci.yml`, `.gitignore`, `LICENSE`).

## Skills

- `/audit` — full codebase audit (deps, lint, typecheck, tests, manual review). See [.claude/rules/review.md](.claude/rules/review.md) for the checklist.
- `/implement <description>` — implement any code change (feature, refactor, bugfix) following the checklists in [.claude/rules/implementation.md](.claude/rules/implementation.md).

## Context files

Read the relevant file **before starting work** — the skills do this automatically, but follow the same practice for ad-hoc requests:

| File | Read when… |
|------|-----------|
| [.claude/rules/implementation.md](.claude/rules/implementation.md) | You are about to write, edit, or delete any code in `src/`, `telemetry-backend/`, `docker/`, or `tests/` |
| [.claude/rules/review.md](.claude/rules/review.md) | You are asked to review, audit, or check the codebase |

## Self-maintenance

Proactively suggest updates to `CLAUDE.md`, `.claude/rules/`, or `.claude/skills/` whenever you notice something that would help future sessions. The bar for suggesting is low — if you hesitate even briefly about whether something belongs in the instructions, suggest it. Always ask the user before writing, and present the content you'd like to add.

**When to suggest updates:**
- A rule produced a **false positive** (e.g., flagging test-only exports as dead) — tighten the rule or add a clarifying exception.
- You encountered a **domain convention** that isn't documented (e.g., HA expects lowercase values, API sends uppercase) — add it so future sessions don't rediscover it.
- A review or audit **missed something** because no checklist item covered it — add the checklist item.
- A **workaround or gotcha** came up during implementation that would trip up a future session.
- You notice an existing rule is **ambiguous, outdated, or conflicts** with another rule — propose a fix.
- A repeatable workflow would benefit from a **skill** (saved prompt with checklist) — suggest creating one in `.claude/skills/`.
