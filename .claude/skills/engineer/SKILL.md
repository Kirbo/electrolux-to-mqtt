---
name: engineer
description: TDD workflow + per-change-type file checklists for implementation, refactor, or bug-fix work touching src/, tests/, docker/, or telemetry-backend/. Follow this before writing production code in those areas — tests first, full verification must pass.
---

# Engineer — TDD workflow + file checklists

You implement, refactor, and fix bugs yourself, in-loop, at the current session model. No subagent spawning. Uncompromising TDD: red-green-refactor. Never write production code without a failing test justifying it. Follow CLAUDE.md for all TypeScript, code-quality, tooling, Docker, and domain rules.

## TDD workflow (non-negotiable)

1. **Red** — smallest failing test expressing the next behavior increment. Run it. Confirm it fails for the right reason.
2. **Green** — minimum production code to pass. Resist over-engineering.
3. **Refactor** — tests green → improve design (extract, rename, dedupe, clarify). Re-run after every change.
4. Repeat in small increments.

Before any production line ask: *which test justifies this?* Can't answer → write the test first.

## Per-task workflow

1. **Clarify intent** — restate the requirement, identify acceptance criteria, ask if ambiguous. No guessing on material decisions.
2. **Survey code** — read relevant files; understand patterns, test setup, integration points. Consult the file checklist below for the applicable change type.
3. **Plan test cases** — list behaviors before writing tests; include edge cases + failure modes.
4. **Red-green-refactor** — one test at a time, run frequently.
5. **Verify** — run the full pipeline (CLAUDE.md § Verification): lint, typecheck, tests, SonarQube/quality gates. Fix all findings.
6. **Summarize** — changes, tests added, how to run, follow-up concerns.

## Domain practices

- MQTT QoS: 0 telemetry, 1 commands. Normalize at the boundary.
- Test behavior, not implementation. Mock at the system boundary only. No `.skip` / `.only`. Every test needs ≥1 `expect`.
- Cover error paths (reconnection, timeouts, malformed payloads) as thoroughly as happy paths.
- Robustness: file writes must tolerate a read-only filesystem (prod Docker is read-only); never revert UI state on HA validation rejection — let the poll cycle correct it.

## Quality gates

- [ ] Every behavior covered by a test that failed before implementation.
- [ ] Full verification pipeline passes (CLAUDE.md § Verification).
- [ ] Docs / examples / config in sync with code.

## File checklists

### Rules

- TDD: write tests first for `src/` changes. Skip only if purely structural. Every test needs ≥1 `expect`.
- User-facing change → update user-facing `*.md` docs.
- Numeric schemas: `.positive()` / `.min(1)` for positive, `.int()` for whole numbers, `.int().min(1).max(65535)` for ports.

### Breaking changes (`<type>!:` commit)

- No extra CI changes needed — release versioning in `.gitlab/ci/01_init.yml` is version-agnostic (CalVer, date-derived). The `!` routes the entry to the top "Breaking Changes" changelog section; add a `docs/MIGRATION.md` entry.

### Config (`src/config.ts`) — any add, modify, or delete of a config option

- `config.example.yml`
- `docker/docker-compose.example.yml`
- `docker/docker-compose.local.example.yml`
- `README.md` — **four** locations: env var table, `docker run` snippet, docker-compose snippet, Portainer inline YAML
- `tests/config.test.ts` — valid + invalid cases for the new/changed field

### Appliance support

`src/appliances/<model>.ts`, `factory.ts`, `normalizers.ts`*, `src/types/normalized.ts`*, `src/types/homeassistant.ts`*, `tests/appliances/<model>.test.ts`, `base.test.ts`*, `factory.test.ts`, `normalizers.test.ts`*
(*if the interface / logic changed)

### API types (`src/types.d.ts`, `src/types/normalized.ts`)

Run E2E snapshot validation (see the `/audit` skill § E2E snapshots). Raw API union values belong in `src/types.d.ts` (pre-normalization); normalized values in `src/types/normalized.ts`.

### Version-checker (`src/version-checker.ts`)

`tests/version-checker.test.ts`, `docs/HOME_ASSISTANT.md`*, `config.example.yml` + compose examples*
(*if payloads / config changed)

### MQTT / HA integration

`src/mqtt.ts`, `src/types/homeassistant.ts`, the relevant appliance `generateAutoDiscoveryConfig()`, `tests/mqtt.test.ts`, `tests/mqtt-events.test.ts`, `tests/electrolux.test.ts`*, `tests/state-differences.test.ts`*, `docs/HOME_ASSISTANT.md`*
(*if behavior changed)

### Docker

`docker/Dockerfile` / `Dockerfile.local`, `.dockerignore`*, compose examples*
(*if needed). Node/Alpine versions are single-sourced in `mise.toml` — edit it and run `pnpm sync:versions` (never hand-edit the derived files).

### Badge serving + legacy ingest (`telemetry-backend/`)

Single long-running HTTP service (Node built-in `http`, no Express/Redis): reads Aptabase ClickHouse behind `ClickHouseLike`, serves SVG badges + `/telemetry.json` in-memory, forwards legacy `POST /telemetry` via `AptabaseForwarder`. Regenerates every `BADGE_INTERVAL_SECONDS`.
- Behavior change → tests in `telemetry-backend/tests/` (Vitest + `FakeClickHouse` + `FakeBadgeStore` helpers).
- Build / compose change → update `Dockerfile`, `docker-compose.yml`, `README.md`.

## Escalation & honesty

- Test can't be written cleanly → a design signal. Refactor production code to be testable. Don't lower the bar.
- Requirement needs a rule violation (e.g. `any`) → stop, surface the conflict, no silent break.
- Bug outside task scope → report it. No silent fixes.
- Never claim completion unverified. Run the commands; report actual output.

## Memory

Durable cross-session learnings live in `.claude/agent-memory/shared/` (own file with frontmatter + a one-line pointer in `shared/MEMORY.md`). Record reusable TypeScript/Node integration patterns, test fixtures/fakes + locations, failure modes + reproducible setups, backoff/retry conventions, Zod/type-guard patterns, and tooling quirks (Vitest, Biome, Docker build args). Do **not** save code/architecture (derivable), git history, debug recipes, or anything already in CLAUDE.md. Verify a memory against current code before acting on it.
