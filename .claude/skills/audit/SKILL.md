---
name: audit
description: Full codebase audit — lint, typecheck, tests, manual review
disable-model-invocation: true
context: fork
agent: auditor
model: opus[1m]
effort: xhigh
---

Run auditor agent. Workflow/checklist/rules: `.claude/agents/auditor.md`.
