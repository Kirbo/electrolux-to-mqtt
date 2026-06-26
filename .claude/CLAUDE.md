# CLAUDE.md

## Project

Electrolux→MQTT bridge. TS service: Electrolux appliances → Home Assistant via MQTT auto-discovery. pnpm, Biome, Vitest. Standalone `telemetry-backend/` is a single HTTP service that serves SVG badges (in-memory from Aptabase ClickHouse) and forwards legacy `/telemetry` POSTs to Aptabase — delete the ingest half once `source=legacy` traffic drops to ~0.

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
| `pnpm deps:check` / `pnpm deps:update` | `pnpm outdated` + `pnpm audit` + `pnpm osv-scan` / `pnpm update --latest` |
| `pnpm sync:versions` | Propagate `mise.toml` Node/Alpine to all derived files (also: `mise run sync-versions`) |

Single test: `pnpm vitest run tests/mqtt.test.ts`, or filter: `pnpm vitest run -t "pattern"`.

Telemetry backend separate pnpm package — `cd telemetry-backend && pnpm test` / `pnpm typecheck` / `pnpm build`.

## Architecture

Single long-running process. `src/index.ts` wires `ElectroluxClient`, `Mqtt`, `Orchestrator`, delegates to orchestrator main loop.

- **`Orchestrator`** — polls appliances, periodic discovery, subscribes command topics, clean shutdown. Holds mutable runtime state (with `Cache`).
- **`ElectroluxClient`** — Electrolux API client. OAuth (memory-only tokens, re-authenticates on startup), exponential-backoff retries, normalizers for model-agnostic state.
- **`Mqtt`** — thin broker wrapper behind `IMqtt` interface (testable). Discovery payloads from appliance instance, not MQTT layer.
- **`appliances/`** — `BaseAppliance` abstract → `createAppliance()` factory function. Each owns discovery config, normalization, command denormalization.
- **`config.ts`** — Zod schemas. YAML or env vars, never mixed. `envSchema` coerces/defaults; `configSchema` validates.
- **`cache.ts`** — state cache. Orchestrator diffs vs cache for MQTT publishing.
- **`version-checker.ts`** — periodic release check + ntfy on the user's `checkInterval`, plus anon telemetry to self-hosted Aptabase on its **own fixed 15-min cadence** (`TELEMETRY_PING_INTERVAL_MS`, decoupled from `checkInterval`). `src/telemetry.ts` builds the event (OS/arch + appliance model(s)/count) and `deriveTelemetrySessionId` — the stable per-install session id = `sha256(electrolux username)` formatted as a UUID, matching the backend's legacy `userHashToSessionId` so an install keeps one id across the legacy→direct upgrade. The badge counts distinct `session_id` over a rolling 26h window.
- **`health.ts`** — Docker HEALTHCHECK file touch. Best-effort (read-only fs safe).

`telemetry-backend/` standalone pnpm package. A single HTTP service (Node built-in `http`, no Express) that:
1. Serves SVG badges in-memory — every `BADGE_INTERVAL_SECONDS` (default 300) it reads aggregates from self-hosted Aptabase ClickHouse (`ClickHouseLike` / `FakeClickHouse` in tests) and renders `/users.svg`, `/stable.svg`, `/beta.svg`, `/telemetry.json` (302 at `/`). Responds 503 until first cycle completes.
2. Receives legacy `POST /telemetry {userHash, version, channel}` from old bridge versions and forwards them to Aptabase as `version_check` events (`AptabaseForwarder` interface, testable with a fake). Delete the ingest half once `source=legacy` traffic drops to ~0.

API type unions in `src/types.d.ts` + `src/types/normalized.ts` sync with E2E fixtures under `tests/e2e/snapshots/<model>/`. The `/engineer` skill holds the per-change-type file checklists; the `/audit` + `/maintain` skills hold the full audit + dependency workflows.

## Subagents

