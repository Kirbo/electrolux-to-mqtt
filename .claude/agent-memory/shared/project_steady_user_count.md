---
name: project_steady_user_count
description: "Badge \"users\" count = distinct session_id over rolling 26h; stable sessionId from username hash; telemetry pings every 15min decoupled from checkInterval"
metadata: 
  node_type: memory
  type: project
  originSessionId: ca760c13-333a-4be6-bcd1-1ce9230731a7
---

The telemetry badge must show a **steady** count of active installs over the past ~24h (not a UTC-day count that resets at midnight and ramps up). Three coordinated pieces deliver this:

1. **Stable per-install id.** Bridge `src/telemetry.ts` `deriveTelemetrySessionId(username)` = `sha256(electrolux username)` → first 16 bytes as a UUID. Replaced the per-boot `crypto.randomUUID()` (which lost the count on every restart). Matches the backend's legacy `userHashToSessionId` exactly, so the same install keeps one `session_id` across restarts AND across the legacy→direct upgrade. (Old pre-migration bridge already used `sha256(username)` as `userHash` — this restores that identity.)

2. **Rolling 26h window keyed on `session_id`.** `telemetry-backend/src/clickhouse.ts` `aggregateTelemetry`: `uniqExact(session_id)` over `timestamp >= now() - INTERVAL 26 HOUR` (const `USER_WINDOW_HOURS`). NOT Aptabase's `user_id` (rotates with a daily salt → can't count across midnight) and NOT `toStartOfDay` (resets/ramps). 26h = version-checker's 24h max poll interval + 2h slack. Channels are a dedicated `GROUP BY channel` distinct query (so stable/beta are real counts, not the over-counting per-version sum).

3. **15-min telemetry ping, decoupled from version checks.** `version-checker.ts` `TELEMETRY_PING_INTERVAL_MS = 15*60*1000`; `runTelemetry` on its own interval, `checkForUpdates` (GitLab + ntfy) stays on the user's `checkInterval`. Keeps every install's "last seen" fresh independent of how rarely they check for updates.

**Why 26h and not a tight window:** legacy/wild bridges ping at THEIR checkInterval (up to 24h), so the window can't shrink below 24h while legacy traffic exists or they'd drop out between pings. Once `source='legacy'` →0 and the legacy ingest half is deleted, shrink the window to ~1h (4× the 15-min ping) for a tighter live count.

**Privacy note:** this sends a stable id derived from the Electrolux username (one-way hash, not the username/credential). The migration's random UUID deliberately avoided a stable id; Tier 2 reverts that — disclosed in README (root §Anonymous Telemetry, `config.example.yml`). User accepted the tradeoff (anonymous hash, not linkable to a person by the maintainer). Related: [[aptabase_sessionid_guid]], [[project_aptabase_telemetry]].
