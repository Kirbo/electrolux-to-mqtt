---
name: project_repo_layout
description: "Where docs and config live — docs/ vs root, and why config stays at root"
metadata: 
  node_type: memory
  type: project
  originSessionId: cbb15658-5f0b-428c-b28f-3a5548643660
---

Root-folder declutter (2026-06-10): the six standalone docs moved into `docs/` — `AI_DEVELOPMENT.md`, `CONTRIBUTING.md`, `HOME_ASSISTANT.md`, `MIGRATION.md`, `SECURITY.md`, `SONARQUBE.md`. Links rewritten both ways (moved docs gained `../` to root files; `README.md` inbound links gained `docs/`).

**Stays at root, do not move:**
- `README.md` + `LICENSE` — GitHub/GitLab landing page + Docker Hub overview read root `README.md`; license detection wants root.
- `CONTRIBUTING.md`/`SECURITY.md` live in `docs/` — GitHub *and* GitLab still auto-resolve those two from `docs/`, so UI links keep working.
- **All config files** (`tsconfig*.json`, `vitest.config.ts`, `vitest.setup.ts`, `biome.jsonc`, `cliff.toml`, `sonar-project.properties`, `renovate.json`, `.env*`, `.sops.yaml`, dotfiles). Rejected moving them: tools auto-discover at root, CI `.rules_code_changes` pattern-matches them by path (`.gitlab/ci/*.yml`), tsconfig `extends` chains + sonar write to them relatively. A `config/` dir would need `--config` flags everywhere = more obscure, the opposite of the goal.

**Why:** keep root lean without breaking tool/platform auto-resolution.
**How to apply:** new standalone docs → `docs/`; new config → root. Don't relocate config to tidy root. See [[feedback_single_source_of_truth]] for the sync-references discipline when a doc moves.
