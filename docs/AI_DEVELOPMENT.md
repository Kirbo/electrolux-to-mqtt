# AI-Assisted Development

<!-- This file documents the AI-assisted development setup. AI agents only need to load it when the task explicitly involves the .claude/ tooling or skills; CLAUDE.md is the primary entrypoint for everything else. -->

This project is set up for AI-assisted development with [Claude Code](https://docs.anthropic.com/en/docs/claude-code). The configuration lives in `.claude/`.

## How it works

Claude Code reads `.claude/CLAUDE.md` at the start of every conversation. This file contains the project's coding rules and verification steps. Task-specific checklists live in `.claude/skills/` and load on demand when a skill is invoked.

**Single-agent model.** The main agent does all the work itself, in-loop, at whatever model you pick with `/model` — there are no fixed-model worker subagents. The detailed workflows live in skills (`/engineer`, `/audit`, `/maintain`, `/audit-fix`) that the agent follows in its own loop. Generic sub-agents are spun up only for genuine parallel fan-out (e.g. independent searches across many files); they inherit your session model.

### Structure

```
.claude/
  CLAUDE.md                      # Rules, verification (lean — heavy checklists live in skills)
  skills/
    engineer/SKILL.md            # /engineer — TDD workflow + per-change-type file checklists (src/, tests/, docker/, telemetry-backend/)
    audit/SKILL.md               # /audit — full phased audit: automated checks + manual review + report
    audit-fix/SKILL.md           # /audit-fix — full pipeline: audit → fix → verify → commit
    maintain/SKILL.md            # /maintain — dependency updates, vuln fixes, breakage resolution
  agent-memory/
    shared/                      # Single shared memory namespace (the one agent)
      MEMORY.md                  # Index of all memories (auto-loaded each session)
      feedback_*.md              # Workflow preferences and coding rules learned from sessions
      project_*.md / reference_*.md  # Project context and external-system pointers
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
| `/engineer` | TDD workflow + per-change-type file checklists. The agent follows it in-loop when implementing, refactoring, or fixing bugs in `src/`, `tests/`, `docker/`, or `telemetry-backend/`. |
| `/audit` | Full codebase audit: lint, typecheck, tests, then manual review against the checklist. The agent runs it in-loop and reports findings; it only fixes on explicit approval. |
| `/audit-fix` | Full pipeline, all in-loop: audit → save report to `audit-report.md` → triage → fix → verify → user approves commit batches → commit. |
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
