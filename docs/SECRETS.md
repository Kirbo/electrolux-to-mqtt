# Secrets

Every secret this repo needs, for local maintainer work and for GitLab CI, lives in **`fnox.toml`** as [age](https://age-encryption.org) ciphertext and is read with [fnox](https://fnox.jdx.dev). Nothing else stores secrets: no committed `.env.enc`, no plaintext `.env` in git, and GitLab holds only one age identity per CI tier (plus the Mac Mini's BuildKit client certificates — runner credentials, not repo secrets; see [CI](#ci)). fnox and age are pinned in [`versions.env`](../versions.env) like every other tool.

Contributors need none of this. The app has no build-time secrets, and every check, test and image build except the release and deploy jobs runs without a key.

## Who can read what

Each fnox **provider** encrypts to a fixed set of recipients (public keys), so the provider a secret uses decides who can read it. Each **profile** groups the secrets of one job group.

| Profile | Secrets | Provider | Readers |
|---|---|---|---|
| `read` | `DOCKERHUB_USERNAME`, `DOCKERHUB_PASSWORD_READ` (pull-only token: Docker Hub + dhi.io) | `age_read` | maintainer, ci-read, ci-publish |
| `publish` | `DOCKERHUB_PASSWORD` (push) | `age_publish` | maintainer, ci-publish |
| `deploy` | `SSH_KEY` (base64), `SSH_KNOWN_HOSTS`, `TELEMETRY_HOST`, `TELEMETRY_USER`, `TELEMETRY_PATH` | `age_deploy` | maintainer, ci-deploy |
| `telemetry` | `APTABASE_APP_ID`, `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD` (the backend's runtime `.env`) | `age_deploy` | maintainer, ci-deploy |
| `sonar` | `SONAR_TOKEN`, `SONAR_HOST_URL` | `age_sonar` | maintainer, ci-sonar |
| `renovate` | `RENOVATE_TOKEN` (GitLab PAT: `api`, `write_repository`), `GITHUB_COM_TOKEN` (read-only, public repos — GitHub release lookups) | `age_renovate` | maintainer, ci-renovate |

All keys are post-quantum (`age-keygen -pq`, ML-KEM-768 + X25519). fnox reaches them through `age-plugin-pq`, which ships with age ≥ 1.3.2, so fnox needs the identity in its plugin form (`AGE-PLUGIN-PQ-1…`, made with `age-plugin-pq -identity`).

## Identities

| Identity | Where it lives |
|---|---|
| maintainer | 1Password item "electrolux-to-mqtt age key" (field `private key`, native form). On each maintainer machine, the plugin form sits in the OS keychain (service `electrolux-to-mqtt.fnox`), put there by `pnpm secrets:setup`. |
| ci-read | GitLab File variable `FNOX_AGE_KEY_FILE`, environment scope `ci/read`, **unprotected** (image builds on every branch need the pull token) |
| ci-publish | `FNOX_AGE_KEY_FILE`, scope `release/publish`, protected |
| ci-deploy | `FNOX_AGE_KEY_FILE`, scope `release/deploy`, protected |
| ci-sonar | `FNOX_AGE_KEY_FILE`, scope `ci/sonar`, protected |
| ci-renovate | `FNOX_AGE_KEY_FILE`, scope `ci/renovate`, protected. Until it is generated, its `# ci-renovate` recipient line in `fnox.toml` holds a copy of the maintainer key as a placeholder. |

CI identities exist only in GitLab. A lost or leaked one is replaced, never recovered: `pnpm secrets:rotate-ci <tier>`.

`fnox.toml` itself names no identity, so it works unchanged everywhere. The gitignored `fnox.local.toml` is **generated** (`scripts/secrets-local-config.sh`) and points every age provider at the keychain. fnox merges a provider whole, so that file repeats each provider's recipients. The post-checkout, post-merge and post-rewrite git hooks regenerate it, so a pulled recipient change is picked up.

## Local use

One-time per machine (needs the 1Password CLI): `pnpm secrets:setup`. After that nothing prompts:

| Command | What |
|---|---|
| `pnpm secrets:check` | Every profile resolves |
| `pnpm secrets:set <profile> <NAME>` | Encrypt one value (stdin) with that profile's provider |
| `pnpm secrets:env` | Write `telemetry-backend/.env` (0600, gitignored) for `pnpm backend:docker` |
| `pnpm sonar` | Runs the scanner under `fnox exec -P sonar` |
| `pnpm docker:test` | Logs in to `dhi.io` with `read` (temporary Docker config) when Docker isn't logged in, so the prod image builds on the hardened base |
| `pnpm secrets:rotate-ci <tier>` | New identity for `read`/`publish`/`deploy`/`sonar`/`renovate`: rewrites its recipient lines, re-encrypts, proves the tier reads exactly its profiles, and stores it in GitLab. Commit `fnox.toml` afterwards. |
| `fnox exec --no-defaults -P <profile> -- <cmd>` | Anything else |

## CI

A job's `environment:` (`action: prepare`) selects its tier, and so the one `FNOX_AGE_KEY_FILE` GitLab gives it:

| Jobs | Environment | Profiles |
|---|---|---|
| `docker build test`, `try to build docker images` | `ci/read` | `read` |
| `build and deploy [beta] docker images`, `update dockerhub description` | `release/publish` | `read`, `publish` |
| `deploy telemetry-backend`, `refresh telemetry badges` | `release/deploy` | `deploy`, `telemetry` |
| `sonarcloud-check` | `ci/sonar` | `sonar` |
| `renovate` (schedule `SCHEDULE=RENOVATE` only) | `ci/renovate` | `renovate` |

`ci/secrets.sh` installs fnox + `age-plugin-pq` (`ci/install-fnox.sh`: release tarballs checked against the sha256 pins in `versions.env`, x86_64 and aarch64) and provides `secrets_load <profile>…` (export into the job shell) and `secret <NAME> <profile>` (print one value for a pipe). A wrong tier fails the job. GitLab masks none of these values, so jobs never `set -x` or echo them.

- **Images:** registry logins pipe the password straight into `docker login --password-stdin`.
- **Deploy:** the SSH key goes into `ssh-agent`, never a file. The host key is pinned (`SSH_KNOWN_HOSTS`, no `ssh-keyscan`). The backend's `.env` is piped over ssh into a 0600 file on the server, so it is never written on the runner.
- **BuildKit (image builds):** the one value GitLab holds outside fnox. The docker jobs build on the Mac Mini's BuildKit servers over mutual TLS, with client certificates in GitLab File variables: `BUILDKIT_CA` / `BUILDKIT_CERT` / `BUILDKIT_KEY` (branch server, unprotected) and `BUILDKIT_PROTECTED_CA` / `_CERT` / `_KEY` (protected server, **protected** variables). They are credentials of the runner machine, shared by every project on it and kept in 1Password ("Kirbo Mini BuildKit protected mTLS" / "… branch mTLS"), not secrets of this repo. GitLab's protected flag is also what keeps the protected server's certificate out of branch pipelines — fnox could not: `docker build test` reads only the unprotected `ci/read` tier, also on `main`/`next`. They expire **2029-02-08**; rotation: [CONTRIBUTING § CI runners and BuildKit](CONTRIBUTING.md#ci-runners-and-buildkit).

## Rotation and leaks

Any `fnox.toml` change on `main`/`next` re-runs `deploy telemetry-backend`, so a rotated `telemetry` value reaches the server's `.env` on push (the job runs alone in such a pipeline).

Re-encrypting does not revoke ciphertext already in git history. If an identity leaks, rotate it **and** change the values it could read (`pnpm secrets:set`), then commit. The maintainer identity is the backup of record for everything: losing it and 1Password together loses every value.
