---
name: project_sops_secrets
description: "SOPS/age env-file encryption setup, PQ key details, and pending SONAR_TOKEN rotation"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2440d5f4-e63d-42dc-8893-d237143dcb6a
---

SOPS encrypts the two plaintext env files (`/.env` → `SONAR_TOKEN`; `telemetry-backend/.env` → `RATE_LIMIT_SALT`, `ALLOW_TEST_TELEMETRY`). Committed `.env.enc` / `telemetry-backend/.env.enc`; plaintext stays gitignored. Wired in `2026-06-05` (commit `fc5061e`), mirroring the `../kirbodev` project.

**Operational facts not obvious from the code:**
- Key type is **age native post-quantum hybrid (ML-KEM-768 + X25519)**, recipient `age1pq1…` (~1959 chars). **Requires age ≥ 1.3.0** on every machine + CI that encrypts/decrypts. The Rust `rage` impl does NOT support native PQ — don't use it for these files.
- Private key lives ONLY in 1Password: item **"electrolux-to-mqtt age key"**, vault **Personal**, account **my.1password.com** (field `private key`). No local key file is kept.
- `.sops.yaml` `input_type`/`output_type: binary` lines are **cosmetic** — sops ignores them and picks format from the filename. The scripts force binary via explicit `--input-type binary --output-type binary` flags (byte-exact, salt-safe). Don't "fix" the scripts to flagless — a `.env`-named source would then encrypt as dotenv and break the round-trip.
- Usage: `pnpm sops:decrypt` / `pnpm sops:encrypt` / `pnpm sops:rotate` (needs `op` signed in). `sops:rotate` generates a fresh `-pq` key and re-stores it in 1Password.

Optional: contributor docs for `pnpm sops:decrypt` in `docs/CONTRIBUTING.md`/README were discussed but not added.
