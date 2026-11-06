# Bake file of scripts/docker-build-test.sh (`pnpm docker:test`, CI job
# `docker build test`) — not used for releases (scripts/docker-buildx-release.sh).
#
# Run from the repo root (relative paths below are resolved against the working
# directory). The script runs ONE smoke-<image> target at a time with the variables
# below in its environment; each builds its image (the linked `target:` context) and
# then docker/build-test/smoke.Dockerfile on top of it, all inside BuildKit — it works
# with any buildx builder: Docker Desktop's default one or CI's remote BuildKit server.
# Nothing is loaded into a Docker engine; only the smoke results are exported, to
# SMOKE_OUT (inside the repo — bake needs no fs entitlement there).

# versions.env — the Dockerfiles' required build-args (no defaults anywhere).
variable "NODE_VERSION" {}
variable "ALPINE_VERSION" {}
variable "NODE_DHI_DIGEST" {}
variable "NODE_DHI_DEV_DIGEST" {}
variable "NODE_STOCK_DIGEST" {}
variable "COREPACK_VERSION" {}
# The prod Dockerfile; the script points it at a stock-node rewrite when dhi.io is
# unreachable.
variable "PROD_DOCKERFILE" {
  default = "docker/Dockerfile"
}
# The checks (see docker/build-test/smoke.mjs), a per-run id, and where the results go.
variable "SMOKE_SPEC" {}
variable "SMOKE_RUN_ID" {}
variable "SMOKE_OUT" {}

target "_image" {
  context = "."
  args = {
    NODE_VERSION        = NODE_VERSION
    ALPINE_VERSION      = ALPINE_VERSION
    NODE_DHI_DIGEST     = NODE_DHI_DIGEST
    NODE_DHI_DEV_DIGEST = NODE_DHI_DEV_DIGEST
    NODE_STOCK_DIGEST   = NODE_STOCK_DIGEST
    COREPACK_VERSION    = COREPACK_VERSION
  }
}

target "prod" {
  inherits   = ["_image"]
  dockerfile = PROD_DOCKERFILE
}

target "local" {
  inherits   = ["_image"]
  dockerfile = "docker/Dockerfile.local"
}

target "backend" {
  inherits   = ["_image"]
  dockerfile = "telemetry-backend/Dockerfile"
}

target "_smoke" {
  context    = "docker/build-test"
  dockerfile = "smoke.Dockerfile"
  args = {
    SMOKE_SPEC   = SMOKE_SPEC
    SMOKE_RUN_ID = SMOKE_RUN_ID
  }
  # The smoke step must run every time — never replay a cached result.
  no-cache-filter = ["smoke"]
  output          = ["type=local,dest=${SMOKE_OUT}"]
}

target "smoke-prod" {
  inherits = ["_smoke"]
  contexts = { app = "target:prod" }
}

target "smoke-local" {
  inherits = ["_smoke"]
  contexts = { app = "target:local" }
}

target "smoke-backend" {
  inherits = ["_smoke"]
  contexts = { app = "target:backend" }
}
