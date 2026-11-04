---
name: dep_container_recreate_keeps_cmd
description: Container updaters (Portainer "recreate", some Watchtower/Unraid setups) copy the OLD container's Cmd + Healthcheck onto a new image — changing the image's CMD/entry paths breaks those installs
metadata:
  type: project
---

2026-11-04: v2026.11.3b1 moved the entry from `node dist/index.js` to `node src/index.ts` (native TS). The user's own HA box (Proxmox LXC 100, Portainer stack 20) crash-looped with `Cannot find module '/app/dist/index.js'`: the container had been recreated onto the new image but kept the old container config — `Cmd`, `Healthcheck` (`import('./dist/health.js')`) and even the old version label. The stack's compose file only sets `image:`; a plain `docker compose up --force-recreate` from the stack fixed it (fresh container → image CMD).

**Why:** tools that "recreate with latest image" duplicate the container's config instead of creating it from the image defaults, so the image's CMD/HEALTHCHECK of the day the container was FIRST created live on indefinitely.

**How to apply:** treat the image's CMD, HEALTHCHECK command and any path they reference as a public contract. When an entry path moves, keep a shim at the old path — `docker/compat/legacy-dist/{index,health}.js` (copied to `/app/dist/` in the prod image; deliberately NOT named `dist` in the repo, because `.gitignore` and `.dockerignore` both drop every `dist/` — the first version was silently untracked) — and smoke-test the old command in `pnpm docker:test`. Remove a shim only when no install can still carry the old container config. Debug such a report with `docker inspect <c> --format '{{json .Config.Cmd}}'` vs the image's CMD. Host access: [[reference_proxmox_ha_host]].
