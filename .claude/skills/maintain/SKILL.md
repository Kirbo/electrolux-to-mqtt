---
name: maintain
description: Update dependencies, fix vulnerabilities, resolve breakage
disable-model-invocation: true
---

# Maintain — dependency & upgrade workflow

You run this yourself, in-loop, at the current session model. No subagent spawning. Keep the dep tree healthy, secure, and compatible — no prod breakage. Follow CLAUDE.md strictly. `pnpm` only (never npm/yarn/npx; `pnpm dlx` for non-local tools only).

## Responsibilities

1. **Dependency updates** — find outdated, check safety, apply. Batch minors/patches; majors individually with changelog review.
2. **Vulnerability remediation** — `pnpm audit` + `pnpm osv-scan`, triage by severity + reachability, fix via upgrades/overrides/mitigations.
3. **Breakage resolution** — an upgrade breaks typecheck/tests/lint/Sonar → diagnose, adapt to the new API, verify the pipeline.
4. **Cross-tree coordination** — Node.js major + Alpine are single-sourced in `mise.toml` `[vars]` (`node_major`, `alpine_version`); pnpm lives in `package.json` `packageManager` (no sync needed). Edit `mise.toml`, run `mise run sync-versions` (or `pnpm sync:versions`), commit. CI job `versions in sync` enforces this. Node/Alpine tags: check the hardened-image catalog — https://hub.docker.com/hardened-images/catalog/dhi/node/images (Node = major only).

## Workflow (in order)

1. **Survey state**
   - `pnpm deps:check` in root + `cd telemetry-backend && pnpm deps:check`
   - Check `package.json` pins, `pnpm-lock.yaml`, overrides.
2. **Plan the update batch**
   - Group safe patches/minors. Isolate majors (one per batch/commit).
   - Read changelogs for breaking/deprecated/security notes. Check license compatibility.
3. **Apply updates**
   - `pnpm deps:update` in root + `cd telemetry-backend && pnpm deps:update`.
   - **`@types/node`** — types ahead of the runtime surface APIs that don't exist at runtime. Two mechanisms hold it, neither of them a version range (a range does NOT work — `pnpm update --latest` rewrites the spec whatever it declares; an explicit `>=24.0.0 <25.0.0` was observed being rewritten to `^26.1.2`):
     1. `updateConfig.ignoreDependencies` in **both** `pnpm-workspace.yaml` files makes the updater skip it entirely. Never run `pnpm update --latest @types/node` — naming a package explicitly overrides the ignore list.
     2. `sync-versions.sh` is its only writer, deriving the range from `mise.toml [vars] node_major`, and re-resolves both lockfiles when the range moves.

     It will therefore show as permanently "outdated" in `pnpm outdated` (e.g. 24.x vs 26.x latest). That is the pin working, not a backlog item. Verify with `git diff` that it still reads `^<Node-LTS-major>`.
   - **pnpm self-update** — always run `corepack use pnpm@latest`; confirm the `packageManager` field in `package.json` was bumped. Non-optional — do it every run, even when no deps changed.
   - **pnpm install warnings** — read every line. "pnpm field in package.json is no longer read" means overrides/settings drifted back into `package.json`; migrate them to `pnpm-workspace.yaml` immediately (see Decision framework).
   - Dev tooling (Biome, Vitest, TypeScript): verify config still parses. For tooling config-key renames during a bump, confirm the rule set is still *active*, not merely *parsed* (a passing `pnpm check` only proves the config parsed). E.g. lint a throwaway snippet that should trip a known recommended rule.
   - Docker base image: check the hardened-image catalog for the latest LTS Node + Alpine tag.
   - **Node LTS major or Alpine bumped** → edit `mise.toml` `[vars]` (`node_major` / `alpine_version`), then run `pnpm sync:versions`. The script syncs `engines.node` + the `@types/node` major in both `package.json` files (re-resolving both lockfiles when the range moves); everything else reads `mise.toml` directly (mise `[tools]`/`[env]`, `.gitlab/ci/01_init.yml` sed-parses `[vars]`, `.githooks/common.sh`). Dockerfiles and compose files have NO version defaults — they require the `NODE_VERSION` build-arg and fail loudly without it (mise exports it locally, CI passes it explicitly). pnpm version lives in `package.json` `packageManager` (mise + corepack read it directly — no sync needed). Never hand-edit derived engines. Never change the prod Dockerfile's hardened `dhi.io/node` base. CI `versions in sync` enforces no engines drift reaches the repo.
   - **`telemetry-backend/docker-compose.yml` `build.network: host`** — do NOT remove. BuildKit's network namespace cannot reach `registry.npmjs.org`; `network: host` is the fix. Host and regular `docker run` containers reach it fine — a BuildKit-specific constraint.
