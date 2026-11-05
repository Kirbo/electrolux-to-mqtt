---
name: glab-ci-lint-merged
description: "Validate unpushed .gitlab/ci/ changes — plain `glab ci lint` resolves local includes server-side (stale)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: c636201f-b2f5-421f-9911-10d1ff00487d
  modified: 2026-11-05T11:22:57.849Z
---

`glab ci lint` resolves `include: local:` entries from the **pushed branch on the GitLab server**, not the working tree. This repo splits CI across `.gitlab/ci/01_init.yml`..`04_release.yml` includes AND commits stay local until a human pushes (CLAUDE.md § Tooling never-push rule). So plain `glab ci lint` validates STALE includes — a broken `needs:` in an uncommitted/unpushed include passes as "valid" (verified empirically 2026-06-05).

**To validate local edits before push:** build one self-contained file = root minus its `include:` block (`head -149 .gitlab-ci.yml`, the line just before `include:`) + the four includes concatenated, then `glab ci lint <merged>`. With no `include:`, the API validates the full sent content — catches job-graph errors like an undefined `needs:` job. Confirmed it flags `undefined need: <job>`.

glab installed via mise (binary `~/.local/share/mise/installs/glab/latest/bin/glab`); the mise shim is NOT on the non-interactive tool-shell PATH, so call it by full path. Authenticated as `kirbo` on gitlab.com (remote `gitlab.com:KirboDev/electrolux-to-mqtt`).

**Plain `glab ci lint` is NOT reliable even after a push** (2026-11-02: it reported "valid" while pipeline #919 on the pushed `next` failed with a config error). Always lint the merged file. When a pipeline fails with zero jobs, the reason is only in GraphQL: `glab api graphql -f query='query { project(fullPath:"KirboDev/electrolux-to-mqtt") { pipeline(iid:"<iid>") { errorMessages { nodes { content } } } } }'`.

**YAML trap:** a script line like `- echo "label: ${X}"` — `: ` outside quotes-at-start makes the item a MAP ("config should be a string or a nested array of strings"). Start such lines with a quote or avoid `: `.
