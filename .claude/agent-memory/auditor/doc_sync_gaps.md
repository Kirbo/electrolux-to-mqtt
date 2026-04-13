---
name: Doc sync gaps
description: Recurring gaps between documentation and code found during audits
type: project
---

## Watch list for future audits

- `.claude/agents/`, `.claude/skills/` change → check `AI_DEVELOPMENT.md` + `CONTRIBUTING.md` sync
- README env var table vs `envSchema` field list → check after config changes
- `config.example.yml` vs `configSchema` fields → check after config changes
- Instructions file location changes (`.claude/agents/`, `.claude/skills/`) → re-check `AI_DEVELOPMENT.md` + `CONTRIBUTING.md` for stale paths
