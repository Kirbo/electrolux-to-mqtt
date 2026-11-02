---
name: project_fnox_secrets
description: "All secrets moved SOPS → fnox (2026-11-02): fnox.toml age ciphertext, 4 CI tiers via env-scoped FNOX_AGE_KEY_FILE; non-obvious operational facts + migration state"
metadata:
  node_type: memory
  type: project
  originSessionId: be568634-8a48-484d-9af1-6fb870a6c20b
  modified: 2026-11-02T10:40:39.750Z
---

Since 2026-11-02 (user request, switchboard as reference) every secret is in `fnox.toml`; design + tables in `docs/SECRETS.md`. SOPS (`.sops.yaml`, `.env.enc`, `sops-*.sh`, `ci/decrypt-env.sh`) is gone; old blobs stay readable via `git show <pre-migration>:telemetry-backend/.env.enc`.

**Decisions (user, 2026-11-02):** fnox for ALL CI secrets (not just the old SOPS files); tiers read (unprotected — `docker build test` runs on every branch), publish, deploy, sonar; external writes (1Password, GitLab) only with per-step approval.

**Non-obvious facts:**
- Keys are post-quantum; fnox needs the **plugin form** (`age-plugin-pq -identity` → `AGE-PLUGIN-PQ-1…`) and `age-plugin-pq` on PATH. It ships only from **age 1.3.2** (1.3.1 lacks it). A native `AGE-SECRET-KEY-PQ-…` file fails with "identity file contains non-identity data".
- Maintainer key = the old SOPS key (1Password "electrolux-to-mqtt age key", field `private key`, native form); recipient also in git history `.sops.yaml`. Locally: keychain (Secret Service) via generated `fnox.local.toml` — fnox merges providers WHOLE, so stale local recipients would encrypt to old keys; hooks regenerate it.
- CI identities live ONLY in GitLab (`FNOX_AGE_KEY_FILE`, one per environment scope); `secrets:rotate-ci` regenerates + proves access with `FNOX_AGE_KEY=<identity> fnox -c ./fnox.toml …` (`-c ./path` skips fnox.local.toml).
- Default CI runner is the Mac Mini (tag `macos`) → Linux containers are **aarch64**; shared runners x86_64. `ci/install-fnox.sh` pins sha256 per arch in versions.env.
- `peterevans/dockerhub-description` replaced by `scripts/dockerhub-description.sh` (Docker Hub `/v2/users/login` → JWT → PATCH repo) so the password comes from fnox.
- **Never grep/print `docker compose config`** for a service with `env_file`: it renders the secret values (2026-11-02 a `grep image` matched `CLICKHOUSE_PASSWORD`'s value and leaked it into a session log → rotation). Compare secrets by `sha256sum` only.
- Compose ≥ 5 always builds via Bake and grants only `--allow fs.read`; a `build.network: host` (even with `build.entitlements`) fails "pass --allow=network.host". The backend image is therefore built by `scripts/backend-up.sh` (`docker build --network host`), compose only runs `telemetry-backend:local`.
- The Claude Code auto-mode classifier blocks agent-run secret-store writes (keychain, 1Password, GitLab vars) — hand those commands to the user (`! …`).

**Migration state — update when done:** 2026-11-02: code + `secrets:setup` + value import (14 secrets, incl. pinned `SSH_KNOWN_HOSTS` for devaus.eu) + `secrets:rotate-ci` ×4 done (4 env-scoped `FNOX_AGE_KEY_FILE` vars exist). Pipeline #921 on `next` (aa0788a) green: read, publish, deploy tiers proven on the Mac Mini (aarch64); sonar tier first runs on `main`. Pending: delete the old GitLab vars (`CI_REGISTRY`, `CI_REGISTRY_USERNAME`, `CI_REGISTRY_PASSWORD`, `CI_REGISTRY_PASSWORD_READ`, `SONAR_TOKEN`, `SONAR_HOST_URL`, `TELEMETRY_HOST/PATH/USER`, `SSH_KEY`, `SOPS_AGE_KEY_FILE`). `SONAR_TOKEN` rotated 2026-11-02; `CLICKHOUSE_PASSWORD` (badge_reader) leaked into a session log 2026-11-02 → rotated the same day: badge_reader lives in `~/Projects/aptabase/clickhouse-badge-reader.xml` on the server, a single-file bind mount into `aptabase_events_db` (rewrite in place with `cat >` — editors that swap the inode leave the container on the old file); now `password_sha256_hex`, then `pnpm secrets:set telemetry CLICKHOUSE_PASSWORD`; revoke the old token in SonarCloud once CI on main uses the new one.

**PAT:** `scripts/rotate-gitlab-pat.sh` self-rotates the 1Password "electrolux-to-mqtt - GitLab API Token" (used only by `secrets:rotate-ci` → `gitlab-set-ci-var.sh`). Repo path is `KirboDev/electrolux-to-mqtt` (project id 69776314).

Related: [[project_versions_env]], [[project_aptabase_telemetry]].
