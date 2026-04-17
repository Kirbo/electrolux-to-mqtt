---
name: Node version management with fnm
description: Local machine runs Node 25; engine-strict=true blocks pnpm; use fnm Node 24 path directly
type: project
---

Local dev machine runs Node v25.9.0 but project `engines` requires `>=24.0.0 <25.0.0` and `.npmrc` has `engine-strict=true`.

fnm has Node 24.14.1 installed at: `/Users/kimmo.saari/.local/share/fnm/node-versions/v24.14.1/installation/bin/`

**How to apply:** Prefix all pnpm commands with `PATH="/Users/kimmo.saari/.local/share/fnm/node-versions/v24.14.1/installation/bin:$PATH"` to run on the correct Node version. `fnm use 24` via `eval "$(fnm env)"` fails in sandbox due to symlink permission restrictions.
