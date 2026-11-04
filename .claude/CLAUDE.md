# CLAUDE.md

## Project

Electrolux→MQTT bridge. TS service: Electrolux appliances → Home Assistant via MQTT auto-discovery. pnpm, Biome, Vitest.

## Commands

| Command | What |
|---|---|
| `pnpm dev` | `node --watch src/index.ts` — Node runs the TypeScript directly (built-in type stripping); there is no build step, `tsc` only type-checks |
| `pnpm dev:docker` / `pnpm backend:docker` | Rebuild + run local / telemetry-backend compose stack |
| `pnpm test:e2e` | `tests/e2e/*.test.ts` with `E2E_TEST=true`. Override ntfy topic via `E2M_NTFY_TOPIC` |
| `pnpm sonar` | SonarQube scanner under `fnox exec -P sonar` (token from fnox, see `docs/SECRETS.md`). Skips on any branch but `main` (free tier) |
| `pnpm osv-scan [root\|backend\|all]` | osv-scanner vuln scan — default `all`; `brew install osv-scanner` or Docker fallback |
| `pnpm docker:test [prod\|local\|backend\|all]` | Build each image + smoke-run it offline; catches files missing from the build context. Substitutes a stock base when `dhi.io` is unreachable (CI has the entitlement, so it tests the real hardened image) |
| `pnpm deps:check` / `pnpm deps:update` | `pnpm outdated` + `pnpm audit` + `pnpm osv-scan` / `pnpm update --latest` |
| `pnpm sync:versions` | Derive the `package.json` version fields (`engines.node` + `@types/node` in both packages, `packageManager`, `alpineVersion`, `corepackVersion`) from `versions.env`, re-resolving lockfiles (also: `mise run sync-versions`) |

## Architecture — what the code doesn't tell you

- `src/index.ts` wires `ElectroluxAuth` → `ElectroluxApi` → `StateSync`, `Mqtt`, `Orchestrator`.
- The state cache holds **normalized state only** (`cache.getState` / `setState`) — every republish sends it as-is.
- Discovery payloads come from the appliance instance (`generateAutoDiscoveryConfig`), never the MQTT layer.
- Telemetry pings on its own fixed 15-min cadence, decoupled from `checkInterval`. Session id = HMAC-SHA256(key = API key, msg = username) as a UUID — keyed so it can't be confirmed from an email; the badge counts distinct `session_id` over a rolling 26h window.
- `telemetry-backend/` (own pnpm package: `cd telemetry-backend && pnpm test|typecheck|build`) = badge generator + legacy `POST /telemetry` forwarder. Legacy bridges map to plain `sha256(username)`, so a legacy→direct upgrade gets a new id once. Delete the ingest half once `source=legacy` traffic drops to ~0.
- Raw API unions in `src/types.d.ts` (pre-normalization) and `src/types/normalized.ts` must match `tests/e2e/snapshots/<model>/`. File checklists: `/engineer`; audits: `/audit`; deps: `/maintain`.

## Subagents

Single-agent by default: do `src/` / `tests/` / `docker/` / `telemetry-backend/` work yourself, in-loop, at the session model. The detailed workflows live in skills — follow `/engineer` (TDD + per-change-type checklists) for code work, `/audit` for audits, `/maintain` for dependency work. Spin up generic sub-agents only for genuine parallel fan-out (e.g. independent searches across many files) — spawn built-in `general-purpose` lanes with `model: "sonnet"` for routine work and the session model only when a lane needs deep reasoning (global rule in `~/.claude/CLAUDE.md`). Implementation work itself stays in-loop at the session model — never offload it to a cheaper agent.

## Rules

### TypeScript
- Never `any`. Use `unknown` + type guards. No `as` without runtime check. No `// @ts-ignore`. No non-null assertions (`!`).
- Keep `strict: true`, `noUncheckedIndexedAccess: true`. `telemetry-backend/tsconfig.json` must maintain the same settings — don't let the backend drift weaker.
- Validate state/config files from disk, don't cast blindly.
- Node runs `src/*.ts` directly (type stripping): erasable syntax only — no enums, namespaces or constructor parameter properties; imports use `.ts` specifiers (`#/types.d.ts` for the raw API types); type-only imports are `import type`. tsconfig enforces all three.

### Code quality
- No `console.log` in `src/` — use `src/logger.ts` (pino). Exceptions: pre-pino bootstrap files (`config.ts`, `logger.ts`). `telemetry-backend/` uses `console.*` directly.
- No silent error swallowing (empty `catch {}`) unless fallback documented. No try/catch fallback patterns.
- Retry loops: exponential backoff with max delay. No unbounded fixed-delay retries.
- No hardcoded secrets outside test fixtures. Every real secret lives in `fnox.toml` (age ciphertext, per-tier recipients) — see `docs/SECRETS.md`; never a committed `.env`, never a new plain GitLab variable.
- No dead exports, fields, type variants. `tests/` count as importers. Exception: raw API unions in `src/types.d.ts` (E2E snapshots) must stay.
- Every config/schema field functional. No empty directories.

