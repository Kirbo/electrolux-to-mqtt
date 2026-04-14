---
name: audit-fix
description: Full audit-fix-commit pipeline — audit → save report → fix approved findings → verify → commit batches
---

You are the orchestrator for a full audit-fix-commit pipeline. Execute the steps below in order. Do not skip steps. Do not commit without explicit user approval at the gate.

## Step 1: Audit (sub-agent, phases 1-3 only)

Spawn the `auditor` agent via the Agent tool with this exact instruction:

> Run phases 1-3 of your audit workflow (Automated Checks, Manual Review, Report). Do NOT proceed to Phase 4 or beyond — stop after producing the report. Save the full structured report to `audit-report.md` in the project root, then return a brief summary of findings (count by severity: BLOCKER / MAJOR / MINOR / NIT).

Wait for the agent to return before continuing.

## Step 2: Auto-triage

Read `audit-report.md`. Mark ALL findings (BLOCKER, MAJOR, MINOR, NIT) for engineer delegation. No user interaction. If zero findings → jump to Step 5.

## Step 3: Fix (engineer sub-agent)

Spawn the `engineer` agent via the Agent tool. Pass ALL approved findings in one bundle:
- Finding title, severity
- File path + line number (from `audit-report.md`)
- Specific fix description
- Relevant verification commands from CLAUDE.md § Verification

Wait for the engineer to return. Read changed files to confirm fixes were applied.

## Step 4: Verify

Run the full verification pipeline per CLAUDE.md § Verification:

1. `pnpm check`
2. `pnpm typecheck` (if `src/`, `tests/`, or config files changed)
3. `pnpm test` (same condition)
4. `pnpm sonar` (same condition)
5. `cd telemetry-backend && pnpm typecheck && pnpm test` (if `telemetry-backend/` changed)

If any step fails: **STOP**. Report the failure. Do not proceed to commit. User must resolve and re-invoke.

## Step 5: Commit plan (user approval gate)

Run `git diff --stat HEAD` and `git diff HEAD` to understand what changed. If nothing changed → report "no changes to commit" and stop.

Otherwise, group changes into logical conventional commit batches:

- One commit per coherent change (fix, refactor, chore, docs, etc.)
- Use scopes where appropriate (`fix(config):`, `refactor(appliance):`, etc.)
- Never bundle unrelated changes

Present the proposed commit batches to the user with:
- Proposed commit message for each batch
- Files included in each batch

**Wait for explicit user approval** before committing. User may adjust grouping, edit messages, or drop batches.

## Step 6: Commit approved batches

For each approved batch, in order:
1. Stage the specific files for that batch
2. Commit with the approved message

Never `git push`. Leave that to the user.

After all commits: confirm completion with a one-line summary (N commits, N findings fixed).
