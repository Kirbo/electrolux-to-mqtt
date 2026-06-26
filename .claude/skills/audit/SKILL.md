---
name: audit
description: Full codebase audit — lint, typecheck, tests, manual review
disable-model-invocation: true
---

# Audit — rigorous codebase audit

You run this audit yourself, in-loop, at the current session model. No subagent spawning. Combine automation + human review to surface what automation misses. Reports findings; you only fix on explicit user approval (Phase 4).

Strict phases. No skip, no reorder. Report after each phase before the next.

## Phase 1: Automated checks

Run all commands regardless of failures — collect all output. No fixes this phase; capture failures verbatim, continue.

1. `pnpm check` — lint and format (Biome)
2. `pnpm typecheck` — TypeScript strict mode
3. `pnpm test` — Vitest full suite
4. `pnpm sonar` — SonarQube Cloud (bugs, vulnerabilities, security hotspots, cognitive complexity ≤ 15)
5. If `telemetry-backend/` changed or in scope: `cd telemetry-backend && pnpm typecheck && pnpm test`
6. If `pnpm-lock.yaml` or `telemetry-backend/pnpm-lock.yaml` changed: `pnpm osv-scan all`

Capture exact output for failures. No paraphrase.

> SonarCloud branch gate: `scripts/sonar.sh` exits 0 with a "Skipping SonarCloud: branch X is not main" message on any non-`main` branch (free-tier limit). That is documented behavior, not a regression — but it means cognitive-complexity analysis does NOT run off `main`. Manually inspect any new/changed function for complexity > 15 when auditing a non-`main` change set.

## Phase 2: Manual review

Always proceeds — Phase 1 failures are reported in Phase 3, not a blocker.

Work the checklist below. Confirm each item by reading actual file content. The checklist is a minimum baseline — flag unlisted issues too. No memory writes this phase (reconciliation is Phase 7).

Extra robustness checks beyond the checklist:
- File writes handle a read-only filesystem gracefully (prod Docker is read-only).
- No UI state reverts on HA validation rejection (let the poll cycle correct it).

### 1. Configuration
- [ ] `configSchema` matches `config.example.yml`
- [ ] `envSchema` covers all env var alternatives
- [ ] Zod constraints appropriate (min/max, regex, defaults)
- [ ] Every config field used + tested (valid + invalid)

### 2. TypeScript patterns
- [ ] `as` assertions have runtime checks — grep ` as ` in `src/`
- [ ] Classes with interfaces declare `implements`
- [ ] Retry logic uses exponential backoff with a cap
- [ ] No function exceeds cognitive complexity 15

### 3. Appliance support
- [ ] All classes extend `BaseAppliance`; `factory.ts` handles all types
- [ ] Normalizers produce consistent `NormalizedState`
- [ ] `transformMqttCommandToApi()` maps all commands
- [ ] `deriveImmediateStateFromCommand()` handles all types
- [ ] `generateAutoDiscoveryConfig()` produces valid payloads

### 4. MQTT / HA
- [ ] Topic structure consistent (`{prefix}/{applianceId}/state`, `/command`)
- [ ] HA discovery payloads conform to spec
- [ ] QoS/retain correct; reconnection robust
- [ ] Commands validated before forwarding to the API

### 5. Tests
- [ ] Every public function has unit tests
- [ ] Every test has an `expect` assertion
- [ ] Config: YAML, env vars, missing, invalid
- [ ] Appliances: normalization, commands, HA discovery
- [ ] MQTT events: connect, disconnect, message, error
- [ ] Edge cases: empty state, malformed responses, network errors

### 6. Doc/code sync
- [ ] Compose examples include all config/env options
- [ ] Documented env vars match `envSchema`
- [ ] `package.json` scripts/engines match README
- [ ] README appliance list matches classes
- [ ] `docs/HOME_ASSISTANT.md` matches implementation
- [ ] `docs/CONTRIBUTING.md` thresholds/structure match codebase
- [ ] `.claude/` instruction-file changes reflected in `docs/AI_DEVELOPMENT.md`

### 7. Config files
- [ ] `biome.jsonc` scope matches scripts
- [ ] `tsconfig.json` strict enabled
- [ ] `vitest.config.ts` excludes/thresholds correct
- [ ] Node/Alpine versions agree across all derived files — single-sourced in `mise.toml`; run `pnpm sync:versions` and confirm `git diff` is clean (CI job `versions in sync` guards drift)
- [ ] `cliff.toml` + `scripts/compute-calver-*.sh` correct; CI release flow (git-cliff + combine-changelogs) matches local workflow
- [ ] Docker builds minimal (incl. `telemetry-backend/`)

### 8. Security
- [ ] Credentials never logged
- [ ] `config.yml` in `.gitignore`
- [ ] Docker images exclude dev deps (`--prod`)
- [ ] `.dockerignore` excludes secrets
- [ ] Production uses `dhi.io/node` hardened images
- [ ] Env var fallbacks don't expose sensitive defaults
- [ ] Plaintext `.env` files gitignored; only `*.env.enc` (SOPS) committed

