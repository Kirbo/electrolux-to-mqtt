---
name: project_ha_birth_republish
description: "HA restart recovery uses birth-message republish, not MQTT retain — design decision + accepted edge case"
metadata: 
  node_type: memory
  type: project
  originSessionId: a3caf3c2-df29-40a1-9a0f-b498f1692f26
---

HA appliances showed "Unavailable" after an HA restart because `availability_topic == stateTopic` (`src/appliances/comfort600.ts`) and state is published non-retained; the poll path only republishes on diff (`publishStateIfChanged`), so an unchanged poll never restores it.

Fix shipped (2026-06-14): bridge subscribes HA birth topic (`homeAssistant.statusTopic`, default `homeassistant/status`); on `birthPayload` (default `online`) it calls `Orchestrator.republishAll()` — unconditionally republishes discovery config + cached state for every appliance. Config group `homeAssistant`: `statusTopic` / `birthPayload` / `birthRepublish` (env `HA_STATUS_TOPIC` / `HA_BIRTH_PAYLOAD` / `HA_BIRTH_REPUBLISH`). New MQTT methods `subscribeAbsolute`/`unsubscribeAbsolute` (the prefix-scoped `subscribe` can't reach `homeassistant/status`).

**Why:** User chose birth-republish over MQTT retain explicitly — wanted no reliance on retained messages.

**How to apply:** Accepted edge case — if the bridge is DOWN while HA restarts, the birth message is missed and recovery waits for the next real state change. Retain (`mqtt.retain`, default false) would cover that; it was deliberately left unchanged. Don't "fix" the edge by flipping retain without asking. Reconnect handler (broker reconnect) stays state-only; only the birth path republishes discovery too. See [[project_review_deferred.md]].
