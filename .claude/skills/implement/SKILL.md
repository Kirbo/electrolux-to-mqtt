---
name: implement
description: Implement any code change (feature, refactor, bugfix) — reads the relevant checklists and follows them
disable-model-invocation: true
argument-hint: <description of the change>
---

Implement the following: $ARGUMENTS

## Steps

1. Read `.claude/rules/implement.md` to load the full file checklists.

2. Follow the applicable checklists from `implement.md` based on what this change touches.

3. Verify (see CLAUDE.md § Verification):
   - [ ] `pnpm check`
   - [ ] `pnpm typecheck` (if src/ or tests/ changed)
   - [ ] `pnpm test` (if src/ or tests/ changed)