### Tooling
- `pnpm` only (never npm/yarn; `pnpm dlx` not npx). Never `pnpm dlx` for locally installed tools — use `pnpm` scripts. Biome lint/format (no ESLint/Prettier), single quotes, semicolons per `biome.jsonc`.
- `Number.parseInt` / `Number.parseFloat` only, never global forms.
- SonarQube Cloud: all code must pass — no bugs, vulnerabilities, security hotspots. Cognitive complexity ≤ 15.
- Conventional Commits. **CalVer** versioning — `YYYY.M.MICRO` stable, `YYYY.M.MICRObN` beta — date-derived in CI (`scripts/compute-calver-*.sh`), **not** type-derived. Changelog format in `cliff.toml` (git-cliff generates per-release notes; `combine-changelogs` aggregates the full `CHANGELOG.md`).
- **Commit type drives the changelog section, not the version** — CalVer has no minor/patch bump. `feat:`→Feature, `fix:`→Bug Fixes, `docs:`→Documentation, etc. (full mapping in `cliff.toml`).
  - `<type>!:` (e.g. `feat!:`, `fix!:`) = **breaking change**, `!` **mandatory**. Routes to the top "Breaking Changes" changelog section; add a `docs/MIGRATION.md` entry. `BREAKING CHANGE:` footer is nice-to-have (renders as a fenced note).
- **A release is cut by file paths, not commit type** — the CI gate (`.rules_code_changes`) fires on `src/`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `docker/Dockerfile`, `docker/compat/`, `tsconfig.json`. Tests and vitest config are deliberately excluded (they don't ship). Pure docs / `tests/` / `.claude/` / CI-config / `telemetry-backend/`-only changes don't release. Still pick the conventional type that fits (it sets the changelog section).
- `git push` only when the user explicitly tells you to push. Never push on your own — not after a commit, not to "finish up". No explicit push instruction → leave it to the human.
- Never `git checkout` / switch branches — leave to human. Commit to whatever branch is currently checked out.

### Sync
- Docs (`*.md`), examples, config files must sync with code.
- **Config options**: add/modify/delete → reflect in `config.example.yml`, both compose examples, all four README locations (env var table, `docker run`, compose snippet, Portainer inline YAML). Full checklist in the `/engineer` skill (§ Config).
- Follow the file checklists in the `/engineer` skill for code changes.
- **Version source: `versions.env`** is the single source of truth for every toolchain/base-image version (plain `KEY=value`, each with a `# renovate:` annotation above it). After editing it run `pnpm sync:versions`; never hand-edit a derived `package.json` value (CI `versions in sync` guards drift) — those copies exist because `package.json` is the release-gated path, so an image-affecting bump cuts a release and a dev-tool bump does not. Dockerfiles/compose take same-named build-args with no defaults. Mechanics: `/maintain`, `docs/CONTRIBUTING.md` § Version sources.
- `@types/node` must never lead the Node runtime major. A version range cannot enforce that (`pnpm update --latest` rewrites the spec whatever it declares), so it is listed under `updateConfig.ignoreDependencies` in **both** `pnpm-workspace.yaml` files and `sync-versions.sh` is its only writer. Never run `pnpm update --latest @types/node` — naming a package explicitly overrides the ignore list.
- When `.claude/skills/` change, update `docs/AI_DEVELOPMENT.md`.
- `.gitignore` must cover all generated/cached artifacts.

### Docker
- **The image's CMD and HEALTHCHECK paths are a public contract.** Updaters that recreate a container (Portainer, Watchtower-style) keep the OLD container's Cmd/Healthcheck, so `node dist/index.js` and `import('./dist/health.js')` must keep working: `docker/compat/legacy-dist/` → `/app/dist/` in the image, checked by `pnpm docker:test`. Never remove those shims or move an entry path without a new shim.
- Prod Dockerfile (`docker/Dockerfile`) uses hardened `dhi.io/node` base images — don't change. `Dockerfile.local` uses standard Alpine.
- **`.dockerignore` is an allowlist** (`*` then `!path`), not a denylist. Adding a file or directory that must reach an image therefore requires an explicit `!entry` — otherwise it is silently absent from the build context and the build fails (or worse, the file is only read at runtime and the image ships broken). All three Dockerfiles share the repo-root context, so the list is the union of their needs.
- After changing `.dockerignore`, any `Dockerfile`, or anything an image consumes, run `pnpm docker:test` — it builds each image and smoke-runs it offline, which is the only check that catches a file missing from the build context. CI job `docker build test` (test stage, runs on every branch) enforces it before a release.

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

Origin freshness is automated — do NOT fetch manually before every task. A SessionStart hook (`.claude/hooks/check-origin-freshness.sh`, throttled to one fetch per 6h via a marker in `.git/`) injects a warning into context when the branch is behind, and a PreToolUse gate (`require-branch-sync.sh`) hard-blocks `git commit` on a behind branch. If the session-start warning fired (branch behind or fetch failed), tell the user and sync before starting commit-bound work — not after. Only fetch manually when a warning fired, the commit gate asks, or the session has clearly spanned days.

Two triggers, both need user initiation:
1. User explicitly asks ("commit", "commit this", "make a commit") → run verification (§ Verification) if any code changed, then generate message + commit.
2. You think it's a good time to commit → ask, include the proposed message in the question, wait for explicit approval before executing.

Never commit without trigger — not after task, not to save progress, not after fix. If no trigger, stop. User may have more changes in mind.

A commit instruction covers only what was explicitly asked. "Commit X, then do Y" authorizes committing X — Y requires its own separate instruction.

Split into logical chunks — each commit = one coherent change (feature, fix, refactor, docs). No unrelated bundles. No split single logical change. If diff spans multiple concerns, stage + commit separately.

Before `git commit --amend` or `git rebase`: check if commits pushed (`git log origin/HEAD..HEAD` — empty = all pushed). If pushed, stop + ask. If not, proceed.

## Self-maintenance

Suggest updates to `.claude/CLAUDE.md`, `.claude/skills/` when gaps noticed. Ask before updating.