4. **Resolve breakage + verify**
   - Run the CLAUDE.md § Verification pipeline. Fix per CLAUDE.md § TypeScript / Code quality / Tooling.
   - Touched `telemetry-backend/`: include `cd telemetry-backend && pnpm typecheck && pnpm test`.
   - Node.js or Alpine version changed: run `pnpm sync:versions` and confirm `git diff` is clean.
5. **Commit** (only on a user trigger — see CLAUDE.md § Commits)
   - Conventional Commits. `chore(deps): ...` for dep bumps — a labeling convention only (groups under Chores in the changelog). No version/release rule depends on the commit type: CalVer is date-derived, and CI keys off the changed `package.json`/`pnpm-lock.yaml` paths regardless of type.
   - One logical change per commit. Majors separate from minors where practical.
   - `git push` only on explicit user instruction — never on your own.

## Decision framework

- **Patch/minor, no breaking notes** → batch, verify, commit `chore(deps)`.
- **Major** → read changelog, apply alone, adapt, verify, commit `chore(deps): bump <pkg> to vX`.
- **Vuln, fix available** → upgrade to the patched version. Prefer direct fixes over overrides.
- **Vuln, no fix** → document in commit/inline; override only if reachable + justifiable, or pin + monitor. Overrides go in `pnpm-workspace.yaml` under `overrides:` — never in the `pnpm` field of `package.json` (deprecated since pnpm 11, silently ignored).
- **pnpm 11+ override migration** → if `pnpm.overrides` appears in `package.json`, move it to `pnpm-workspace.yaml` `overrides:` and remove the `pnpm` block from `package.json`.
- **Adding/removing any pnpm override** → grep every `Dockerfile*` for `pnpm install --frozen-lockfile` and confirm each such stage COPYs `pnpm-workspace.yaml`, or the frozen `--prod` install fails with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. Verify with an actual `docker build`, not just `pnpm test` — the failure only surfaces in the slim prod stage.
- **Peer-dep vuln** → a `pnpm-workspace.yaml` override does NOT fix a peer dependency (e.g. vite as a peer of vitest); add the package as a direct devDependency at the required floor instead.
- **Build script approval** (pnpm 11) → uses `allowBuilds` in `pnpm-workspace.yaml` (not the removed v10 `pnpm.onlyBuiltDependencies`). `ERR_PNPM_IGNORED_BUILDS` → set the relevant entries to `true`. `telemetry-backend/` needs its own `pnpm-workspace.yaml` because it is not a workspace member.
- **Breakage unfixable without a major refactor** → stop, report, propose options. No forced broken state.
- **Ambiguous upgrade (ESM migration, API rewrite)** → pause, ask the user.

## Quality guardrails

Never weaken `tsconfig.json` for an upgrade (keep `strict` + `noUncheckedIndexedAccess`; `telemetry-backend/tsconfig.json` must not drift weaker). All other constraints: follow CLAUDE.md.

## Communication

Report:
1. **Summary** — packages updated, vulns closed, breakages fixed.
2. **Risk notes** — watch items for the next release.
3. **Verification output** — confirm `pnpm check`, `typecheck`, `test`, `sonar` pass.
4. **Commit plan** — proposed commits with exact Conventional Commit messages.
5. **Open questions** — human decisions needed (ESM migrations, breaking API choices, license concerns).

Verification fails with no fix → stop, report which check failed + the error + diagnosis. No broken commit.

## Memory

Record dep quirks in `.claude/agent-memory/shared/` (own file + a `shared/MEMORY.md` pointer): packages with known breaking-change patterns, vuln advisories hit + how fixed, packages pinned + reason, peer-dep conflicts + resolutions, upgrade sequences needed together (e.g. Vitest + plugins), `overrides` entries + why, and tools where `pnpm dlx` vs local install matters. Verify a memory against current `package.json`/lockfile before acting on it. Don't save anything already in CLAUDE.md.
