# CLAUDE.md

## Project

Electrolux→MQTT bridge. TS service: Electrolux appliances → Home Assistant via MQTT auto-discovery. pnpm, Biome, Vitest. Standalone `telemetry-backend/` for anon usage stats.

## Commands

| Command | What |
|---|---|
| `pnpm dev` | `tsx watch src/index.ts` |
| `pnpm dev:docker` / `pnpm backend:docker` | Rebuild + run local / telemetry-backend compose stack |
| `pnpm check` | Biome lint + format (auto-fix) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest + coverage (all suites under `tests/`) |
| `pnpm test:e2e` | `tests/e2e/*.test.ts` with `E2E_TEST=true`. Override ntfy topic via `E2M_NTFY_TOPIC` |
| `pnpm sonar` | SonarQube scanner (reads `.env`) |
| `pnpm osv-scan [root\|backend\|all]` | osv-scanner vuln scan — default `all`; `brew install osv-scanner` or Docker fallback |
| `pnpm deps:check` / `pnpm deps:update` | `pnpm outdated` + `pnpm osv-scan` / `pnpm update --latest` |

Single test: `pnpm vitest run tests/mqtt.test.ts`, or filter: `pnpm vitest run -t "pattern"`.

Telemetry backend separate pnpm package — `cd telemetry-backend && pnpm test` / `pnpm typecheck` / `pnpm build`.

## Architecture

Single long-running process. `src/index.ts` wires `ElectroluxClient`, `Mqtt`, `Orchestrator`, delegates to orchestrator main loop.

- **`Orchestrator`** — polls appliances, periodic discovery, subscribes command topics, clean shutdown. Holds mutable runtime state (with `Cache`).
- **`ElectroluxClient`** — Electrolux API client. OAuth (persisted to `tokens.json`), exponential-backoff retries, normalizers for model-agnostic state.
- **`Mqtt`** — thin broker wrapper behind `IMqtt` interface (testable). Discovery payloads from appliance instance, not MQTT layer.
- **`appliances/`** — `BaseAppliance` abstract → `ApplianceFactory.create()`. Each owns discovery config, normalization, command denormalization.
- **`config.ts`** — Zod schemas. YAML or env vars, never mixed. `envSchema` coerces/defaults; `configSchema` validates.
- **`cache.ts`** — state cache. Orchestrator diffs vs cache for MQTT publishing.
- **`version-checker.ts`** — periodic release check + ntfy + anon telemetry to `telemetry-backend/`.
- **`health.ts`** — Docker HEALTHCHECK file touch. Best-effort (read-only fs safe).

`telemetry-backend/` standalone pnpm package. HTTP surface behind `RedisLike` interface (testable via `FakeRedis`). Rate limiting before payload validation.

API type unions in `src/types.d.ts` + `src/types/normalized.ts` sync with E2E fixtures under `tests/e2e/snapshots/<model>/`. `.claude/agents/engineer.md` per-change-type checklists. `/audit` + `/maintain` are trigger stubs — workflow + rules in `.claude/agents/auditor.md` + `.claude/agents/maintainer.md`.

## Subagents

`src/`, `tests/`, `docker/`, `telemetry-backend/` changes → delegate to `engineer` subagent (TDD workflow). `auditor` for `/audit`, `maintainer` for `/maintain`.

## Rules

### TypeScript
- Never `any`. Use `unknown` + type guards. No `as` without runtime check. No `// @ts-ignore`. No non-null assertions (`!`).
- Keep `strict: true`, `noUncheckedIndexedAccess: true`. `telemetry-backend/tsconfig.json` must maintain the same settings — don't let the backend drift weaker.
- Validate state/config files from disk, don't cast blindly.

### Code quality
- No `console.log` in `src/` — use `src/logger.ts` (pino). Exceptions: pre-pino bootstrap files (`config.ts`, `logger.ts`). `telemetry-backend/` uses `console.*` directly.
- No silent error swallowing (empty `catch {}`) unless fallback documented. No try/catch fallback patterns.
- Retry loops: exponential backoff with max delay. No unbounded fixed-delay retries.
- No hardcoded secrets outside test fixtures.
- No dead exports, fields, type variants. `tests/` count as importers. Exception: raw API unions in `src/types.d.ts` (E2E snapshots) must stay.
- Every config/schema field functional. No empty directories.

