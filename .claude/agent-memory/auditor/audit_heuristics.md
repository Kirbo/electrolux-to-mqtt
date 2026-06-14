---
name: Audit heuristics and anti-patterns
description: Grep patterns, known false-positives, and defect-density areas for this codebase
type: project
---

## Effective grep patterns

- `grep -rn " as " src/ --include="*.ts" | grep -v "// " | grep -v "import " | grep -v "export "` — finds type assertions
- `grep -rn "catch\s*{" src/ telemetry-backend/src/` — finds empty catch blocks
- `grep -rn "parseInt\|parseFloat" src/ | grep -v "Number\."` — finds forbidden globals
- `grep -rn "console\." src/ --include="*.ts"` — finds console usage; only bootstrap files (`config.ts`, `init.ts`, `logger.ts`) permitted

## Known safe patterns (not findings)

- `normalizers.ts`: all `as OnOffState`, `as NormalizedClimateMode`, etc. preceded by `VALID_*.has()` set checks — intentional, not unsafe casts
- `mqtt.ts:11`: `config.mqtt.qos as QoS` — safe because `configSchema` enforces `int().min(0).max(2)` before this executes (comment on prior line documents the guard). (The old `?? 2` fallback was dropped as dead code in the 2026-06-01 review — schema guarantees the default; cast still required for the `0|1|2` narrowing.)
- `telemetry-backend/src/utils.ts:65-67`: the trailing `version.length > 32` check **after** the regex passes is NOT redundant — `validateTelemetryPayload`'s version regex has no upper length bound on the pre-release group, so e.g. `1.0.0-`+30 chars passes the regex at length 36 and only this check rejects it. Do not "simplify" it away. (Nearly mis-flagged as redundant in the 2026-06-01 review.)
- `electrolux.ts`: `tokenPayload as { exp: number; iat: number }` preceded by `typeof` checks both fields — safe
- `normalizers.ts`: `rawState as unknown as Appliance['properties']['reported']` preceded by `'in'` checks three required fields — safe
- Empty catches in `logger.ts` (timezone fallback), `mqtt.ts` (JSON.parse debug log), `electrolux.ts` (URL parse fallback), `health.ts` (read failure returns false), `config.ts` (write failure uses in-memory config) — all documented

## Tooling-config migrations (verify activation, not just acceptance)

When a tooling config key changes during a dep bump (e.g. Biome `linter.rules.recommended: true` → `linter.rules.preset: "recommended"` in Biome 2.5.0), a passing `pnpm check` only proves the config *parsed* — not that rules are still *active*. An unknown/renamed key can be silently ignored. To confirm activation, lint a throwaway snippet that should trip a known recommended rule: `printf 'if (x == 1) {}' > /tmp/t.ts && pnpm biome lint /tmp/t.ts` should flag `lint/suspicious/noDoubleEquals`. If it doesn't, the preset isn't applied. (Verified correct in the 2026-06-14 audit — `preset: "recommended"` does activate the recommended set.)

## Branch-gated SonarCloud skip (not a finding)

`scripts/sonar.sh` exits 0 with "Skipping SonarCloud: branch X is not main (free tier limitation)" on any non-`main` branch. This is documented behavior, not a regression. BUT it means cognitive-complexity analysis does NOT run on non-main work — manually inspect any new/changed function for complexity > 15 when auditing a `next`-branch change set, since Sonar won't catch it.

## Defect-density areas

- `src/electrolux.ts` — most complex; login tries two payload structures in sequence; watch for new code duplicating pattern
- `src/config.ts` — YAML vs env config loading; `handleValidationError` / `process.exit` must not run in test mode (guarded by `process.env.VITEST`)

## Telemetry-backend observations

- Rate limiting before payload validation in POST /telemetry — correct per CLAUDE.md checklist
- `express.json({ limit: '10kb' })` — size limit present
- Multi-stage Dockerfile, dev deps stripped — correct
- `RATE_LIMIT_SALT` defaults to machine-id or hostname — not hardcoded secret

## Watch patterns

### `noUncheckedIndexedAccess` + index-style loops
`tsconfig.json` has `noUncheckedIndexedAccess: true`. `arr[i]` types as `T | undefined`; TypeScript does NOT narrow from bounds-check loop condition. Prefer `for...of` + `.entries()` over `for (let i = 0; i < arr.length; i++)`. Exception: `(T|undefined) || 0` coerces to number, accepted (see `version-checker.ts`'s `parts1[i] || 0`).

## E2E test gating vs live backends

`tests/e2e/version-checker.e2e.test.ts` "should send telemetry to backend" uses `ctx.skip()` only on `axios 400 + 'userHash length is invalid'` — signalling `ALLOW_TEST_TELEMETRY=false` on live backend. Any other error (e.g. `429` rate-limit) correctly surfaces as a test failure by design (CLAUDE.md "no silent error swallowing"). When auditing, do NOT flag 429 or similar as a code regression — it's environmental flake on the live telemetry backend, not a gating gap.

## API type union maintenance

`src/types.d.ts` union values must match E2E snapshots exactly. Normalizer transforms value (e.g., `'running'` -> `'on'`): pre-normalization value belongs in `types.d.ts`, NOT post-normalization. Post-normalization values live in `src/types/normalized.ts`. Example: `applianceState` in `types.d.ts` is `'off' | 'running'`, not `'on' | 'off'`.

## `.claude/rules/` directory removed

As of 2026-04-13, `.claude/rules/` gone. Checklists moved into `.claude/agents/engineer.md`. Don't reference `.claude/rules/` in watch patterns or audit checks.

## `config.yml` is gitignored — do not infer absence from git tooling

`config.yml` in project root holds real Electrolux credentials, listed in `.gitignore`. Won't appear in `git status`, `git ls-files`, or git-aware searches, but present on disk for E2E runs. Verify with direct filesystem check (`ls config.yml` or `test -f config.yml`) — never infer absence from git output.
