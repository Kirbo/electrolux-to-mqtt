---
name: phase4-sse-cutover
description: Phase 4 SSE migration complete — polling removed, stream wired, config renamed, test patterns for async reconnect hooks
metadata:
  type: project
---

Phase 4 (SSE cutover) is complete on branch `refactor/streaming`. All verification passes (840 tests, coverage thresholds met).

**What changed:**
- `src/config.ts`: `refreshInterval` → `safetyRefreshInterval` (600–86400, default 21600); removed `commandStateDelaySeconds`; added `livestreamIdleTimeoutSeconds`/`livestreamReconnectMaxSeconds`
- `src/electrolux.ts`: removed `getApplianceState`, `lastCommandTime`, `refreshInterval`; `reseedApplianceState` is now the only state-fetch method; `isAppliance` exported
- `src/orchestrator.ts`: all polling removed; `initializeLivestream()` wires SSE; `handleStreamEvent()` applies deltas or self-heals; health via `lastStreamSignal`/`isApiConnected()`
- `src/index.ts`: constructs `LivestreamClient`; `safetyRefreshIntervalDisposable` for periodic reseeds; no stagger on `initializeAppliance`

**Pending (Phase 5 — doc ripple, explicitly out of scope):** `config.example.yml`, compose examples, README 4 locations, `docs/MIGRATION.md`

**Why:** `safetyRefreshInterval` excluded from cross-field token check because at min (10 min) it falls within discovery max (60 min); documented inline.

**How to apply:** Don't mistake `reseedApplianceState` for the old `getApplianceState` — they're the same HTTP call but reseed never skips due to command delay.

**Test patterns:**
- Reconnect hook with 100ms stagger timer: start reconnect promise first, then `await vi.runAllTimersAsync()`, then `await reconnectPromise`
- Drain initial `setTimeout(0)` seed before wiring livestream to isolate reseed counts: `await vi.runAllTimersAsync()` after `initializeAppliance` before `initializeLivestream`
- `StreamEvent` shape: `{ applianceId: string; property: string; value: unknown }` — no `type` or `properties` fields
- `index.test.ts` mock orchestrator needs `initializeLivestream`, `getApplianceInstances`; `LivestreamClient` needs its own `vi.mock('@/livestream.js')`
