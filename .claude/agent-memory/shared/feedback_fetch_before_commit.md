---
name: fetch-and-sync-the-branch-before-committing
description: Always git fetch and check ahead/behind before creating commits — a stale local branch causes duplicated work and messy rebases
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8e79790b-579f-46f5-90c1-46337a5c35c3
  modified: 2026-07-29T12:30:37.456Z
---

Before creating any commit, **fetch first and confirm the branch is up to date**:

```sh
git fetch origin && git status -sb        # look for "behind N"
git log --oneline HEAD..origin/<branch>   # what landed upstream since
```

If behind, rebase onto the remote branch *before* doing the work — not after.

**Why:** on 2026-07-29 a whole session of work was committed on a `next` that was **30 commits behind** `origin/next`. Upstream had already fixed the same canonical-stringify undefined bug, already bumped TypeScript to v7, pnpm to 11.17.0, and the same patch/minor deps. Three of four commits were wholly or partly redundant, and the rebase then had to drop and rewrite commits. All of it was avoidable with one `git fetch` at the start.

**How to apply:** Fetch at the *start* of any task that will end in a commit — dependency updates and audits especially, since those read the whole tree and their conclusions are worthless if the tree is stale. Also re-run it before the commit step itself if the session has been long.

A failing `git fetch` is a blocker, not a footnote — treat "Could not read from remote repository / correct access rights" as unverified state, say so, and fix it before drawing conclusions from `origin/*` refs. That error usually means the 1Password SSH agent isn't running (the same cause as commit-signing failures); launching/unlocking 1Password fixes both. See [[feedback_memory_before_commit]].
