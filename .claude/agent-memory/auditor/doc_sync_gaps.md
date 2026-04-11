---
name: Doc sync gaps
description: Recurring gaps between documentation and code found during audits
type: project
---

## Watch list for future audits

- Whenever `.claude/agents/`, `.claude/rules/`, or `.claude/skills/` change, check `AI_DEVELOPMENT.md` and `CONTRIBUTING.md` for sync
- Check README env var table against `envSchema` field list after any config changes
- Check `config.example.yml` against `configSchema` fields after any config changes
- Whenever the instructions file location changes, re-check `AI_DEVELOPMENT.md` and `CONTRIBUTING.md` for stale path references
