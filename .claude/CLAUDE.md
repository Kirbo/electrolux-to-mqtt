# CLAUDE.md

## Project

Electrolux-to-MQTT bridge. TypeScript service linking Electrolux appliances to Home Assistant via MQTT auto-discovery. Uses pnpm, Biome, Vitest. Includes standalone `telemetry-backend/` for anon usage stats.

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
| `pnpm deps:check` / `pnpm deps:update` | `pnpm outdated` + `pnpm audit` / `pnpm update --latest` |

Single test: `pnpm vitest run tests/mqtt.test.ts`, or filter by name: `pnpm vitest run -t "pattern"`.

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

API type unions in `src/types.d.ts` and `src/types/normalized.ts` kept in sync with E2E fixtures under `tests/e2e/snapshots/<model>/`. `.claude/agents/engineer.md` per-change-type file checklists. `/audit` + `/maintain` slash-command skills are trigger stubs — workflow, checklists, and rules live in `.claude/agents/auditor.md` and `.claude/agents/maintainer.md`.

## Subagents

Implementation work (changes under `src/`, `tests/`, `docker/`, `telemetry-backend/`) — delegate to `engineer` subagent for TDD workflow. Use `auditor` for `/audit`, `maintainer` for `/maintain`.

## Rules

### TypeScript
- Never `any`. Use `unknown` + type guards. No `as` without runtime check. No `// @ts-ignore`. No non-null assertions (`!`).
- Keep `strict: true`, `noUncheckedIndexedAccess: true`.
- Validate state/config files from disk, don't cast blindly.

### Code quality
- No `console.log` in `src/` — use `src/logger.ts` (pino). Exceptions: pre-pino bootstrap files (`config.ts`, `init.ts`, `logger.ts`). `telemetry-backend/` uses `console.*` directly.
- No silent error swallowing (empty `catch {}`) unless fallback documented. No try/catch fallback patterns.
- Retry loops: exponential backoff with max delay. No unbounded fixed-delay retries.
- No hardcoded secrets outside test fixtures.
- No dead exports, fields, type variants. Test files (`tests/`) count as importers. Exception: raw API unions in `src/types.d.ts` reflecting known API values (E2E snapshots) must stay.
- Every config/schema field functional. No empty directories.

### Tooling
- `pnpm` only (never npm/yarn; `pnpm dlx` instead of npx). Never `pnpm dlx` for locally installed tools — use `pnpm` scripts. Biome for lint/format (no ESLint/Prettier), single quotes, semicolons per `biome.jsonc`.
- `Number.parseInt` / `Number.parseFloat` only, never global forms.
- SonarQube Cloud: all code must pass — no bugs, vulnerabilities, security hotspots. Cognitive complexity ≤ 15.
- Conventional Commits. Semantic Versioning. Release config in `.semrelrc`. `chore(deps)` triggers patch release.
- Never `git push` — leave to human.

### Sync
- Docs (`*.md`), examples, config files must sync with code.
- Follow file checklists in `.claude/agents/engineer.md` for code changes.
- `.nvmrc`, `package.json` `engines`, Docker build args must match Node.js version.
- When `.claude/agents/` or `.claude/skills/` change, update `AI_DEVELOPMENT.md`.
- `.gitignore` must cover all generated/cached artifacts.

### Docker
- Prod Dockerfile (`docker/Dockerfile`) uses hardened `dhi.io/node` base images — don't change. `Dockerfile.local` uses standard Alpine.

### Domain
- Appliance classes extend `BaseAppliance` + register in factory.
- HA discovery payloads conform to MQTT discovery spec. `name: ''` intentional (entity inherits device name).
- Normalized state + HA templates use **lowercase**. `transformMqttCommandToApi()` sole denormalization authority (`medium`→`MIDDLE`, `fan_only`→`FANONLY`). Normalize incoming MQTT commands to lowercase before merging with cached state.

### Config schema
- `envSchema` pre-processes (coercion, defaults). `configSchema` validates (URL format, enum values, regex). Each constraint in exactly one schema.
- Config loads from YAML file OR env vars, never mixed. Both go through `configSchema`. Schema = source of truth for defaults.

## Verification

After code change:
1. `pnpm check` — fix lint/format findings.
2. If `src/`, `tests/`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `vitest.setup.ts`, or `biome.jsonc` changed: run `pnpm typecheck`, `pnpm test`, `pnpm sonar` — fix all.
3. If `telemetry-backend/` changed: run `cd telemetry-backend && pnpm typecheck && pnpm test`.
4. Skip steps 2–3 for doc/config-only changes (`.md`, `.claude/`, `.gitlab-ci.yml`, `.gitignore`, `LICENSE`).

## Commits

Never commit unless told explicitly. User decides when ready — may have more work for same commit. Don't commit after task, don't commit "to save progress", don't commit after fix. Wait for explicit instruction like "commit this" or "make a commit".

You may suggest committing ("ready to commit when you are"), but never run `git commit` until the user agrees. The `/caveman-commit` skill only generates a commit message — do not follow it with `git commit` automatically. Wait for the user to confirm.

Split into logical chunks — each commit = one coherent change (feature, fix, refactor, docs). Don't bundle unrelated changes. Don't split single logical change across commits. If staged diff spans multiple concerns, stage + commit separately.

Before `git commit --amend` or `git rebase`: check if target commits pushed to origin (`git log origin/HEAD..HEAD` — empty = all on origin). If pushed, stop + ask user. If not pushed, proceed.

## Self-maintenance

Suggest updates to `.claude/CLAUDE.md`, `.claude/agents/`, or `.claude/skills/` when gaps noticed. Always ask before updating.
