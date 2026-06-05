---
name: memory-before-commit
description: Write/finalize agent-memory files BEFORE the commit step so they ride in the same commit and push
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c636201f-b2f5-421f-9911-10d1ff00487d
---

When a commit is coming (user trigger or a proposed commit), first capture any pending durable learnings as memory files, THEN stage + commit. Don't defer memory writes until after the commit.

**Why:** `.claude/agent-memory/` files are tracked and committed in this repo (e.g. commit `065abc3 chore(memory): record auto-update decision`). The user pushes manually. A memory written *after* the commit is left as separate uncommitted noise and misses that push — the user has to prompt a second round. Writing it first means one `git add -A` sweeps it in and it gets pushed at the same go.

**How to apply:** the moment the user asks to commit, FIRST verify/decide (ask if genuinely unsure) whether anything from the work is worth persisting to agent/shared memory. If yes, write the memory file(s) first, then stage everything together so they land in the same commit. Also write a memory the instant a durable, non-obvious learning emerges mid-work — don't wait for commit time. If a memory need only surfaces AFTER you've committed, amend it into that commit while it is still unpushed (verify with `git log origin/<branch>..HEAD`); never force-push to amend an already-pushed commit — make a fresh `chore(memory)` commit instead. Related: stage Biome's reformat in the same commit too ([[feedback_biome_before_commit]]).
