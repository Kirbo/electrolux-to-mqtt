---
name: Node version management with fnm
description: Shell inherits fnm multishell symlink for Node 24; plain pnpm/node work in Claude Code sessions
type: project
---

Claude Code sessions inherit fnm's multishell symlink environment. `node --version` resolves to v24.14.1 and `pnpm` works without any PATH prefix — plain `pnpm <cmd>` is sufficient.

The old path `/Users/kimmo.saari/.fnm/node-versions/v24.14.1/installation/bin/` does not exist (fnm stores versions at `/Users/kimmo.saari/.local/share/fnm/node-versions/`), but that path is also unnecessary because the shell multishell symlink already resolves Node 24 correctly.

**How to apply:** Use plain `pnpm <cmd>` — no PATH prefix needed. Verify with `node --version` if uncertain.
