---
name: reference_git_cliff_mise_shim
description: "mr-description.sh fails on the mise git-cliff shim (\"No version is set for shim\"); run it via `mise x git-cliff@<ver> --`"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 3c80b19a-9af2-47c6-830f-c336db65ccfb
  modified: 2026-09-21T07:21:12.599Z
---

`scripts/mr-description.sh` picks git-cliff with `command -v git-cliff`. On this
machine that resolves to the mise shim, but `mise.toml` does not pin git-cliff, so
the shim errors with "No version is set for shim: git-cliff" (mise has 2.13.1
installed globally, just not activated for this dir). The Docker fallback never
triggers because the shim IS on PATH.

**How to apply:** run
`MR_TAG=<ver> mise x git-cliff@2.13.1 -- bash scripts/mr-description.sh`
(observed 2026-09-21). Alternative fix if it recurs: add git-cliff to `mise.toml`
`[tools]`, but that is the user's call. See [[project_calver_migration]].
