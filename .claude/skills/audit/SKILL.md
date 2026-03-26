---
name: audit
description: Run a comprehensive codebase audit — deps, lint, typecheck, tests, then manual review of all source and test files
disable-model-invocation: true
---

Run a comprehensive review of the electrolux-to-mqtt codebase.

## Steps

1. Run all automated checks (in parallel where possible):
   - `pnpm deps:check` — outdated dependencies and vulnerabilities
   - `pnpm check` — Biome lint + format
   - `pnpm typecheck` — TypeScript strict mode
   - `pnpm test` — all unit tests with coverage

2. If `pnpm deps:check` found outdated deps or vulnerabilities, update them now (`pnpm deps:update`), then re-run `pnpm check`, `pnpm typecheck`, and `pnpm test`.

3. Read the review checklist at `.claude/rules/review.md` and work through every item **starting from section 2** (section 1 automated checks are already done above).

4. Fix all findings. After fixes, re-run `pnpm check`, `pnpm typecheck`, and `pnpm test` once to confirm.

5. If any finding reveals a missing rule or checklist item, propose adding it to `CLAUDE.md`, `.claude/rules/review.md` or `.claude/rules/implementation.md`.
