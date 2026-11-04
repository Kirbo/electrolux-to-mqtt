---
name: fnox-outside-repo-cwd
description: fnox age encrypt/decrypt fails with "age-plugin-pq unexpectedly died" when run outside the repo dir — the mise shim has no version there
metadata:
  type: reference
---

`age-plugin-pq` (and fnox) are mise shims whose versions come from the repo's `mise.toml` / `versions.env`. Run from any other cwd (e.g. a scratchpad copy of `fnox.toml`) the shim has no version set, the plugin exits, and fnox reports `Age encryption failed: ... 'age-plugin-pq' unexpectedly died` — which looks like a broken recipient or key, but is not.

**How to apply:** stay in the repo root and point fnox at the copy instead (`fnox -c /path/copy.toml set …`), or wrap with `mise exec -C <repo> --`. Note multiple `-c` flags did not merge a copied `fnox.toml` with `fnox.local.toml` for decryption (secret "not found") — to round-trip-test a new provider, back up `fnox.toml`, set a probe secret in place, `fnox get` it, then restore the backup and re-run `scripts/secrets-local-config.sh`. Used 2026-11-04 to prove the `age_renovate` duplicate-recipient placeholder ([[project-fnox-secrets]]).