### 9. Telemetry backend
- [ ] Single Node `http` service (no Express/Redis); multi-stage Dockerfile, dev deps stripped
- [ ] No hardcoded secrets / unsafe defaults
- [ ] Input validation on all endpoints
- [ ] Rate limiting on `POST /telemetry` runs **before** validation; GET badge routes serve cached in-memory SVGs
- [ ] Request body size is bounded
- [ ] `docker-compose.yml` env vars match code; `README.md` complete

### 10. E2E snapshots

> **Mandatory when `config.yml` exists.** Run `test -f config.yml` — `config.yml` is gitignored and will NOT appear in `git status`, `git ls-files`, or any git-aware tool. Do not infer absence from git output.
> - File **missing** → skip this section entirely.
> - File **present** → run ALL items below. No scope-based skipping. "Changes don't touch normalizers/types/appliances" is NOT a valid reason to skip when the file exists.

- [ ] `pnpm test:e2e` passes
- [ ] Per model in `tests/e2e/snapshots/{model}/`:
  - [ ] State keys covered by `Appliance['properties']['reported']`
  - [ ] Capability values covered by `ApplianceInfo['capabilities']`
  - [ ] Enum values have normalized variants in `normalized.ts`
  - [ ] Mode constraints match `validateCommand()` + test data
- [ ] `appliances-list.json` matches the `ApplianceStub` type

## Phase 3: Report

Structured report: summary (PASS / PASS WITH FINDINGS / FAIL), automated-check output verbatim, manual findings grouped by severity (BLOCKER / MAJOR / MINOR / NIT) with file:line + fix, positive observations, prioritized actions. No inflated severities.

## Phase 4: Triage + fix (interactive gate)

Zero findings → skip to Phase 7.

Otherwise draft a fix plan: pre-mark BLOCKER + MAJOR + MINOR findings for fixing; list NIT findings without pre-marking. Present the plan to the user and **wait for explicit approval** — the user decides what gets fixed, dropped, or added. No fixes without approval. User says "none" / "skip" → go to Phase 7.

For approved items, fix them yourself in-loop, following the `/engineer` skill's TDD workflow + file checklists. Then re-run the targeted checks (Phase 1 commands relevant to the changed files). If a finding is still present or verification fails → **STOP** and report the gap; do not loop indefinitely.

## Phase 7: Memory reconciliation

Final phase. Runs every invocation — even zero-findings runs. Memory is never written during Phases 2–4.

Update `.claude/agent-memory/shared/` to reflect the END state, not interim findings.

**Record** reusable patterns that outlast individual fixes:
- Recurring violation patterns + detection hints (grep pattern, file glob)
- SonarQube false-positive patterns specific to this codebase
- High defect-density areas, subtle domain rules easy to miss
- Effective anti-pattern search strategies
- Which CLAUDE.md rules are most violated + where

**Do NOT record**: one-off findings (fix in code), open-issue lists (go stale), anything already in CLAUDE.md.

Reconciliation:
- Recurring pattern → save/update with a detection heuristic, not the fix.
- A fix closed an issue matching an entry → UPDATE or REMOVE it.
- Zero findings + an existing entry → verify it's still valid; stale → remove.
- One-off unlikely to recur → skip.

## Operating principles

- **Scope discipline**: audit recently changed code by default; the whole codebase only if the user says so. Doubt → ask.
- **Evidence-based**: every finding cites a file path + line or specific command output. No vague claims.
- **Documented conventions**: check findings against CLAUDE.md rules before flagging — documented patterns are intentional, not violations.
- **Version-gated migration cleanup** — `src/migrate.ts:removeLegacyTokensFile()` is a one-time migration for pre-v1.17.0 upgrades. Before suggesting/flagging it for removal:
  1. Fetch the deployed telemetry endpoint (`https://e2m.devaus.eu/telemetry.json`) and check the reported `versions`.
  2. If any active version is below `1.17.0`: do NOT suggest removal, do NOT flag as dead code.
  3. Only suggest removal (never remove autonomously) once all reported versions are `>= 1.17.0`.
- **Cognitive complexity**: flag any function suspected > 15 even if SonarQube missed it (e.g. new code not yet analyzed, or a non-`main` branch where Sonar skipped).
- **Self-verification**: before finalizing, re-scan findings and drop any without concrete evidence.
- **Escalation**: an ambiguous rule, or a finding that conflicts with CLAUDE.md → surface it in the report, no silent judgment.

## Memory: what NOT to save

Code patterns/architecture (derivable), git history (use git log), debug recipes (fix in code), one-off findings, open-issue lists, anything in CLAUDE.md. Verify a memory against current code before acting on it.
