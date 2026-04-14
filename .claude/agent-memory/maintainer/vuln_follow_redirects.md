---
name: follow-redirects vuln GHSA-r4q5-vmmm-2653
description: follow-redirects <=1.15.11 leaks custom auth headers on cross-domain redirects; axios@1.15.0 (latest) pins ^1.15.11, fix is lockfile update to 1.16.0
type: feedback
---

GHSA-r4q5-vmmm-2653: follow-redirects <=1.15.11 leaks custom auth headers (e.g. Authorization) when following cross-domain redirects. axios@1.15.0 declares `^1.15.11` which allows 1.16.0, but the lockfile was pinned to 1.15.11. Fix: `pnpm update follow-redirects` (no overrides needed). The electrolux.ts client sends Authorization headers — vulnerability is reachable in production.

**Why:** `^1.15.11` covers 1.16.0 (semver caret for >=1.x.x allows minor bumps). Lockfile just had old resolution.

**How to apply:** When audit reports follow-redirects vuln via axios, check if parent range already covers fix version — if yes, `pnpm update follow-redirects` resolves it without overrides.
