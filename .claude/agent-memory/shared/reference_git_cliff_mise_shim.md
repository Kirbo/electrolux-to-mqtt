---
name: reference_git_cliff_mise_shim
description: "RESOLVED 2026-10-05: git-cliff is pinned in mise.toml [tools]; plain `bash scripts/mr-description.sh` works, no mise x workaround"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 3c80b19a-9af2-47c6-830f-c336db65ccfb
  modified: 2026-09-21T07:21:12.599Z
---

**Resolved 2026-10-05.** `git-cliff` is now pinned in `mise.toml` `[tools]` (2.14.2), so the shim resolves and plain `MR_TAG=<ver> bash scripts/mr-description.sh` works. CI's `generate release notes` job runs `orhunp/git-cliff:${GIT_CLIFF_VERSION}`, with the version read from the same pin by `scripts/tool-version.sh`, so local and CI output match. The `mr-description.sh` Docker fallback uses that tag too. Bump the version only in `mise.toml`, then run `mise install`.

Before the fix, `mr-description.sh` picked git-cliff with `command -v git-cliff`, which resolved to an unpinned mise shim ("No version is set for shim: git-cliff"), so the workaround was `mise x git-cliff@2.13.1 --`. See [[project_calver_migration]].
