---
name: dep_pnpm12_migration
description: "pnpm 12 (native binary) quirks hit on 2026-09-15 — mise must use the aqua backend, the lockfile gains a leading packageManagerDependencies YAML document that breaks osv-scanner and build-time packageManager injection"
metadata: 
  node_type: memory
  type: project
  originSessionId: d9c418ac-d6cb-4c45-aca9-17e257c23ea6
  modified: 2026-09-14T23:02:48.045Z
---

pnpm 12 is a native (Rust) binary. Three things broke when bumping 11.24 → 12.4.1 (2026-09-15):

1. **mise cannot install it via the npm backend.** The idiomatic `package.json` `packageManager`
   support hardcodes `npm:pnpm`, installs with `--ignore-scripts`, and leaves a shebang-less
   placeholder file that Node fails to parse (`SyntaxError: Invalid or unexpected token`).
   Verified broken on mise 2026.9.1 *and* 2026.9.8 (the 2026.9.2 "global installs work with
   pnpm 12" note does not cover this path). Fix in `mise.toml`: `[tools] "aqua:pnpm/pnpm"` with
   the version pulled from `package.json` via an `exec()` template (`grep -m1 -o 'pnpm@[0-9.]*'`),
   and `idiomatic_version_file_enable_tools` dropped. `package.json` stays the single source.
2. **The lockfile becomes a two-document YAML file.** pnpm 12 records the `packageManager` pin as
   `packageManagerDependencies` (+ `@pnpm/exe.*` platform packages) in a *leading* document
   separated by `---`. No setting turns this off (`managePackageManagerVersions` is rejected as
   unrecognized; the binary has no such switch). Consequences:
   - osv-scanner (≤ 2.6.0) parses only the first document → reported 15 packages instead of ~290.
     `scripts/osv-scan.sh` now splits multi-document lockfiles into `.osv-scan-split/` (gitignored)
     and scans each part with `-L pnpm-lock.yaml:<part>`. CI uses the same script.
   - Any `package.json` that gets a `packageManager` field injected *after* its lockfile was
     written fails `pnpm install --frozen-lockfile` with
     `ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE`. `telemetry-backend/Dockerfile` used to
     `npm pkg set packageManager=…` from the root pin; it now runs
     `corepack install -g "$PACKAGE_MANAGER"` instead, so the backend package.json/lockfile stay
     free of the pin.
3. `pnpm install --frozen-lockfile false` is gone (`--no-frozen-lockfile`); unrecognized
   `pnpm-workspace.yaml` keys are hard errors (`ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS`).

**Why:** the docker:test and osv-scan checks are the only things that surface 2.; a green
`pnpm test` says nothing about them.

**How to apply:** after any pnpm major bump run `pnpm osv-scan all` and read the package
counts, then `pnpm docker:test all`. If a future osv-scanner handles multi-document YAML,
the split in `scripts/osv-scan.sh` can go. Related: [[pnpm_v11_build_approval]],
[[dep_override_dockerfile_workspace]], [[dep_atypes_node_pin]].
