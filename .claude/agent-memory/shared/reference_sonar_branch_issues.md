---
name: reference-sonar-branch-issues
description: SonarCloud analyzes only main (free tier) — read open issues via the public API, fix on next, confirm after the next→main MR
metadata:
  type: reference
---

`pnpm sonar` (`scripts/sonar.sh`) skips every branch except `main` (free-tier limit), so `next` always shows 0 issues and fixes can't be confirmed by Sonar before merge.

Open issues are readable without a token (public project):
`curl -s "https://sonarcloud.io/api/issues/search?componentKeys=kirbo_electrolux-to-mqtt&resolved=false&ps=100" | jq -r '.issues[] | "\(.type)\t\(.component)\t\(.line)\t\(.rule)\t\(.message)"'`
Don't read `SONAR_TOKEN` out of `.env` for this — not needed.

**How to apply:** fix findings on `next` as local commits, push once (one beta), one MR to `main` (one stable) — releases fire per push, not per commit. See [[reference-release-merge-gotchas]].
