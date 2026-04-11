---
name: Audit heuristics and anti-patterns
description: Grep patterns, known false-positives, and defect-density areas for this codebase
type: project
---

## Effective grep patterns

- `grep -rn " as " src/ --include="*.ts" | grep -v "// " | grep -v "import " | grep -v "export "` — finds type assertions
- `grep -rn "catch\s*{" src/ telemetry-backend/src/` — finds empty catch blocks
- `grep -rn "parseInt\|parseFloat" src/ | grep -v "Number\."` — finds forbidden globals
- `grep -rn "console\." src/ --include="*.ts"` — finds console usage; only permitted bootstrap files (config.ts, init.ts, logger.ts) use it

## Known safe patterns (not findings)

- `normalizers.ts`: all `as OnOffState`, `as NormalizedClimateMode`, etc. are preceded by `VALID_*.has()` set membership checks — intentional, not unsafe casts
- `mqtt.ts`: `return value as QoS` preceded by `VALID_QOS.has(value)` check — safe
- `electrolux.ts`: `tokenPayload as { exp: number; iat: number }` preceded by `typeof` checks for both fields — safe
- `normalizers.ts`: `rawState as unknown as Appliance['properties']['reported']` preceded by `'in'` checks for three required fields — safe
- Empty catches in logger.ts (timezone detection fallback), mqtt.ts (JSON.parse for debug log), electrolux.ts (URL parsing fallback), health.ts (read failure returns false), config.ts (write failure uses in-memory config) — all documented

## Defect-density areas

- `src/electrolux.ts` — most complex file; login flow has two payload structures tried in sequence; watch for new code that duplicates this pattern
- `src/config.ts` — config loading from YAML vs env; the `handleValidationError` / `process.exit` pattern must not be called in test mode (guarded by `process.env.VITEST`)

## Telemetry-backend observations

- Rate limiting runs before payload validation in POST /telemetry — correct per CLAUDE.md checklist
- `express.json({ limit: '10kb' })` — size limit present
- Multi-stage Dockerfile, dev deps stripped — correct
- `RATE_LIMIT_SALT` defaults to machine-id or hostname — not a hardcoded secret

## Watch patterns

### `noUncheckedIndexedAccess` + index-style loops
`tsconfig.json` has `noUncheckedIndexedAccess: true`. `arr[i]` types as `T | undefined` and TypeScript does NOT narrow this from a bounds-check loop condition. Prefer `for...of` + `.entries()` over `for (let i = 0; i < arr.length; i++)`. Exception: `(T|undefined) || 0` coerces to number and is accepted (see `version-checker.ts`'s `parts1[i] || 0`).

## `config.yml` is gitignored — do not infer absence from git tooling

`config.yml` in the project root contains the developer's real Electrolux credentials and is listed in `.gitignore`. It will NOT appear in `git status`, `git ls-files`, or other git-aware searches, but it is present on disk for E2E runs. When the audit checklist asks whether `config.yml` exists (E2E snapshots step), verify with a direct filesystem check (`ls config.yml` or `test -f config.yml`) — never infer absence from git output.
