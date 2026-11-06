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
4. **Renovate MRs** — the scheduled CI job `renovate` (`renovate.json`) opens weekly MRs against `next`; review/finish them (pnpm/Corepack/Node/Alpine MRs need `mise lock` + `pnpm sync:versions` on their branch, Node/Alpine also `bash scripts/node-images.sh pin`; fnox/age MRs need the sha256 pins + `mise lock`; git-cliff MRs `mise lock`) instead of duplicating the bumps by hand. A new `versions.env` key needs a `# renovate:` annotation line above it. Setup: `docs/CONTRIBUTING.md` § Dependency updates.
5. **Cross-tree coordination** — every toolchain/base-image version (Node — exact `NODE_VERSION` + the three image digests, Alpine, Corepack, pnpm, fnox, age, git-cliff) lives in `versions.env` (see CLAUDE.md § Sync). Edit it, run `mise lock` (a mise tool changed), `bash scripts/node-images.sh pin` (Node/Alpine changed), then `pnpm sync:versions` (or `mise run sync-versions`), commit. CI job `versions in sync` enforces the derived `package.json` fields AND `scripts/check-version-sync.mjs` (mise pins exact + locked for every platform, Dockerfile `FROM`s and CI node images digest-pinned from `versions.env`). Node/Alpine tags: check the hardened-image catalog — https://hub.docker.com/hardened-images/catalog/dhi/node/images (the exact `<NODE_VERSION>-alpine<ALPINE_VERSION>` tag, plus its `-dev`).

6. **CI images + runner infrastructure** — the digest-pinned CI job images, runner routing (`$MAC_DOCKER`), the remote BuildKit builder and its certificate expiry. Mechanics: § CI images and BuildKit below, `docs/CONTRIBUTING.md` § CI runners and BuildKit.

## Workflow (in order)

1. **Survey state**
   - Freshness: the SessionStart hook already fetch-checked origin (6h throttle — see CLAUDE.md § Commits). If it warned that the branch is behind or unverified, sync before continuing; a behind branch means the survey reads a stale tree and every conclusion after it is suspect. No warning → proceed, no manual fetch needed.
   - `pnpm deps:check` in root + `cd telemetry-backend && pnpm deps:check`
   - Check `package.json` pins, `pnpm-lock.yaml`, overrides.
2. **Plan the update batch**
   - Group safe patches/minors. Isolate majors (one per batch/commit).
   - Read changelogs for breaking/deprecated/security notes. Check license compatibility.
3. **Apply updates**
   - `pnpm deps:update` in root + `cd telemetry-backend && pnpm deps:update`.
   - **`@types/node`** — types ahead of the runtime surface APIs that don't exist at runtime. Two mechanisms hold it, neither of them a version range (a range does NOT work — `pnpm update --latest` rewrites the spec whatever it declares; an explicit `>=24.0.0 <25.0.0` was observed being rewritten to `^26.1.2`):
     1. `updateConfig.ignoreDependencies` in **both** `pnpm-workspace.yaml` files makes the updater skip it entirely. Never run `pnpm update --latest @types/node` — naming a package explicitly overrides the ignore list.
     2. `sync-versions.sh` is its only writer, deriving the range from the major of `versions.env` `NODE_VERSION`, and re-resolves both lockfiles when the range moves.

     It will therefore show as permanently "outdated" in `pnpm outdated` (e.g. 24.x vs 26.x latest). That is the pin working, not a backlog item. Verify with `git diff` that it still reads `^<Node-LTS-major>`.
   - **pnpm self-update** — every run, even when no deps changed: compare `versions.env` `PNPM_VERSION` with `npm view pnpm version`; when newer (and at least a day old), edit it, run `mise lock`, then `pnpm sync:versions` (Corepack rewrites `packageManager` with its integrity hash), then `mise install`. Never edit `packageManager` by hand.
   - **Corepack pin** — `pnpm outdated` never lists it. Compare `versions.env` `COREPACK_VERSION` with `npm view corepack version` every run; bump it when newer (images and CI install exactly this version — `scripts/bootstrap-pnpm.sh`, the Dockerfiles), run `pnpm sync:versions`, then `pnpm docker:test all`. See memory `dep_corepack_node26`.
     pnpm 12+ writes the pin into `pnpm-lock.yaml` as a leading `packageManagerDependencies` YAML document — after a pnpm bump always run `pnpm osv-scan all` (read the package counts, the script splits the documents) and `pnpm docker:test all` (frozen installs). mise installs pnpm through `aqua:pnpm/pnpm` in `mise.toml`, not the npm backend (see memory `dep_pnpm12_migration`).
   - **pnpm install warnings** — read every line. "pnpm field in package.json is no longer read" means overrides/settings drifted back into `package.json`; migrate them to `pnpm-workspace.yaml` immediately (see Decision framework).
   - Dev tooling (Biome, Vitest, TypeScript): verify config still parses. For tooling config-key renames during a bump, confirm the rule set is still *active*, not merely *parsed* (a passing `pnpm check` only proves the config parsed). E.g. lint a throwaway snippet that should trip a known recommended rule.
   - Docker base image: check the hardened-image catalog for the latest LTS Node + Alpine tag. **Every run**, even without a version bump: `bash scripts/node-images.sh pin` and `git diff versions.env` — dhi.io rebuilds its images for CVE fixes, and a moved digest is a base-image security update (it changes `nodeImageDigest` / `nodeDevImageDigest`, so it cuts a release). Then `pnpm sync:versions` and `pnpm docker:test all`.
   - **Node (exact `NODE_VERSION`, LTS lines only) / Alpine bumped** → edit `versions.env` (`NODE_VERSION` / `ALPINE_VERSION`), run `mise lock` and `bash scripts/node-images.sh pin` (rewrites the three `NODE_*_DIGEST` pins and checks each is exactly that Node), then `pnpm sync:versions` (derives `engines.node` + `@types/node` in both packages, `alpineVersion`, the digest fields, re-resolving the lockfiles), then `mise install`. Confirm the `<NODE_VERSION>-alpine<ver>` tag (and its `-dev`) exists for both `dhi.io/node` and stock `node` first. Everything else reads `versions.env` directly under the same names (mise, CI dotenv, Dockerfile/compose build-args, hooks, deploy jobs) — Dockerfiles/compose have NO version defaults and fail loudly. Never hand-edit a derived `package.json` field. Never change the prod Dockerfile's hardened `dhi.io/node` base. **Dev tools** (fnox, age, git-cliff): bump in `versions.env` (a release at least 1 day old — `minimum_release_age`), then `mise lock` + `mise install` — no release is cut. fnox/age also carry `*_SHA256_LINUX_{X86_64,AARCH64}` pins (CI downloads, `ci/install-fnox.sh`): bump them together, taking each digest from the GitHub release asset.
   - **CI job images** — every run, check the digest-pinned images (`grep -rn '@sha256:' .gitlab-ci.yml .gitlab/ci/`): `docker:<ver>-cli`, `alpine:<ver>` (one shared pin — bump every occurrence together), `sonarsource/sonar-scanner-cli:<ver>`. Rules in § CI images and BuildKit. Renovate's GitLab CI manager proposes these too; review its digest, not only the tag.
   - **telemetry-backend image build needs host networking** — BuildKit's network namespace cannot reach `registry.npmjs.org` on the server. Compose ≥ 5 builds through Bake, which cannot be granted `network.host` (Compose passes only `--allow fs.read`), so the compose file has no `build:`; `scripts/backend-up.sh` builds with `docker build --network host` and compose only runs `telemetry-backend:local`. Do not move the build back into compose.
