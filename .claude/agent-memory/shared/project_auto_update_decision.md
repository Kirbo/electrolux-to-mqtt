---
name: project-auto-update-decision
description: In-app image auto-update was considered and rejected (2026-06-05); orchestration-layer only if revisited
metadata: 
  node_type: memory
  type: project
  originSessionId: 3c66cb8f-fc94-4f6b-b312-35146b9384c4
---

On 2026-06-05 the user asked for opt-in image auto-update (config toggle, default off). Decided **not to implement** in-app self-update.

**Why:** the app pulling+swapping its own image requires the Docker socket mounted into the container = host-root-equivalent access, which breaks the project's hardened posture (hardened `dhi.io/node` base "don't change", SonarQube "no security hotspots", zero socket usage today). Auto-update is inherently an orchestration-layer concern, not an app feature — an `autoUpdate` app flag can't be both meaningful and safe.

**How to apply:** if revisited, the sanctioned path is **Watchtower as a compose sidecar behind `profiles: ["autoupdate"]`** (default off, opt-in), scoped with `WATCHTOWER_LABEL_ENABLE=true` + label on our container, socket mounted only on the sidecar — never the app. Docs-only (both compose files + README), no `src/` change. Composes with the `:next`/`:latest` tagging so a `:next`+Watchtower user auto-follows betas and promoted-stables. The user chose "skip" for now. Related: [[project_calver_migration]].
