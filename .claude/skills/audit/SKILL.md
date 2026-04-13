---
name: audit
description: Comprehensive codebase audit — lint, typecheck, tests, then manual review
disable-model-invocation: true
context: fork
agent: auditor
model: opus[1m]
effort: max
---

Invoke auditor agent. All workflow, checklist, and rules in `.claude/agents/auditor.md`.
