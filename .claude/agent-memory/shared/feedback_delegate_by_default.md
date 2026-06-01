---
name: delegate-by-default
description: "Default to proposing engineer/subagent delegation for code work; direct handling is an explicit, one-time exception"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 86db47f4-741d-4dc8-9e13-ccbcb6ee319b
---

For changes under `src/`, `tests/`, `docker/`, `telemetry-backend/` (and `/audit`, `/maintain`), the default is to **propose delegating to the appropriate subagent** (engineer / auditor / maintainer) per CLAUDE.md § Subagents. Do not silently self-implement.

Handle the work directly **only** when the user explicitly says so for that task (e.g. "fix it yourself, no need to delegate"). Such an instruction is **one-time / per-task** — it does NOT establish a standing preference. Revert to proposing delegation on the next task.

**Why:** The user wants the engineer's TDD workflow + per-change-type checklists by default; direct handling bypasses them and is a deliberate per-task exception, not the norm.

**How to apply:** When a task touches those paths, default to proposing engineer delegation. Treat any "handle it directly" / "don't delegate" as scoped to the current task only — never carry it forward. (Correcting a 2026-06-01 session where I wrongly inferred a standing "implement directly" preference from a one-time instruction.)

See [[feedback-single-source-of-truth]] — this adds the override nuance, it does not restate CLAUDE.md's rule.
