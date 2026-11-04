# Migration Guide

This document collects upgrade notes for breaking changes in `electrolux-to-mqtt`. Versions follow CalVer (`YYYY.M.MICRO`), so a breaking change can land in any release.

Conventions:

- A breaking change is any commit whose Conventional Commit type carries the `!` marker (e.g. `feat!:`, `fix!:`, `refactor!:`). See `.claude/CLAUDE.md` § Tooling.
- Each section below covers one release that introduced a breaking change. List the user-visible breaks and the steps to adapt.
- For all changes, see [`CHANGELOG.md`](../CHANGELOG.md) (generated from the Conventional Commit history on each merge to `main`).

---

## Unreleased — environment-variable booleans are validated

### Changed
- **Boolean environment variables** (`MQTT_RETAIN`, `HOME_ASSISTANT_*`, `HA_BIRTH_REPUBLISH`, `LOGGING_*`, `HEALTH_CHECK_ENABLED`, `E2M_TELEMETRY_ENABLED`) used to treat anything except `true` as `false`, silently. They now accept `true`/`1`/`yes`/`on` and `false`/`0`/`no`/`off` (any case) and **refuse to start** on any other value, naming the variable. Action: if the container logs `Environment variable validation failed`, fix the named variable. Note `1`/`yes`/`on` now mean `true` (they used to mean `false`).

### Added
- `<NAME>_FILE` for every environment variable (Docker secrets), and the `homeAssistant` section of `config.yml` is now optional (all its fields have defaults).


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
