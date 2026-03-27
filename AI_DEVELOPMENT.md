# AI-Assisted Development

<!-- AI note: Do not read this file unless you are explicitly editing it or the user asks about AI tooling. -->

This project is set up for AI-assisted development with [Claude Code](https://docs.anthropic.com/en/docs/claude-code). The configuration lives in `CLAUDE.md` and `.claude/`.

## How it works

Claude Code reads `CLAUDE.md` at the start of every conversation. This file contains the project's coding rules, verification steps, and pointers to more detailed checklists in `.claude/rules/`.

### Structure

```
CLAUDE.md                        # Rules, verification, context files
.claude/
  rules/
    implement.md                 # File checklists per change type
    audit.md                     # Code review checklist
    maintain.md                  # Dependency update checklist
  skills/
    implement/SKILL.md           # /implement skill definition
    audit/SKILL.md               # /audit skill definition
    maintain/SKILL.md            # /maintain skill definition
```

### Skills (slash commands)

Skills are predefined workflows invoked as slash commands in Claude Code:

| Command | What it does |
|---------|-------------|
| `/implement <description>` | Implement a feature, refactor, or bugfix. Reads the relevant checklists and follows them. |
| `/audit` | Full codebase audit: lint, typecheck, tests, then manual review against the checklist. Fixes all findings. |
| `/maintain` | Update all dependencies and pnpm, fix any breakage from updates. |

### Ad-hoc prompting

You don't need to use skills for everything. Any prompt works — Claude Code reads `CLAUDE.md` rules automatically. Skills just ensure a complete, repeatable workflow for common tasks.

Examples of ad-hoc prompts:
- "Add support for the PureA9 air purifier"
- "The MQTT reconnection is dropping messages, investigate"
- "Refactor the normalizers to reduce duplication"

### Rules

Rules in `CLAUDE.md` are enforced automatically — Claude Code follows them without being asked. Key rules include:
- No `any` types, no unsafe casts, strict TypeScript
- TDD: write tests before implementation
- Keep docs in sync with code
- Use pnpm, Biome, Conventional Commits

### Self-maintenance

Claude Code will proactively suggest updates to `CLAUDE.md` and `.claude/` when it encounters gaps or ambiguities. It asks before writing.
