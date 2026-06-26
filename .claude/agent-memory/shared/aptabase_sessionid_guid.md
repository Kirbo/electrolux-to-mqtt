---
name: aptabase_sessionid_guid
description: "Aptabase ingest gotchas — drops non-GUID sessionId; derives user_id from app_id+IP+User-Agent"
metadata: 
  node_type: memory
  type: reference
  originSessionId: ca760c13-333a-4be6-bcd1-1ce9230731a7
---

Aptabase's `/api/v0/events` ingest validates `sessionId` as a GUID and **silently drops** any event whose sessionId is not GUID-parseable: it returns `200 {}` but never writes the ClickHouse row. No error anywhere.

Found 2026-06-26 debugging "legacy telemetry events not reaching Aptabase". The `telemetry-backend` legacy forwarder set `sessionId: body.userHash` (64-hex) → every old-bridge event dropped. The bridge's direct path works because it sends a real UUID (`src/index.ts` sessionId). Diagnosis was decisive only via a ClickHouse `SELECT *` on a landed row showing `session_id` was a UUID, then posting test events from the container with hex vs UUID sessionId.

**Fix 1:** `telemetry-backend/src/aptabase.ts` `userHashToSessionId()` maps the 64-hex hash → first 16 bytes as `8-4-4-4-12`. Deterministic (same install → same id). Also added a `response.ok` check in `forward()` so future non-2xx (vs silent async drops) surface in logs.

**Gotcha 2 — `user_id` = daily hash of `app_id + client IP + User-Agent`** (Aptabase no-cookie model; salt rotates per UTC day). Confirmed empirically: same IP + different `User-Agent` → different `user_id`. So distinct installs that share both IP and UA collapse into one `user_id`; the per-version badge breakdown then overcounts (it sums) while `total` (uniqExact) shows the merged count. The forwarder hit this — all legacy events share the backend container IP (the openresty/NPM→Aptabase chain doesn't honor our `X-Forwarded-For` → empty `country_code`) AND a hardcoded UA → 4 wild bridges merged to 1 user.

**Fix 2:** forwarder sets `User-Agent: electrolux-to-mqtt-legacy/<sessionId>` (sessionId derived from the bridge's `userHash`) → each install gets its own `user_id`, **no XFF/infra dependency**. This is the right identity anyway: client IP would merge NAT'd installs and split dynamic-IP ones; `userHash` is the true per-install id. XFF still sent — fixing the proxy chain restores GeoIP but counting no longer needs it.

**How to apply:** posting to Aptabase ingest → use a GUID `sessionId` (else dropped) AND make `User-Agent` unique per logical user (else they merge behind a shared IP). `country_code` empty does NOT gate ingest. Related: [[project_aptabase_telemetry]].