### Tooling
- `pnpm` only (never npm/yarn; `pnpm dlx` not npx). Never `pnpm dlx` for locally installed tools — use `pnpm` scripts. Biome lint/format (no ESLint/Prettier), single quotes, semicolons per `biome.jsonc`.
- `Number.parseInt` / `Number.parseFloat` only, never global forms.
- SonarQube Cloud: all code must pass — no bugs, vulnerabilities, security hotspots. Cognitive complexity ≤ 15.
- Conventional Commits. Semantic Versioning. Release config in `.semrelrc`.
- **Version-bumping types** — only when change touches `src/`, `package.json`, or `pnpm-lock.yaml`:
  - `feat:` → minor bump
  - `fix:` → patch bump
  - `chore(deps):` → patch bump (dep updates only)
  - `<type>!:` → major bump. **Mandatory** for breaking changes — `!` in type is required. `BREAKING CHANGE:` footer is nice-to-have; add when possible but not required. If introducing breaking change, prefer both. **Also update `--maintained-version` in `.gitlab/ci/01_init.yml`** (`1-rc` → `2-rc` etc.) — this controls RC changelog scoping on the `next` branch.
- **Non-bumping types** — CI, docs, config, sonar, `telemetry-backend/`, `.claude/`, scripts: `ci:`, `docs:`, `refactor:`, `test:`, `style:`, `perf:`, `chore:` (without `(deps)`), `build:`.
- Never `git push` — leave to human.
- Never `git checkout` / switch branches — leave to human. Commit to whatever branch is currently checked out.

### Sync
- Docs (`*.md`), examples, config files must sync with code.
- **Config options**: add/modify/delete → reflect in `config.example.yml`, both compose examples, all four README locations (env var table, `docker run`, compose snippet, Portainer inline YAML). Full checklist in `.claude/agents/engineer.md § Config`.
- Follow file checklists in `.claude/agents/engineer.md` for code changes.
- `.nvmrc`, `package.json` `engines`, Docker build args must match Node.js version.
- When `.claude/agents/` or `.claude/skills/` change, update `AI_DEVELOPMENT.md`.
- `.gitignore` must cover all generated/cached artifacts.

### Docker
- Prod Dockerfile (`docker/Dockerfile`) uses hardened `dhi.io/node` base images — don't change. `Dockerfile.local` uses standard Alpine.

### Domain
- Appliance classes extend `BaseAppliance` + register in factory.
- HA discovery payloads conform to MQTT discovery spec. `name: ''` intentional (entity inherits device name).
- Normalized state + HA templates use **lowercase**. `transformMqttCommandToApi()` sole denormalization authority (`medium`→`MIDDLE`, `fan_only`→`FANONLY`). Normalize incoming MQTT commands lowercase before merging with cached state.

### Config schema
- `envSchema` pre-processes (coercion, defaults). `configSchema` validates (URL format, enum values, regex). Each constraint in exactly one schema.
- Config loads from YAML file OR env vars, never mixed. Both go through `configSchema`. Schema = source of truth for defaults.

## Verification

Run after every change. **Verification must pass before commit** — never commit with failing checks:
1. `pnpm check` — fix lint/format findings.
2. If `src/`, `tests/`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `vitest.setup.ts`, or `biome.jsonc` changed: run `pnpm typecheck`, `pnpm test`, `pnpm sonar` — fix all.
3. If `telemetry-backend/` changed: run `cd telemetry-backend && pnpm typecheck && pnpm test`.
4. Skip steps 2–3 for doc/config-only changes (`.md`, `.claude/`, `.gitlab-ci.yml`, `.gitignore`, `LICENSE`).

## Commits

Two triggers, both need user initiation:
1. User explicitly asks ("commit", "commit this", "make a commit") → run verification (§ Verification) if any code changed, then generate message + commit.
2. You think it's a good time to commit → ask, include the proposed message in the question, wait for explicit approval before executing.

Never commit without trigger — not after task, not to save progress, not after fix. If no trigger, stop. User may have more changes in mind.

A commit instruction covers only what was explicitly asked. "Commit X, then do Y" authorizes committing X — Y requires its own separate instruction.

Split into logical chunks — each commit = one coherent change (feature, fix, refactor, docs). No unrelated bundles. No split single logical change. If diff spans multiple concerns, stage + commit separately.

Before `git commit --amend` or `git rebase`: check if commits pushed (`git log origin/HEAD..HEAD` — empty = all pushed). If pushed, stop + ask. If not, proceed.

## Self-maintenance

Suggest updates to `.claude/CLAUDE.md`, `.claude/agents/`, `.claude/skills/` when gaps noticed. Ask before updating.
