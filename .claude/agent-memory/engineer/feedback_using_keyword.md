---
name: feedback_using_keyword
description: Lessons learned implementing Explicit Resource Management (using/await using) in this codebase
metadata:
  type: feedback
---

`using _ = disposableTimeout(...)` cancels the timeout when the enclosing block exits — NOT after the function returns. For retry timeouts that must outlive their creation scope (e.g., `electrolux.ts` login retry), `using` is semantically wrong. Instead, store the Disposable as a field/variable and call `[Symbol.dispose]()` explicitly during cleanup.

**Why:** The `using` keyword ties resource lifetime to lexical block scope. Timers whose lifetime spans multiple scopes (stored in Sets, Maps, or nullable fields) need manual disposal — wrapping in a Disposable is still an improvement over raw `NodeJS.Timeout` because it unifies the dispose interface.

**How to apply:**
- Use `using _ = disposableTimeout/disposableInterval(...)` only when the timer must be cancelled if an exception occurs in the same block, or if the block scope matches the timer's desired lifetime.
- For long-lived timers (module-level, class fields): store as `Disposable | null` and call `disposable?.[Symbol.dispose]()` in cleanup code.
- `[Symbol.asyncDispose]` on classes (`ElectroluxClient`, `Mqtt`, `Orchestrator`) enables `await using` at call sites without changing internal timer management.

Redundant `activeIntervals` Set in `Orchestrator` was eliminated — `applianceStateIntervals` Map already tracked every polling interval. Always check for duplicate tracking structures before adding `using`.

`tsconfig.json` now includes `lib: ["ES2022", "esnext.disposable"]` — provides `Disposable`, `AsyncDisposable`, `DisposableStack`, `AsyncDisposableStack` from TypeScript's built-in lib (separate from `@types/node` which also provides them via Node 22+).
