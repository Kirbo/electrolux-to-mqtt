---
name: audit-fix
description: Full audit-fix-commit pipeline — audit → save report → fix approved findings → verify → commit batches
disable-model-invocation: true
---

# Audit-fix — full audit → fix → commit pipeline

You run the entire pipeline yourself, in-loop, at the current session model. No subagent spawning. Execute the steps in order. No skipping. No commit without explicit user approval.

## Step 1: Audit (report only)

Run Phases 1–3 of the `/audit` skill (Automated checks, Manual review, Report). Do NOT proceed to its triage/fix phase here. Save the full structured report to `audit-report.md` in the project root, then note the finding counts by severity (BLOCKER / MAJOR / MINOR / NIT).

## Step 2: Auto-triage

Read `audit-report.md`. Mark ALL findings (BLOCKER, MAJOR, MINOR, NIT) for fixing. No user interaction at this step. Zero findings → jump to Step 5.

## Step 3: Fix

Fix every triaged finding yourself, in-loop, following the `/engineer` skill's TDD workflow + file checklists. Work from `audit-report.md`: for each finding use its file path + line number and the specific fix described. After editing, re-read the changed files to confirm the fixes are actually applied (not just moved).

## Step 4: Verify

Run the full verification pipeline per CLAUDE.md § Verification:

1. `pnpm check`
2. `pnpm typecheck` (if `src/`, `tests/`, or config files changed)
3. `pnpm test` (same condition)
4. `pnpm sonar` (same condition)
5. `cd telemetry-backend && pnpm typecheck && pnpm test` (if `telemetry-backend/` changed)

Any step fails: **STOP**. Report the failure. No commit. The user resolves and re-invokes.

## Step 5: Commit plan (user approval gate)

Run `git diff --stat HEAD` and `git diff HEAD`. Nothing changed → report "no changes to commit" and stop.

Group the changes into logical Conventional Commit batches:

- One commit per coherent change (fix, refactor, chore, docs, etc.)
- Scopes where appropriate (`fix(config):`, `refactor(appliance):`, etc.)
- Never bundle unrelated changes.

Present the proposed batches with a commit message and file list per batch.

**Wait for explicit user approval** before committing. The user may adjust grouping, edit messages, or drop batches.

## Step 6: Commit approved batches

Per approved batch, in order:
1. Stage the specific files.
2. Commit with the approved message.

Never `git push` — leave it to the user.

After all commits: a one-line summary (N commits, N findings fixed).