Single-agent by default: do `src/` / `tests/` / `docker/` / `telemetry-backend/` work yourself, in-loop, at the session model. The detailed workflows live in skills — follow `/engineer` (TDD + per-change-type checklists) for code work, `/audit` for audits, `/maintain` for dependency work. Spin up generic sub-agents only for genuine parallel fan-out (e.g. independent searches across many files); they inherit the session model. Never delegate to offload work onto a fixed-model agent.

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
- Conventional Commits. **CalVer** versioning — `YYYY.M.MICRO` stable, `YYYY.M.MICRObN` beta — date-derived in CI (`scripts/compute-calver-*.sh`), **not** type-derived. Changelog format in `cliff.toml` (git-cliff generates per-release notes; `combine-changelogs` aggregates the full `CHANGELOG.md`).
- **Commit type drives the changelog section, not the version** — CalVer has no minor/patch bump. `feat:`→Feature, `fix:`→Bug Fixes, `docs:`→Documentation, etc. (full mapping in `cliff.toml`).
  - `<type>!:` (e.g. `feat!:`, `fix!:`) = **breaking change**, `!` **mandatory**. Routes to the top "Breaking Changes" changelog section; add a `docs/MIGRATION.md` entry. `BREAKING CHANGE:` footer is nice-to-have (renders as a fenced note).
- **A release is cut by file paths, not commit type** — the CI gate (`.rules_code_changes`) fires on `src/`, `tests/`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `docker/Dockerfile`, `tsconfig.json`, `vitest.config.ts`, `vitest.setup.ts`. Pure docs / `.claude/` / CI-config / `telemetry-backend/`-only changes don't release. Still pick the conventional type that fits (it sets the changelog section).
- `git push` only when the user explicitly tells you to push. Never push on your own — not after a commit, not to "finish up". No explicit push instruction → leave it to the human.
- Never `git checkout` / switch branches — leave to human. Commit to whatever branch is currently checked out.

### Sync
- Docs (`*.md`), examples, config files must sync with code.
- **Config options**: add/modify/delete → reflect in `config.example.yml`, both compose examples, all four README locations (env var table, `docker run`, compose snippet, Portainer inline YAML). Full checklist in the `/engineer` skill (§ Config).
- Follow the file checklists in the `/engineer` skill for code changes.
- Node/Alpine/sops/age versions are pinned in `mise.toml` (single source); run `mise run sync-versions` (or `pnpm sync:versions`) to propagate to `.nvmrc`, `engines`, Dockerfiles, compose files, and CI; CI job `versions in sync` guards drift.
- When `.claude/skills/` change, update `docs/AI_DEVELOPMENT.md`.
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
5. If `package.json`, `pnpm-lock.yaml`, `telemetry-backend/package.json`, or `telemetry-backend/pnpm-lock.yaml` changed: run `pnpm osv-scan all` locally — CI runs it too but catching CVEs pre-commit avoids roundtrips.

## Commits

Two triggers, both need user initiation:
1. User explicitly asks ("commit", "commit this", "make a commit") → run verification (§ Verification) if any code changed, then generate message + commit.
2. You think it's a good time to commit → ask, include the proposed message in the question, wait for explicit approval before executing.

Never commit without trigger — not after task, not to save progress, not after fix. If no trigger, stop. User may have more changes in mind.

A commit instruction covers only what was explicitly asked. "Commit X, then do Y" authorizes committing X — Y requires its own separate instruction.

Split into logical chunks — each commit = one coherent change (feature, fix, refactor, docs). No unrelated bundles. No split single logical change. If diff spans multiple concerns, stage + commit separately.

Before `git commit --amend` or `git rebase`: check if commits pushed (`git log origin/HEAD..HEAD` — empty = all pushed). If pushed, stop + ask. If not, proceed.

## Self-maintenance

Suggest updates to `.claude/CLAUDE.md`, `.claude/skills/` when gaps noticed. Ask before updating.
