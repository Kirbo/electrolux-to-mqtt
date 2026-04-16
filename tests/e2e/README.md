# E2E tests

These tests hit the **live Electrolux API**. They verify that the response shapes we depend on (`ApplianceStub`, `ApplianceInfo`, `Appliance['properties']['reported']`, capability values) still match the type unions in `src/types.d.ts` and `src/types/normalized.ts`.

## Running

```bash
pnpm test:e2e
```

Requirements:

- A real `config.yml` at the repo root with valid Electrolux API credentials (`apiKey`, `username`, `password`, `countryCode`).
- The `E2E_TEST=true` environment variable. `pnpm test:e2e` sets this for you.

`pnpm test` (without `:e2e`) **does not** run E2E tests — they are excluded by env-gate at the top of each E2E test file.

## Snapshot policy

Snapshots live in `tests/e2e/snapshots/<model>/` and are **gitignored** (see `.gitignore` line covering `tests/e2e/snapshots`). They contain device serials, account identifiers, and other per-account values that we don't want in version control.

Workflow when the API contract changes:

1. Run `pnpm test:e2e` — snapshots regenerate automatically.
2. Review the resulting diffs locally with `git status` (the directory will show as untracked) and inspect each modified `appliance-*.json`.
3. If new fields appeared, propagate them into the typed unions in `src/types.d.ts` (per CLAUDE.md § Architecture) and the normalized state types in `src/types/normalized.ts`.
4. Commit the type changes (not the snapshots themselves).

If you ever need to share a snapshot for debugging, scrub serial numbers, hashes, and per-account identifiers first.
