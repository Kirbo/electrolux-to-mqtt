---
name: audit
description: Run a comprehensive codebase audit — lint, typecheck, tests, then manual review of all source and test files
disable-model-invocation: true
---

Run a comprehensive review of the electrolux-to-mqtt codebase.

## Ground rules

- Every finding must be confirmed by reading the actual file content — do not report a type, field, or function as missing based on assumptions or line-number estimates alone.
- Check findings against the rules in `CLAUDE.md` before flagging — known conventions documented there are intentional, not bugs.
- When checking for dead exports, search `tests/` as well — test imports count as external usage (a function exported solely for testing is not dead).

## Steps

1. Run automated checks (in parallel where possible):
   - `pnpm check` — Biome lint + format
   - `pnpm typecheck` — TypeScript strict mode
   - `pnpm test` — all unit tests with coverage

2. Read the checklist at `.claude/rules/audit.md` and work through every item **starting from section 2** (section 1 automated checks are already done above).

3. Fix all findings. After fixes, re-run verification (see CLAUDE.md § Verification).

4. If any finding reveals a missing rule or checklist item, propose adding it to `CLAUDE.md`, `.claude/rules/audit.md` or `.claude/rules/implement.md`.
