#!/bin/sh
# POSIX sh lacks `pipefail`; use -eu (unset vars + error exit). Each command
# below is a single tool invocation with no pipes, so pipefail isn't needed.
set -eu

HELP="Usage: $0 [root|backend|all]

  root     Scan pnpm-lock.yaml (main package)
  backend  Scan telemetry-backend/pnpm-lock.yaml
  all      Scan both lockfiles (default)

Requires osv-scanner in PATH (brew install osv-scanner) or Docker as fallback."

case "${1:-all}" in
  -h|--help) echo "$HELP"; exit 0 ;;
  root)    TARGET=root;    DESC="main package (pnpm-lock.yaml)" ;;
  backend) TARGET=backend; DESC="telemetry-backend (telemetry-backend/pnpm-lock.yaml)" ;;
  all)     TARGET=all;     DESC="all packages (pnpm-lock.yaml + telemetry-backend/pnpm-lock.yaml)" ;;
  *)       echo "$HELP" >&2; exit 1 ;;
esac

echo "Scanning $DESC..."

if command -v osv-scanner >/dev/null 2>&1; then
  case "$TARGET" in
    root)    osv-scanner scan -L pnpm-lock.yaml ;;
    backend) osv-scanner scan -L telemetry-backend/pnpm-lock.yaml ;;
    all)     osv-scanner scan -L pnpm-lock.yaml -L telemetry-backend/pnpm-lock.yaml ;;
  esac
elif command -v docker >/dev/null 2>&1; then
  case "$TARGET" in
    root)    docker run --rm -v "$(pwd):/src" ghcr.io/google/osv-scanner:v2.3.5 scan -L /src/pnpm-lock.yaml ;;
    backend) docker run --rm -v "$(pwd):/src" ghcr.io/google/osv-scanner:v2.3.5 scan -L /src/telemetry-backend/pnpm-lock.yaml ;;
    all)     docker run --rm -v "$(pwd):/src" ghcr.io/google/osv-scanner:v2.3.5 scan -L /src/pnpm-lock.yaml -L /src/telemetry-backend/pnpm-lock.yaml ;;
  esac
else
  echo "Error: neither osv-scanner nor docker is installed. Install one: brew install osv-scanner" >&2
  exit 1
fi
