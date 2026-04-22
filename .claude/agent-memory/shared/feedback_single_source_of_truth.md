---
name: Single source of truth — avoid duplication across instruction files
description: Don't repeat the same information in multiple files (CLAUDE.md, rules, skills). Use cross-references instead.
type: feedback
---

Don't duplicate information across CLAUDE.md, rules files, and skill files. Define it once, cross-reference elsewhere.

**Why:** The user actively reviews instruction files and flags any repeated content (e.g., verification commands listed in 5 places, Skills section in CLAUDE.md repeating what Claude Code auto-discovers from `.claude/skills/`). Duplication creates maintenance burden and drift risk.

**How to apply:**
- If something is auto-discovered by Claude Code (e.g., available skills), don't list it in CLAUDE.md
- Verification steps are defined in CLAUDE.md § Verification — skills should reference that section, not inline the commands
- Checklists should live in one rules file — other files should cross-reference (e.g., "see audit.md section 11")
- When creating new instruction content, check existing files first to avoid near-duplicates
