---
name: project-state-cache-shape
description: State cache holds a UNION (raw Appliance OR normalized state); every cache→MQTT publish must normalize first
metadata: 
  node_type: memory
  type: project
  originSessionId: fbf365a4-ec13-4dff-a498-ecacc73a713e
---

The state cache (`cache.cacheKey(id).state`) holds a **union of two shapes**, not one:
- **raw `Appliance`** after a poll — `publishStateIfChanged` does `cache.set(cacheKey, responseData)` (raw, nested under `properties.reported`, `connectionState: "Connected"` capitalized).
- **already-normalized `NormalizedState`** after command feedback — `publishCommandFeedback` caches `combinedState`.

The normal poll publishes the *normalized* form to MQTT but caches the *raw* form. So reading the cache and publishing it verbatim sends the wrong shape — HA discovery templates expect flat lowercase fields (`value_json.connectionState == 'connected'`, `ambientTemperatureC`, etc.), and the raw shape breaks them → entity shows **Unavailable**.

**Invariant:** any cache→MQTT republish path MUST go through `resolveCachedNormalizedState(cached, appliance)` (in `src/appliances/normalizers.ts`) — it normalizes raw, passes normalized through, returns null otherwise. Sites: orchestrator `republishAll` (HA birth) + reconnect handler; electrolux `publishCommandFeedback`, `revertStateFromCache`, `sendApplianceCommand` current-mode lookup.

**Why:** the HA-restart birth-republish + MQTT-reconnect republish were publishing the raw cache entry, so after an HA restart the climate entity stuck on "Unavailable" (and didn't self-heal because the next poll diffs against cache → no change → no publish). Fixed 2026-06-30.

**How to apply:** never `mqtt.publish(.../state, JSON.stringify(cache.get(stateKey)))` directly — route through `resolveCachedNormalizedState`. Guards `isAppliance`/`isNormalizedState` also live in `normalizers.ts` now (single source). Related: [[project_ha_birth_republish]].
