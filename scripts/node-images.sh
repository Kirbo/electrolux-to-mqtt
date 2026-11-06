#!/bin/sh
# node-images.sh pin|check — the digest pins of the three Node base images.
#
# versions.env pins every Node image by its multi-arch index digest:
#   NODE_DHI_DIGEST      dhi.io/node:<NODE_VERSION>-alpine<ALPINE_VERSION>       (prod runtime)
#   NODE_DHI_DEV_DIGEST  dhi.io/node:<NODE_VERSION>-alpine<ALPINE_VERSION>-dev   (prod build stages)
#   NODE_STOCK_DIGEST    node:<NODE_VERSION>-alpine<ALPINE_VERSION>              (local dev, backend, CI)
#
#   pin    resolve each tag's CURRENT digest and write it into versions.env. Run it after
#          bumping NODE_VERSION / ALPINE_VERSION, or to pick up a rebuilt base (dhi.io
#          rebuilds its images for CVE fixes), then `pnpm sync:versions` and commit.
#   check  fail unless every pinned digest is an image of exactly NODE_VERSION (each
#          platform's NODE_VERSION env, `-rN` package suffix allowed) — a stale digest
#          left behind by a NODE_VERSION bump fails here. It does not compare against
#          the tag's current digest, so an upstream rebuild never fails a pipeline.
#          CI job `docker build test` runs it.
#
# Registry-only (`docker buildx imagetools`, no engine). dhi.io needs a Docker login
# (CI logs in; locally `docker login dhi.io`).
set -eu

MODE="${1:?usage: node-images.sh pin|check}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSIONS="${ROOT}/versions.env"
get() { sed -n "s/^$1=//p" "${VERSIONS}"; }

NODE_VERSION=$(get NODE_VERSION)
ALPINE_VERSION=$(get ALPINE_VERSION)
: "${NODE_VERSION:?versions.env has no NODE_VERSION}" "${ALPINE_VERSION:?versions.env has no ALPINE_VERSION}"
TAG="${NODE_VERSION}-alpine${ALPINE_VERSION}"

# key image
IMAGES="NODE_DHI_DIGEST dhi.io/node:${TAG}
NODE_DHI_DEV_DIGEST dhi.io/node:${TAG}-dev
NODE_STOCK_DIGEST node:${TAG}"

case "${MODE}" in
  pin)
    echo "${IMAGES}" | while read -r key image; do
      digest=$(docker buildx imagetools inspect "${image}" --format '{{.Manifest.Digest}}')
      printf '%s' "${digest}" | grep -Eqx 'sha256:[0-9a-f]{64}' ||
        { echo "node-images: ${image} resolved to '${digest}', not a sha256 digest" >&2; exit 1; }
      sed -i.bak "s|^${key}=.*|${key}=${digest}|" "${VERSIONS}" && rm -f "${VERSIONS}.bak"
      echo "  ${key}=${digest}  (${image})"
    done
    "$0" check
    ;;
  check)
    echo "${IMAGES}" | while read -r key image; do
      digest=$(get "${key}")
      printf '%s' "${digest}" | grep -Eqx 'sha256:[0-9a-f]{64}' ||
        { echo "node-images: versions.env ${key} is '${digest}', not sha256:<64 hex>" >&2; exit 1; }
      # One line per platform: "<platform> <NODE_VERSION env value>".
      envs=$(docker buildx imagetools inspect "${image}@${digest}" \
        --format '{{range $p, $i := .Image}}{{$p}}{{range $i.Config.Env}} {{.}}{{end}}{{println}}{{end}}')
      [ -n "${envs}" ] || { echo "node-images: ${image}@${digest} has no image config" >&2; exit 1; }
      echo "${envs}" | while read -r platform env; do
        [ -n "${platform}" ] || continue
        found=$(printf '%s' "${env}" | tr ' ' '\n' | sed -n 's/^NODE_VERSION=//p')
        case "${found}" in
          "${NODE_VERSION}" | "${NODE_VERSION}"-r*) ;;
          *)
            echo "node-images: ${key} (${image}@${digest}) is Node '${found:-?}' on ${platform}, versions.env says ${NODE_VERSION} — run \`bash scripts/node-images.sh pin\`" >&2
            exit 1
            ;;
        esac
      done
      echo "  ok: ${image}@${digest} is Node ${NODE_VERSION}"
    done
    ;;
  *)
    echo "usage: node-images.sh pin|check" >&2
    exit 1
    ;;
esac
