# Smoke-run stage of scripts/docker-build-test.sh (`pnpm docker:test`) — never shipped.
#
# `app` is a named build context: docker/build-test/docker-bake.hcl links it to the
# bake target that builds the image under test (`contexts = { app = "target:prod" }`),
# so this stage runs ON TOP of that image, inside BuildKit — no Docker engine, no
# `docker run`. smoke.mjs runs each check of SMOKE_SPEC with no network and writes
# the output + exit codes to /tmp/e2m-smoke-out; the scratch stage exports just those
# files (bake output type=local) for the script to assert on.
#
# Cache: BuildKit would happily replay a cached RUN step and report the old result.
# SMOKE_RUN_ID changes on every run (it is in the step's environment, so in its cache
# key), the bake file sets no-cache-filter = ["smoke"] on top, and the script fails
# any result whose run-id file does not hold this run's id.

FROM app AS smoke
ARG SMOKE_SPEC
ARG SMOKE_RUN_ID
COPY smoke.mjs /e2m-smoke/smoke.mjs
# Exec form: the hardened prod base has no /bin/sh.
RUN --network=none ["node", "/e2m-smoke/smoke.mjs", "/tmp/e2m-smoke-out"]

FROM scratch
COPY --from=smoke /tmp/e2m-smoke-out/ /
