# Migration Guide

This document collects upgrade notes for breaking changes in `electrolux-to-mqtt`. Versions follow CalVer (`YYYY.M.MICRO`), so a breaking change can land in any release.

Conventions:

- A breaking change is any commit whose Conventional Commit type carries the `!` marker (e.g. `feat!:`, `fix!:`, `refactor!:`). See `.claude/CLAUDE.md` § Tooling.
- Each section below covers one release that introduced a breaking change. List the user-visible breaks and the steps to adapt.
- For all changes, see [`CHANGELOG.md`](./CHANGELOG.md) (generated from the Conventional Commit history on each merge to `main`).

---

<!--
When adding a breaking change to this file, follow this template:

## 2026.6.0 — YYYY-MM-DD

### Removed
- `<feature>` — replaced by `<replacement>`. Action: <what users must do>.

### Changed
- `<config option>` — semantics changed from X to Y. Action: <what users must do>.

### Renamed
- `<old name>` → `<new name>`.

Refer to commit `<sha>` for the rationale.
-->
