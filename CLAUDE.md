# CLAUDE.md

## Project

Electrolux-to-MQTT bridge — TypeScript service connecting Electrolux appliances to Home Assistant via MQTT auto-discovery. Uses pnpm, Biome, Vitest. Includes standalone `telemetry-backend/` for anonymous usage statistics.

## Rules

### TypeScript
- Never use `any`. Use `unknown` + type guards. No `as` without runtime check. No `// @ts-ignore`. No non-null assertions (`!`).
- Keep `strict: true` and `noUncheckedIndexedAccess: true`.
- State/config files read from disk must be validated, not blindly cast.

### Code quality
- No `console.log` in `src/` — use `src/logger.ts` (pino). Exceptions: `console.*` in `src/config.ts`, `src/init.ts`, `src/logger.ts` (pre-pino bootstrap). `telemetry-backend/` uses `console.*` directly.
- No silent error swallowing (empty `catch {}`) unless fallback is documented. No try/catch fallback patterns.
- Retry loops: exponential backoff with max delay. No unbounded fixed-delay retries.
- No hardcoded secrets outside test fixtures.
- No dead exports, fields, or type variants. Test files (`tests/`) count as importers. Exception: raw API unions in `src/types.d.ts` reflecting known API values (E2E snapshots) must be kept.
- Every config/schema field must be functional. No empty directories.

### Tooling
- `pnpm` only (never npm/yarn; `pnpm dlx` instead of npx). Never `pnpm dlx` for tools already installed locally — use `pnpm` scripts instead. Biome for lint/format (no ESLint/Prettier), single quotes, semicolons as needed per `biome.jsonc`.
- `Number.parseInt` / `Number.parseFloat` only, never global forms.
- SonarQube Cloud: all code must pass — no bugs, vulnerabilities, security hotspots. Cognitive complexity ≤ 15.
- Conventional Commits. Semantic Versioning. Release config in `.semrelrc`. `chore(deps)` triggers patch release.
- Never `git push` — always leave pushing to the human.

### Sync
- Docs, examples, and config files must stay in sync with code.
- Follow `.claude/rules/implement.md` when making code changes.
- `.nvmrc`, `package.json` `engines`, and Docker build args must agree on Node.js version.
- When `.claude/rules/` or `.claude/skills/` change, update `AI_DEVELOPMENT.md`.
- `.gitignore` must cover all generated/cached artifacts.

### Docker
- Production Dockerfile (`docker/Dockerfile`) uses hardened `dhi.io/node` base images — do not change. `Dockerfile.local` uses standard Alpine.

### Domain
- Appliance classes must extend `BaseAppliance` and be registered in the factory.
- HA discovery payloads must conform to MQTT discovery spec. `name: ''` is intentional (entity inherits device name).
- Normalized state and HA templates use **lowercase**. `transformMqttCommandToApi()` is the sole denormalization authority (`medium`→`MIDDLE`, `fan_only`→`FANONLY`). Normalize incoming MQTT commands to lowercase before merging with cached state.

### Config schema
- `envSchema` pre-processes (coercion, defaults). `configSchema` validates (URL format, enum values, regex). Each constraint in exactly one schema.
- Config loads from YAML file OR env vars, never a mix. Both go through `configSchema`. Schema is source of truth for defaults.

## Verification

After any code change:
1. `pnpm check` — fix lint/format findings.
2. If `src/`, `tests/`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `vitest.setup.ts`, or `biome.jsonc` changed: run `pnpm typecheck`, `pnpm test`, `pnpm sonar` — fix all.
3. If `telemetry-backend/` changed: run `cd telemetry-backend && pnpm typecheck`.
4. Skip steps 2–3 for doc/config-only changes (`.md`, `.claude/`, `.gitlab-ci.yml`, `.gitignore`, `LICENSE`).

## Self-maintenance

Suggest updates to `CLAUDE.md` or `.claude/skills/` when you notice gaps. Always ask before writing.
