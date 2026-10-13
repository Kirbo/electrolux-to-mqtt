---
name: dep-pnpm-agent-skills-approval
description: pnpm 12.11+ gates dependency-bundled agent skills behind approval (like build scripts); @clickhouse/client 1.24 ships three
metadata:
  node_type: memory
  type: project
  originSessionId: 1c33f365-cfb6-4793-bd69-7c0ec3ffe209
  modified: 2026-10-13T09:52:21.340Z
---

pnpm 12.11 extended its permission model (`pnpm permissions list|approve`, alias `pnpm approve`) from build scripts to **agent skills**: packages declaring `"agents": { "skills": [...] }` in their package.json get held as "awaiting approval" until granted or denied. Decisions are written to `pnpm-workspace.yaml` (same file as `allowBuilds`; see [[pnpm_v11_build_approval]]).

First hit 2026-10-13: `@clickhouse/client` 1.24.x (telemetry-backend) bundles `clickhouse-js-node-coding`, `-troubleshooting`, `-rowbinary` SKILL.md files under `node_modules/@clickhouse/client/skills/`.

A pending approval does **not** fail `pnpm install`, frozen Docker installs (`pnpm docker:test all` passed), or osv-scan. It's informational until decided.

**Why:** third-party skills are dependency-supplied agent instructions, which makes them a supply-chain vector into agent context. This repo deliberately curates its own `.claude/skills/` (see CLAUDE.md § Subagents).

**How to apply:** treat a new "Agent skills awaiting approval" line in install output as a decision for the user, not something to auto-approve. Deny with `pnpm approve '!<pkg>'` (run in the package dir that owns the lockfile), and check `git diff` on that dir's `pnpm-workspace.yaml`.