4. **Resolve breakage + verify**
   - Run the CLAUDE.md § Verification pipeline. Fix per CLAUDE.md § TypeScript / Code quality / Tooling.
   - Touched `telemetry-backend/`: include `cd telemetry-backend && pnpm typecheck && pnpm test`.
   - Node.js or Alpine version changed: run `pnpm sync:versions` and confirm `git diff` is clean, and `sh scripts/node-images.sh check` passes.
5. **Commit** (only on a user trigger — see CLAUDE.md § Commits)
   - Conventional Commits. `chore(deps): ...` for dep bumps — a labeling convention only (groups under Chores in the changelog). No version/release rule depends on the commit type: CalVer is date-derived, and CI keys off the changed `package.json`/`pnpm-lock.yaml` paths regardless of type.
   - One logical change per commit. Majors separate from minors where practical.
   - `git push` only on explicit user instruction — never on your own.

## CI images and BuildKit

- **Pins.** The Node job image is `${NODE_CI_IMAGE}` (versions.env `NODE_STOCK_DIGEST`, see above) — never a literal `node:` image. A CI job image that does not come from `versions.env` is pinned `name:tag@sha256:<index digest>`. Choose a release **at least 7 days old** (Docker Hub tag `last_updated`, or the image's `created`), never `latest` or a floating major, and take the digest from `docker buildx imagetools inspect <name:tag>` (the multi-arch index — the Mac runner is aarch64). The images that hold secrets matter most: `docker:*-cli` (Docker Hub publish password on `main`/`next`), `alpine` (release/deploy jobs), `sonar-scanner-cli` (`SONAR_TOKEN`). Those jobs keep `apk add` for their few tools (curl, jq, openssh-client): apk verifies package signatures against the pinned image's keys. Swap to a prebuilt image only if one already carries exactly the tools, from a trusted publisher, pinned the same way.
- **Runner routing.** Jobs never name a runner tag: `default: tags: [$MAC_DOCKER]`, `macos` globally, `macos-protected` set by the `workflow:` rules of `main` and `next`. A new job inherits it — don't add `tags:`; a new protected branch needs its own workflow rule.
- **BuildKit, never an engine.** Image builds go through `.docker_build_base`'s buildx `remote` builder (protected server `:12340` when `$CI_COMMIT_REF_PROTECTED == "true"`, branch server `:12341` otherwise). Never reintroduce the Docker socket, `DOCKER_HOST`, a `docker-container` builder, Docker-in-Docker, `DOCKER_TLS_CERTDIR`, or `docker run` / `--load` / `docker pull` in a CI job — the runner has no engine. Run an image inside BuildKit (as `docker build test` does) or as a GitLab `services:` entry; inspect one with `docker buildx imagetools`. A `docker build test` change is verified with `pnpm docker:test` locally AND in CI (remote builder) — both must pass.
- **Smoke-test cache rule.** Any BuildKit `RUN` step whose output is a test result must rerun every build: a per-run cache-bust build arg (`SMOKE_RUN_ID`), its stage in the bake target's `no-cache-filter`, and the per-run value written into the result and checked by the script — a result without it fails. Prove it with two consecutive runs: the second shows the smoke `RUN` executing (not `CACHED`).
- **Certificate expiry.** The BuildKit client certificates (GitLab File variables `BUILDKIT_*` / `BUILDKIT_PROTECTED_*`) expire **2029-02-08** — 1Password "Kirbo Mini BuildKit protected mTLS" / "… branch mTLS". From 2028-11 on, flag it in every `/maintain` report until rotated (procedure: `docs/CONTRIBUTING.md` § CI runners and BuildKit). Never touch GitLab variables or the Mac's BuildKit servers yourself — report it to the maintainer.

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
