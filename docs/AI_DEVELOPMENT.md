# AI-Assisted Development

<!-- This file documents the AI-assisted development setup. AI agents only need to load it when the task explicitly involves the .claude/ tooling, agents, or skills; CLAUDE.md is the primary entrypoint for everything else. -->

This project is set up for AI-assisted development with [Claude Code](https://docs.anthropic.com/en/docs/claude-code). The configuration lives in `.claude/`.

## How it works

Claude Code reads `.claude/CLAUDE.md` at the start of every conversation. This file contains the project's coding rules and verification steps. Task-specific checklists live in `.claude/skills/` and load on demand when a skill is invoked.

### Structure

```
.claude/
  CLAUDE.md                      # Rules, verification
  skills/
    audit/SKILL.md               # /audit trigger stub → agents/auditor.md
    audit-fix/SKILL.md           # /audit-fix full pipeline: audit → fix → verify → commit
    maintain/SKILL.md            # /maintain trigger stub → agents/maintainer.md
  agents/
    engineer.md                  # TDD implementation work + file checklists (src/, tests/, docker/, telemetry-backend/)
    auditor.md                   # /audit work
    maintainer.md                # /maintain work
  agent-memory/
    shared/                      # Shared memories for all agents (feedback, user, project)
      MEMORY.md                  # Index of all shared memories (auto-loaded each session)
      feedback_*.md              # Workflow preferences and coding rules learned from sessions
      user_*.md / project_*.md   # User profile and project context
    auditor/                     # Persistent cross-session memory for the auditor agent
    maintainer/                  # Persistent cross-session memory for the maintainer agent
```

### Contributor setup: shared agent memory

Agent memories in `.claude/agent-memory/` are committed to the repo so all contributors benefit from the accumulated project knowledge (coding preferences, known pitfalls, workflow rules).

To activate this, add one line to your `.claude/settings.local.json` (create it if it doesn't exist):

```json
{
  "autoMemoryDirectory": "/absolute/path/to/electrolux-to-mqtt/.claude/agent-memory/shared"
}
```

Replace the path with the absolute path to your local clone. Without this, Claude Code writes memories to a global per-project cache that isn't shared.

### Skills (slash commands)

Skills are predefined workflows invoked as slash commands in Claude Code:

| Command | What it does |
|---------|-------------|
| `/audit` | Full codebase audit: lint, typecheck, tests, then manual review against the checklist. Reports findings only; fixes delegated to `engineer`. |
| `/audit-fix` | Full pipeline: audit → save report to `audit-report.md` → user approves findings → engineer fixes → verify → user approves commit batches → commit. |
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
