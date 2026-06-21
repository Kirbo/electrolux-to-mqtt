# Migration Guide

This document collects upgrade notes for breaking changes in `electrolux-to-mqtt`. Versions follow CalVer (`YYYY.M.MICRO`), so a breaking change can land in any release.

Conventions:

- A breaking change is any commit whose Conventional Commit type carries the `!` marker (e.g. `feat!:`, `fix!:`, `refactor!:`). See `.claude/CLAUDE.md` § Tooling.
- Each section below covers one release that introduced a breaking change. List the user-visible breaks and the steps to adapt.
- For all changes, see [`CHANGELOG.md`](../CHANGELOG.md) (generated from the Conventional Commit history on each merge to `main`).

---

<!--
When adding a breaking change to this file, follow this template:

## 2026.6.0 — YYYY-MM-DD

### Removed
- `<feature>` — replaced by `<replacement>`. Action: <what users must do>.

### Changed
- `<config option>` — semantics changed from X to Y. Action: <what users must do>.

### Renamed
- `<old name>` → `<new name>`.

Refer to commit `<sha>` for the rationale.
-->

## next — SSE livestream migration

The bridge now receives real-time appliance state updates via SSE (server-sent events) instead of periodic polling. Three config options changed as a result.

### Renamed

- `ELECTROLUX_REFRESH_INTERVAL` → **`ELECTROLUX_SAFETY_REFRESH_INTERVAL`**
  (YAML: `electrolux.refreshInterval` → `electrolux.safetyRefreshInterval`)

  The semantics have changed entirely. Previously this controlled how often the bridge polled the Electrolux API for appliance state. With SSE, state updates are pushed in real-time, so a polling interval is no longer meaningful. The renamed field is now a **full-state safety resync cadence** — a belt-and-suspenders periodic refresh that catches any state drift the SSE stream may have missed (e.g. an event that arrived during a reconnect window). The default is **21600 s (6 hours)** rather than 30 s; there is no reason to resync frequently when SSE is delivering changes immediately.

  **Action:** Rename the env var (or YAML key) in your config. If you were using a low value (e.g. 30) because you wanted frequent updates, you can remove the override entirely — real-time updates are now the default behaviour. The valid range has also changed: min 600 s (10 min), max 86400 s (24 h).

### Removed

- `ELECTROLUX_COMMAND_STATE_DELAY_SECONDS`
  (YAML: `electrolux.commandStateDelaySeconds`)

  This delay existed to work around the Electrolux API's server-side state cache: after sending a command, the bridge waited this many seconds before re-polling so the cache had time to reflect the new state. With SSE the appliance pushes its updated state directly — no poll and no cache race — so the delay is obsolete.

  **Action:** Remove this env var (or YAML key) from your config. Setting it has no effect and will cause a config validation error.

### Added

Two optional tuning knobs for the SSE connection are available if you need to adjust the defaults for your network:

- **`ELECTROLUX_LIVESTREAM_IDLE_TIMEOUT_SECONDS`**
  (YAML: `electrolux.livestreamIdleTimeoutSeconds`, default: **120**, range: 30–600)

  Seconds of SSE stream silence before the bridge considers the stream stale and reconnects. The Electrolux SSE endpoint sends a heartbeat roughly every 60 s; 120 s (2 missed heartbeats) is the default threshold. Increase only if your network has unusually high latency.

- **`ELECTROLUX_LIVESTREAM_RECONNECT_MAX_SECONDS`**
  (YAML: `electrolux.livestreamReconnectMaxSeconds`, default: **300**, range: 30–3600)

  Maximum back-off ceiling (seconds) for SSE reconnect attempts after a stream failure. The bridge uses exponential back-off starting from 5 s up to this cap.
