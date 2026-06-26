---
name: aptabase_sessionid_guid
description: "Aptabase ingest silently drops events whose sessionId is not a GUID (200 response, no row)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: ca760c13-333a-4be6-bcd1-1ce9230731a7
---

Aptabase's `/api/v0/events` ingest validates `sessionId` as a GUID and **silently drops** any event whose sessionId is not GUID-parseable: it returns `200 {}` but never writes the ClickHouse row. No error anywhere.

Found 2026-06-26 debugging "legacy telemetry events not reaching Aptabase". The `telemetry-backend` legacy forwarder set `sessionId: body.userHash` (64-hex) → every old-bridge event dropped. The bridge's direct path works because it sends a real UUID (`src/index.ts` sessionId). Diagnosis was decisive only via a ClickHouse `SELECT *` on a landed row showing `session_id` was a UUID, then posting test events from the container with hex vs UUID sessionId.

**Fix:** `telemetry-backend/src/aptabase.ts` `userHashToSessionId()` maps the 64-hex hash → first 16 bytes as `8-4-4-4-12`. Deterministic (same install → same id). Also added a `response.ok` check in `forward()` so future non-2xx (vs silent async drops) surface in logs.

**How to apply:** any new code posting to Aptabase ingest MUST use a GUID-shaped sessionId. `country_code` empty is fine (does NOT gate ingest) — GeoIP/IP origin is irrelevant to whether the row lands. Related: [[project_aptabase_telemetry]]. Per-install counting still depends on Aptabase trusting the forwarded `X-Forwarded-For` (separate prerequisite, README §XFF).
