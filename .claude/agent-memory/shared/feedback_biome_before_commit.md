---
name: Run Biome before committing and include its changes
description: Always run pnpm check (Biome) before git commit, stage any formatting changes it produces, and include them in the commit
type: feedback
---

Run `pnpm check` before every commit. Biome runs as a pre-commit hook and may reformat files. Stage those changes and include them in the same commit — do not leave them behind as unstaged diffs.

**Why:** The hook is intentional so code is always linted and formatted. Leaving Biome's output uncommitted defeats the purpose and creates a dirty working tree after every commit.

**How to apply:** After staging files for a commit, run `pnpm check`, then `git add` any files Biome touched, then commit. If Biome reports errors (not just formatting), fix them before committing.
