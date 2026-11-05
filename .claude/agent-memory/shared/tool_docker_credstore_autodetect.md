---
name: tool-docker-credstore-autodetect
description: Docker CLI silently adopts the platform credential helper when config.json has no auths/credsStore — a "throwaway" DOCKER_CONFIG isn't file-based unless seeded with an auths entry; Docker Desktop's store once dropped a dhi.io login
metadata:
  type: reference
---

- A `config.json` with no `auths`, `credsStore` or `credHelpers` makes the Docker CLI auto-select the platform helper (`desktop` / `osxkeychain` on macOS). So `DOCKER_CONFIG=$(mktemp -d)` with `{}` still reads/writes Docker Desktop's keychain store. Seed `{"auths":{"<registry>":{}}}` to force plain file storage (verified 2026-11-05: login then writes `auths.<registry>.auth`, `credsStore` stays unset).
- Observed 2026-11-05: `docker login dhi.io` printed "Login Succeeded" yet `docker-credential-desktop list` returned `{}` and `docker manifest inspect dhi.io/...` got 401 (anonymous token). A later login via an unseeded temp config (which went to the desktop store anyway) made it stick. Cause not determined.
- `scripts/docker-build-test.sh` therefore logs in to dhi.io with fnox `read` into a seeded temp config instead of trusting the user's store. Related: [[dep-dockerignore-allowlist]].
