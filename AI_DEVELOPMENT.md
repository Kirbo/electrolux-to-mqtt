# AI-Assisted Development

<!-- AI note: Do not read this file unless you are explicitly editing it or the user asks about AI tooling. -->

This project is set up for AI-assisted development with [Claude Code](https://docs.anthropic.com/en/docs/claude-code). The configuration lives in `.claude/`.

## How it works

Claude Code reads `.claude/CLAUDE.md` at the start of every conversation. This file contains the project's coding rules and verification steps. Task-specific checklists live in `.claude/skills/` and load on demand when a skill is invoked.

### Structure

```
.claude/
  CLAUDE.md                      # Rules, verification
  skills/
    audit/SKILL.md               # /audit — code review checklist
    maintain/SKILL.md            # /maintain — dependency update checklist
  agents/
    engineer.md                  # TDD implementation work + file checklists (src/, tests/, docker/, telemetry-backend/)
    auditor.md                   # /audit work
    maintainer.md                # /maintain work
```

### Skills (slash commands)

Skills are predefined workflows invoked as slash commands in Claude Code:

| Command | What it does |
|---------|-------------|
| `/audit` | Full codebase audit: lint, typecheck, tests, then manual review against the checklist. Reports findings only; fixes delegated to `engineer`. |
| `/maintain` | Update all dependencies and pnpm, fix any breakage from updates. |

### Ad-hoc prompting

You don't need to use skills for everything. Any prompt works — Claude Code reads `.claude/CLAUDE.md` rules automatically. Skills just ensure a complete, repeatable workflow for common tasks.

Examples of ad-hoc prompts:
- "Add support for the PureA9 air purifier"
- "The MQTT reconnection is dropping messages, investigate"
- "Refactor the normalizers to reduce duplication"

### Rules

Rules in `.claude/CLAUDE.md` are enforced automatically — Claude Code follows them without being asked. Key rules include:
- No `any` types, no unsafe casts, strict TypeScript
- TDD: write tests before implementation
- Keep docs in sync with code
- Use pnpm, Biome, Conventional Commits

### Self-maintenance

Claude Code will proactively suggest updates to `.claude/` when it encounters gaps or ambiguities. It asks before writing.
