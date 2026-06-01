---
name: project-review-deferred
description: Improvements identified in the 2026-06-01 full-repo review that were consciously deferred (not bugs)
metadata: 
  node_type: memory
  type: project
  originSessionId: 86db47f4-741d-4dc8-9e13-ccbcb6ee319b
---

A full-repo review on 2026-06-01 produced findings F1–F6, all fixed (see git history: the `refactor:` commits on `next` ending at `249b63d`). These items were identified in the same review but **consciously deferred** — none are bugs; they're optional hardening or product-scope notes. Pick up if relevant; don't re-discover from scratch.

- **`telemetry-backend/src/index.ts:8`** — `const port = process.env.PORT || 3001` uses bare `Number`-style coercion with no NaN guard, unlike the six rate-limit reads which now go through `envNumber()` (commit `b33565d`). Low priority: `app.listen()` fails fast on a bad value. Fold into `envNumber` for consistency if touching that file.
- **`exactOptionalPropertyTypes`** in both `tsconfig.json`s — one extra strictness notch beyond the current `strict` + `noUncheckedIndexedAccess`. Deferred because it may cause real friction; evaluate cost before enabling.
- **`src/mqtt.ts:18`** — the module connects to the broker as an import-time side effect (module singleton). It's testable via the `IMqtt` seam, but a factory function would remove import-time I/O. Architectural, deeply baked in — note only.
- **`src/appliances/factory.ts`** — `createAppliance()` funnels *every* appliance to `Comfort600Appliance` (explicit match + `PORTABLE_AIR_CONDITIONER`/`AZUL` match + catch-all fallback, logged on fallback). Deliberate single-model scope, not a bug — but it's the seam where multi-appliance support would land, and the "treat unknown as climate" fallback is worth revisiting when a second model is added.

Related: known-not-a-bug gotchas from this review live in the auditor's `audit_heuristics.md`. See also [[feedback-single-source-of-truth]].
