---
name: project_sops_secrets
description: "SOPS/age env-file encryption setup, PQ key details, and pending SONAR_TOKEN rotation"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2440d5f4-e63d-42dc-8893-d237143dcb6a
---

SOPS encrypts the two plaintext env files (`/.env` → `SONAR_TOKEN`; `telemetry-backend/.env` → the Aptabase-service secrets: ClickHouse connection creds (`CLICKHOUSE_URL` + read-only `badge_reader` user/password) and `APTABASE_APP_ID`). Committed `.env.enc` / `telemetry-backend/.env.enc`; plaintext stays gitignored. Wired in `2026-06-05` (commit `fc5061e`), mirroring the `../kirbodev` project. (The old `RATE_LIMIT_SALT` / `ALLOW_TEST_TELEMETRY` contents predate the 2026-06-26 Aptabase rebuild — superseded by the ClickHouse creds above. `SONAR_TOKEN` rotation is still pending.)

**Operational facts not obvious from the code:**
- Key type is **age native post-quantum hybrid (ML-KEM-768 + X25519)**, recipient `age1pq1…` (~1959 chars). **Requires age ≥ 1.3.0** on every machine + CI that encrypts/decrypts. The Rust `rage` impl does NOT support native PQ — don't use it for these files.
- Private key lives ONLY in 1Password: item **"electrolux-to-mqtt age key"**, vault **Personal**, account **my.1password.com** (field `private key`). No local key file is kept.
- `.sops.yaml` `input_type`/`output_type: binary` lines are **cosmetic** — sops ignores them and picks format from the filename. The scripts force binary via explicit `--input-type binary --output-type binary` flags (byte-exact, salt-safe). Don't "fix" the scripts to flagless — a `.env`-named source would then encrypt as dotenv and break the round-trip.
- Usage: `pnpm sops:decrypt` / `sops:encrypt` / `sops:rotate` / `sops:sync-ci` (needs `op` signed in). `sops:rotate` generates a fresh `-pq` key, re-stores it in 1Password, then calls `sops:sync-ci`.
- **CI age key**: `pnpm sops:sync-ci` (`scripts/sync-ci-age-key.sh` → `gitlab-set-ci-var.sh`, with `op-ensure-signin.sh`) pushes the age private key to GitLab as the **File-type** CI/CD variable **`SOPS_AGE_KEY_FILE`** (masked+protected; GitLab materializes it as a temp file, sops reads the path — key never in the job env block). Needs a GitLab PAT (`api` scope, Maintainer+) in 1Password item `electrolux-to-mqtt - GitLab API Token` (override via `SOPS_CI_PAT_ITEM`; a user PAT works across projects). The CI `deploy telemetry-backend` job decrypts via `ci/decrypt-env.sh` (reads `SOPS_AGE_KEY_FILE` or a masked `SOPS_AGE_KEY`). Mirrors `../switchboard`. **Run `pnpm sops:sync-ci` once before the first deploy** — the variable is NOT yet set in CI.
- **PAT rotation**: `pnpm gitlab:rotate-pat` (`scripts/rotate-gitlab-pat.sh`) self-rotates the GitLab token (`personal_access_tokens/self/rotate`, 1-year expiry) and saves it back to 1Password. No CI-variable mirror (unlike switchboard's `RELEASE_TAG_TOKEN`) — this repo's PAT is used only locally by `sops:sync-ci`; releases use `CI_JOB_TOKEN`.
- **Pending GitLab move**: repo moving from `kirbo/electrolux-to-mqtt` → `kirbodev/electrolux-to-mqtt`. The project-path is hardcoded in `src/version-checker.ts` (`GITLAB_REPO`), `telemetry-backend/src/config.ts` (releases URLs), `scripts/gitlab-set-ci-var.sh` (CI_PROJECT_ID default), the version-checker tests, README badges/links, `docker/Dockerfile` labels, CONTRIBUTING/HOME_ASSISTANT docs — all `kirbo` → `kirbodev` on the move. Do NOT touch `/home/kirbo/…` (server user, not the namespace).

Optional: contributor docs for `pnpm sops:decrypt` in `docs/CONTRIBUTING.md`/README were discussed but not added.
