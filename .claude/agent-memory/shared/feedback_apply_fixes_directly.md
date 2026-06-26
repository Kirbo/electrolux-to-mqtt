---
name: feedback-apply-fixes-directly
description: "When asked to fix something, apply the fix to the working tree — don't propose code and hand it back"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9996295c-e346-4a66-9a67-8bd425401fab
---

When the user reports a problem or asks to fix something concrete, **apply the fix to the working tree directly** and demonstrate it working. Do not paste a code block and ask "apply this?" — that hands the work back to the user.

**Why:** User explicitly wanted "fixed solution, to be applied, not to be handed over to me." Proposing-and-asking on a clear one-line fix wasted multiple turns and read as not doing the job. (Concrete case: `vitest.config.ts` `env.LOG_LEVEL:'silent'` overrode CLI `LOG_LEVEL=debug`; I proposed the `?? 'silent'` fix instead of applying it, so the user's test still showed no logs.)

**How to apply:** Diagnose → edit → prove it works → report. Applying to the working tree is not the same as committing — commits still need their own trigger (see [[feedback_memory_before_commit]]). "Ask first" is for ambiguous or large work, not for a clear fix the user just requested.
