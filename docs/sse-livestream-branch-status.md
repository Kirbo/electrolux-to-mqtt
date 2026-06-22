# SSE Livestream Branch — Status & Handoff

**Branch:** `refactor/server-streamed-events`
**Last updated:** 2026-06-22
**Status:** Works end-to-end against the real Electrolux API, but its core premise is in question (see [Open question](#open-question--where-to-continue)). Parked in favour of the polling-based `next` branch pending a decision on whether SSE is worth keeping.

## What this branch was for

Originally: **replace periodic state polling with a long-lived SSE livestream** (commit `feat!: stream appliance state via SSE livestream instead of polling`). During live testing against the real API it became clear SSE alone was insufficient, so it evolved into a **hybrid**:

- **Polling is the baseline source of truth** (`refreshInterval`, default 60s) — works for every appliance, independent of SSE health.
- **SSE is best-effort, low-latency enrichment on top** — applies deltas between polls when the stream actually delivers them.

This mirrors the proven model in the official `electrolux-group-developer-sdk` and the `ha-electrolux` integration (polling baseline + SSE; ha-electrolux even adds compensating polls "because the API fails to send final SSE notifications").

## Architecture (current branch state)

- `src/livestream.ts` — `LivestreamClient`: GET livestream config → open SSE stream (`GET cfg.url` + `Authorization`/`x-api-key` headers) → parse `data:` lines → dispatch to hooks. Abortable exponential-backoff reconnect + idle watchdog. **Matches the official SDK flow exactly** (GET config → GET url → consume; filter by `applianceId` client-side; **no subscribe/registration step exists or is needed** — `cfg.appliances[].properties` is descriptive metadata).
- `src/livestream-events.ts` — `StreamEvent` (`{applianceId, property, value}`) guard/parse + `applyStreamEvent` (patches the cached raw `Appliance`).
- `src/orchestrator.ts` — per-appliance poll loop (source of truth); `handleStreamEvent` (SSE deltas between polls); on-(re)connect reseed; post-command re-poll; settle-window protection.
- `src/electrolux.ts` — fetch+diff+publish, optimistic command feedback, `commandStateDelaySeconds` re-poll, settle-window guard, `pendingCommandFields` overlay.
- **Config:** `refreshInterval` (default 60s) replaced `safetyRefreshInterval`; `commandStateDelaySeconds` (default 30s) restored; `livestreamIdleTimeoutSeconds` / `livestreamReconnectMaxSeconds` added. See `docs/MIGRATION.md`.

## Key findings (live testing against the real Electrolux API)

1. **For the Comfort 600 AC, SSE only ever streams `ambientTemperatureC`** (the room-temperature sensor). It **never** streams control properties (`targetTemperatureC`, `mode`, `applianceState`, `fanSpeedSetting`) — those are 100% poll-driven.
2. **Electrolux SSE is unreliable.** Observed multi-minute stretches delivering only `event:ping` keepalives and zero data events, even during active changes. (One blackout was a transient backend outage; another run delivered nothing for 5 min.)
3. **Net value of SSE on this hardware is marginal** — it only speeds up a sensor reading that does not need sub-30s freshness, while adding a whole reconnect/watchdog/parsing subsystem, several state-clobber bug classes, and extra MQTT churn (full-state republish on every ambient wobble). **Pure polling arguably works better for this appliance.**
4. SSE *may* be worthwhile for other appliance types that stream richer events (washers/ovens emitting cycle progress) — unverified; confirm what those actually emit before investing further.

## Issues encountered & fixed

All four share one root cause: after an optimistic command publish the cache holds *normalized* state, and the Electrolux `GET /state` lags ~15–17s behind a 200-OK command — so any reseed/poll in that window can republish stale pre-command values.

1. **Reseed misclassified optimistic cache as "first fetch"** → force-republished the stale GET. Fixed: accept normalized cache as a valid diff baseline (`isNormalizedState`).
2. **No settle window** → polls during the lag reverted commands. Fixed: settle-window guard (`commandStateDelaySeconds`) skips regressive publishes; authoritative re-poll after the window reconciles to API truth.
3. **SSE-delta-onto-stale-cache + self-heal reseed regressed commanded fields** → visible flapping (e.g. `23→22→23`). Fixed: `pendingCommandFields` overlay pins commanded fields across all publish paths during the window; self-heal reseed passes `settleWindowMs`.
4. **On-connect (SSE connect/reconnect) reseed clobbered in-flight commands** (e.g. `24→23`). Fixed: on-connect reseed passes `settleWindowMs`.

## Observability

The SSE receive path is fully debug-logged: connect URL (auth token stripped), every raw `data:` payload, parse failures (with raw payload), dispatched events, `event:` heartbeats, and the untracked-applianceId / no-diff drops. Inspect with `LOG_LEVEL=debug pnpm dev`.

Note: the `tests/e2e/livestream.e2e.test.ts` capture asserts only `capturedEvents.length >= 0` — it passes on zero events, so it does **not** validate SSE delivery. Don't read a green e2e run as proof SSE works.

## Open question / where to continue

**Is SSE worth keeping at all?** As of this writing the maintainer leans toward the simpler **pure-polling** design (the `next` branch, which does **not** contain the SSE cutover), since polling does all the real work for the AC and SSE added marginal benefit plus complexity here.

If revisiting SSE:

- **Confirm SSE's value on richer appliance types first** (what do washers/ovens actually emit?). If it's only ambient-style sensors everywhere, SSE isn't worth the complexity.
- **Consider a "SSE never reseeds/clobbers" design:** SSE deltas only patch a live raw-`Appliance` cache; if the cache isn't a raw `Appliance`, skip the delta and let the next poll fix it. Drop the self-heal reseed entirely — this removes the whole class of clobber bugs and the `pendingCommandFields` overlay machinery.
- **Reduce MQTT churn:** every ambient-temp wobble currently republishes the full state object.
- **Do not lengthen the poll interval to "let SSE carry the load"** unless SSE is verified to reliably carry *control* events — it does not on the AC.

## Verification status

- `pnpm typecheck` / `pnpm test` (893 passing) / `pnpm check`: green.
- `pnpm sonar`: blocked locally on non-main branches (free tier); complexity verified by inspection.
- Branch diverges from `origin` (was rebased onto `next`); not pushed.

## Relationship to `next`

`HEAD` = `next` + the SSE cutover commit + this session's hybrid/fixes/instrumentation. **`next` is the polling-based branch without SSE.** Detailed engineer notes also exist under `.claude/agent-memory/engineer/project_livestream_sse_transport.md` and `project_phase4_cutover.md` (these predate the hybrid pivot and describe the original SSE-only cutover).
