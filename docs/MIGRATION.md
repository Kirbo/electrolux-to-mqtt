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

## next — Hybrid polling + SSE livestream

The bridge now uses a hybrid state model: periodic polling remains the primary source of truth, and a new SSE (server-sent events) livestream provides low-latency state deltas on top of polling. This is a non-breaking addition for users upgrading from the last release (`v2026.6.10b1`).

### Changed

- **`ELECTROLUX_REFRESH_INTERVAL`** / `electrolux.refreshInterval`

  Default changed from **30 s** to **60 s**. The bridge now also receives immediate state deltas via SSE, so the poll cadence no longer needs to be as tight for responsiveness. If you explicitly set `refreshInterval: 30` and are happy with it, no action is needed. If you relied on the old default, you may notice slightly longer latency for state changes when the SSE stream misses an event; you can restore the old behavior with `ELECTROLUX_REFRESH_INTERVAL=30`.

### Added

The following optional knobs are new in this release. All have safe defaults; no action is required.

- **`ELECTROLUX_COMMAND_STATE_DELAY_SECONDS`**
  (YAML: `electrolux.commandStateDelaySeconds`, default: **30**, range: 5–300)

  Seconds to wait after a successful command before re-polling the API for the authoritative state. The Electrolux API state endpoint lags ~15–17 s after a command 200-OK; this delay lets the server-side cache catch up before the bridge re-polls. The default (30 s) covers that lag with margin.

- **`ELECTROLUX_LIVESTREAM_IDLE_TIMEOUT_SECONDS`**
  (YAML: `electrolux.livestreamIdleTimeoutSeconds`, default: **120**, range: 30–600)

  Seconds of SSE stream silence before the bridge considers the stream stale and reconnects. The Electrolux SSE endpoint sends a heartbeat roughly every 60 s; 120 s (2 missed heartbeats) is the default threshold. Increase only if your network has unusually high latency.

- **`ELECTROLUX_LIVESTREAM_RECONNECT_MAX_SECONDS`**
  (YAML: `electrolux.livestreamReconnectMaxSeconds`, default: **300**, range: 30–3600)

  Maximum back-off ceiling (seconds) for SSE reconnect attempts after a stream failure. The bridge uses exponential back-off starting from 5 s up to this cap.
