---
name: audit
description: Comprehensive codebase audit — lint, typecheck, tests, then manual review
disable-model-invocation: true
context: fork
agent: auditor
model: opus[1m]
effort: max
---

Run comprehensive codebase review. Checklist = minimum baseline — flag unlisted issues, suggest new checklist items.

**Skill audits → plans → delegates → re-verifies → reconciles memory.** Audit phases never patch files directly. Findings drafted into delegation plan (BLOCKER + MAJOR + MINOR pre-marked, NIT listed), presented to user for explicit approval, delegated to `engineer` only on user go-ahead. One delegation cycle per invocation — engineer fails to fix → stop, do not re-delegate.

## Ground rules

- Every finding confirmed by reading actual file content — no assumptions.
- Check findings vs CLAUDE.md rules before flagging — documented conventions intentional.
- Test imports count as external usage (exports used only by tests not dead).
- Audit phases never patch files directly. Fixes happen only via Phase 5 engineer delegation, after Phase 4 user approval.
- One delegation cycle maximum per invocation. Engineer fails → stop + report, do not re-delegate.

## Phases

Execute in order. Each phase gates the next. No skip, no reorder.

### Phase 1 — Automated checks
Parallel: `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm sonar`. Telemetry-backend in scope → add `cd telemetry-backend && pnpm typecheck && pnpm test`. Capture failure output verbatim.

### Phase 2 — Manual review
Work checklist below. Read file content to confirm each item — no assumptions. No memory writes yet — memory reconciliation is Phase 7.

### Phase 3 — Report
Structured report, findings grouped by severity (BLOCKER / MAJOR / MINOR / NIT), each cites file:line + recommended fix. Propose new checklist items for gaps found. Do **not** modify files.

### Phase 4 — Triage plan (interactive gate)
Zero findings → skip to Phase 7. Else draft delegation plan:
- BLOCKER + MAJOR + MINOR pre-marked for `engineer` delegation.
- NIT listed, NOT pre-marked.

Present plan to user. Wait for explicit approval — user decides which items delegate, which drop, which add (e.g. NIT they want fixed). **No delegation without user approval.** User says "none" / "skip" → jump to Phase 7.

### Phase 5 — Delegate (conditional)
User approved items → spawn `engineer` via Agent tool. Single prompt bundling all approved findings: file:line, rule violated, severity, recommended fix, which verification commands must pass. Engineer runs TDD pipeline end-to-end per its own contract. Capture from engineer return: files changed, findings reported fixed, verification pipeline status.

### Phase 6 — Re-verify (conditional, one cycle only)
Phase 5 ran →
1. Read each file engineer reported as changed.
2. Confirm each delegated finding is actually addressed (e.g. `as` cast replaced with guard, not just moved).
3. Re-run only the specific automated checks tied to delegated fixes — NOT full Phase 1.
4. Any finding still present or engineer's verification pipeline failed → **STOP**. Report gap verbatim. Do NOT re-delegate. User re-invokes `/audit` or intervenes manually.

One delegation cycle per `/audit` invocation. No loops.

### Phase 7 — Memory reconciliation
Final phase. Runs every invocation — even zero-findings runs (still verify existing memory current).

Update `.claude/agent-memory/auditor/` to reflect END state of the full cycle, not interim findings:

- Recurring violation pattern (same rule broken across multiple audits) → save/update heuristic memory. Record the pattern + detection hint (grep pattern, file glob), NOT the specific fix.
- Engineer closed an issue matching an existing memory entry → UPDATE or REMOVE that entry. No stale "open gap" memories.
- Zero findings this run + existing entry → verify still valid by reading referenced files. Stale → remove.
- One-off finding unlikely to recur → do not save.

Memory never written during Phases 2–6. All writes, updates, purges happen here.

## Checklist

### 1. Configuration
- [ ] `configSchema` matches `config.example.yml`
- [ ] `envSchema` covers all env var alternatives
- [ ] Zod constraints appropriate (min/max, regex, defaults)
- [ ] Every config field used + tested (valid + invalid)

### 2. TypeScript patterns
- [ ] `as` assertions have runtime checks — grep ` as ` in `src/`
- [ ] Classes with interfaces declare `implements`
- [ ] Retry logic uses exponential backoff with cap
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
- [ ] Commands validated before forwarding to API

### 5. Tests
- [ ] Every public function has unit tests
- [ ] Every test has `expect` assertion
- [ ] Config: YAML, env vars, missing, invalid
- [ ] Appliances: normalization, commands, HA discovery
- [ ] MQTT events: connect, disconnect, message, error
- [ ] Edge cases: empty state, malformed responses, network errors

### 6. Doc/code sync
- [ ] Compose examples include all config/env options
- [ ] Documented env vars match `envSchema`
- [ ] `package.json` scripts/engines match README
- [ ] README appliance list matches classes
- [ ] `HOME_ASSISTANT.md` matches implementation
- [ ] `CONTRIBUTING.md` thresholds/structure match codebase

### 7. Config files
- [ ] `biome.jsonc` scope matches scripts
- [ ] `tsconfig.json` strict enabled
- [ ] `vitest.config.ts` excludes/thresholds correct
- [ ] `.nvmrc`/`engines`/Docker args agree on Node version
- [ ] `.semrelrc` correct; CI matches local workflow
- [ ] Docker builds minimal (incl. `telemetry-backend/`)

### 8. Security
- [ ] Credentials never logged
- [ ] `config.yml` in `.gitignore` (`tokens.json` auto-generated at runtime)
- [ ] Docker images exclude dev deps (`--prod`)
- [ ] `.dockerignore` excludes secrets
- [ ] Production uses `dhi.io/node` hardened images
- [ ] Env var fallbacks don't expose sensitive defaults

### 9. Telemetry backend
- [ ] Multi-stage Dockerfile, dev deps stripped
- [ ] No hardcoded secrets/unsafe defaults
- [ ] Input validation on all endpoints
- [ ] Rate limiting on POST (before validation); GET skips (cached)
- [ ] `express.json()` has size limit
- [ ] `docker-compose.yml` env vars match code; `README.md` complete

### 10. E2E snapshots

> Check presence with `ls config.yml` or `test -f config.yml` — `config.yml` gitignored, will NOT appear in `git status`, `git ls-files`, or any git-aware tool. Do not infer absence from git output. Skip this section only if direct filesystem check confirms file missing.

- [ ] `pnpm test:e2e` passes
- [ ] Per model in `tests/e2e/snapshots/{model}/`:
  - [ ] State keys covered by `Appliance['properties']['reported']`
  - [ ] Capability values covered by `ApplianceInfo['capabilities']`
  - [ ] Enum values have normalized variants in `normalized.ts`
  - [ ] Mode constraints match `validateCommand()` + test data
- [ ] `appliances-list.json` matches `ApplianceStub` type
