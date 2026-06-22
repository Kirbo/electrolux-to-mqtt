---
name: project_sse_hybrid_status
description: "SSE livestream branch pivoted to hybrid polling+SSE; SSE marginal value, maybe drop — see handoff doc"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9232fcdd-477d-4978-8a25-931967a1acb7
---

`refactor/server-streamed-events` pivoted from SSE-only (replace polling) to **hybrid**: polling (`refreshInterval`, default 60s) is the source of truth, SSE is best-effort enrichment on top. Driven by live testing: Electrolux SSE for the Comfort 600 AC **only streams `ambientTemperatureC`** (never control props — those are poll-only), and is unreliable (multi-minute ping-only stretches). No SSE subscribe step exists/needed (verified vs official electrolux-group-developer-sdk: GET config → GET url → consume → filter by applianceId client-side).

Fixed four optimistic-command clobber bugs (root cause: GET /state lags ~15–17s behind a 200 command, so reseeds/polls in that window republish stale pre-command values): normalized-cache-as-diff-baseline, settle-window guard (`commandStateDelaySeconds`), `pendingCommandFields` overlay across publish paths, and on-connect reseed passing `settleWindowMs`.

**Open question (maintainer leaning yes):** drop SSE entirely and stay on the polling-based `next` branch (which has no SSE cutover) — SSE's only benefit here is faster ambient-temp sensor updates, at the cost of a whole subsystem + clobber bugs + MQTT churn. Full status/handoff: `docs/sse-livestream-branch-status.md`. Detailed engineer notes (pre-hybrid): `.claude/agent-memory/engineer/project_livestream_sse_transport.md`, `project_phase4_cutover.md`. Related: [[project_ha_birth_republish]].
