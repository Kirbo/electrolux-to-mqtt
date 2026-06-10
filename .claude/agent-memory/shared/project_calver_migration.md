---
name: project_calver_migration
description: SemVer→CalVer release migration — phase status and what Phase 3 (docs) still needs
metadata: 
  node_type: memory
  type: project
  originSessionId: 86db47f4-741d-4dc8-9e13-ccbcb6ee319b
---

Release versioning migrated from SemVer to CalVer (Home Assistant style): stable `YYYY.M.MICRO` on `main`, beta `YYYY.M.MICRObN` on `next`. Version is date-derived (not commit-type-derived).

**Phase 1 (done, shipped in stable `1.19.0`):** version-checker on app (`src/version-checker.ts`) + telemetry backend (`telemetry-backend/src/{app,utils}.ts`) parse BOTH old `-rc.N` and new `bN` formats. CalVer `2026.x` sorts numerically above SemVer `1.x`, so ordering holds across the cutover.

**Phase 2 (done — the flip):** dropped go-semantic-release. `scripts/compute-calver-{base,beta}.sh` (+ subprocess tests) compute the version; `cliff.toml` + git-cliff generate the per-release `UNRELEASED-CHANGELOG.md` (reproduces go-semantic-release default format 1:1, validated byte-identical to v1.17.0; Breaking Changes is the top section per the user's request). **combine-changelogs is KEPT** as the aggregator for the full `CHANGELOG.md` (user's external tool — git-cliff is only the generator). Tags + releases created via the GitLab Releases API on both tracks. Removed `.semrelrc`. First CalVer beta = `2026.6.0b1`, first stable = `2026.6.0`.

**Phase 3 (DONE — docs):** README beta channel + env table, `config.example.yml` + both compose examples (updateChannel wording), `docs/MIGRATION.md` (CalVer + generator), `.claude/CLAUDE.md` versioning rules (rewritten: version is date-derived, commit type only sets the changelog section, `!` → top Breaking Changes section, release cut by file paths not type), and stale `.semrelrc`/semantic-release refs in `.claude/agents/{maintainer,auditor}.md`. `updateChannel` is `stable`|`beta` (unchanged). The only intentional remaining "go-semantic-release" mention is a descriptive comment in `.gitlab/ci/01_init.yml`.

**Remaining (human, at release time):** announce the 1.19.0 → 2026.6.0 jump in the first stable release notes / a pinned note (not a code break — version-checker compares numerically, so `:latest` users get the update notification normally).

See [[project_review_deferred.md]] for other deferred items.
