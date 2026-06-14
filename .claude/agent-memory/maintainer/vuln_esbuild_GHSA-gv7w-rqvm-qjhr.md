---
name: vuln-esbuild-GHSA-gv7w-rqvm-qjhr
description: esbuild <0.28.1 vulns (high GHSA-gv7w-rqvm-qjhr + low GHSA-g7r4-m6w7-qqqr) — override in both pnpm-workspace.yaml
metadata:
  type: project
---

esbuild versions >=0.17.0 <0.28.1 carry two vulns: GHSA-gv7w-rqvm-qjhr (high, CVSS 8.1 — missing binary integrity verification enabling RCE via NPM_CONFIG_REGISTRY) and GHSA-g7r4-m6w7-qqqr (low, CVSS 2.5 — arbitrary file read on Windows dev server).

Fixed via `overrides: esbuild: ">=0.28.1"` in both `/home/kirbo/Projects/electrolux-to-mqtt/pnpm-workspace.yaml` and `/home/kirbo/Projects/electrolux-to-mqtt/telemetry-backend/pnpm-workspace.yaml` (added June 2026).

The vuln is transitive dev-only (via vite→esbuild and tsx→esbuild). Remove the override once vite, tsx, and vitest bump their own dep floor past 0.28.0.

**Why:** direct fix (upgrade esbuild in upstream) not yet available; override is the correct pnpm 11 pattern.

**How to apply:** Check if vite/tsx/vitest have bumped their esbuild floor to >=0.28.1 before removing the override. Run `pnpm why esbuild` to confirm resolved version.
