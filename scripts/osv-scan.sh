#!/bin/sh
# POSIX sh lacks `pipefail`; use -eu (unset vars + error exit). Each command
# below is a single tool invocation with no pipes, so pipefail isn't needed.
set -eu

HELP="Usage: $0 [root|backend|all]

  root     Scan pnpm-lock.yaml (main package)
  backend  Scan telemetry-backend/pnpm-lock.yaml
  all      Scan all lockfiles (default)

Requires osv-scanner in PATH (brew install osv-scanner) or Docker as fallback."

case "${1:-all}" in
  -h|--help) echo "$HELP"; exit 0 ;;
  root)    LOCKFILES="pnpm-lock.yaml";                                DESC="main package (pnpm-lock.yaml)" ;;
  backend) LOCKFILES="telemetry-backend/pnpm-lock.yaml";              DESC="telemetry-backend (telemetry-backend/pnpm-lock.yaml)" ;;
  all)     LOCKFILES="pnpm-lock.yaml telemetry-backend/pnpm-lock.yaml"; DESC="all packages (pnpm-lock.yaml + telemetry-backend/pnpm-lock.yaml)" ;;
  *)       echo "$HELP" >&2; exit 1 ;;
esac

echo "Scanning $DESC..."

# pnpm 12 records the package.json "packageManager" pin as a leading YAML document
# (packageManagerDependencies + the @pnpm/exe.* platform binaries) in front of the
# project's own document, separated by `---`. osv-scanner parses only the first
# document of a multi-document file, so it would silently see ~15 packages instead of
# the real dependency tree. Split such a lockfile into one temp file per document and
# scan each part explicitly as a pnpm lockfile (`-L pnpm-lock.yaml:<path>`).
#
# The split files live under the repo so the Docker fallback can reach them through the
# single bind mount; the directory is gitignored and removed on exit.
SPLIT_DIR=".osv-scan-split"
rm -rf "$SPLIT_DIR"
trap 'rm -rf "$SPLIT_DIR"' EXIT INT TERM

# Build the -L argument list. A single-document lockfile is passed as-is.
ARGS=""
for lock in $LOCKFILES; do
  docs=$(grep -c '^---[[:space:]]*$' "$lock" || true)
  if [ "$docs" -le 1 ]; then
    ARGS="$ARGS -L $lock"
    continue
  fi
  mkdir -p "$SPLIT_DIR"
  prefix="$SPLIT_DIR/$(echo "$lock" | tr '/' '_')"
  awk -v prefix="$prefix" 'BEGIN { n = 0 } /^---[[:space:]]*$/ { n++; next } { print > (prefix ".doc" n ".yaml") }' "$lock"
  for part in "$prefix".doc*.yaml; do
    ARGS="$ARGS -L pnpm-lock.yaml:$part"
  done
  echo "  $lock has $docs YAML documents (pnpm 12 packageManager pin) - scanning each part"
done

if command -v osv-scanner >/dev/null 2>&1; then
  # shellcheck disable=SC2086 # intentional word splitting of the argument list
  osv-scanner scan $ARGS
elif command -v docker >/dev/null 2>&1; then
  # Paths are repo-relative, so prefix them with the container mount point.
  DOCKER_ARGS=$(echo "$ARGS" | sed 's#-L \(pnpm-lock\.yaml:\)\{0,1\}#-L \1/src/#g')
  # shellcheck disable=SC2086 # intentional word splitting of the argument list
  docker run --rm -v "$(pwd):/src" ghcr.io/google/osv-scanner:v2.3.5 scan $DOCKER_ARGS
else
  echo "Error: neither osv-scanner nor docker is installed. Install one: brew install osv-scanner" >&2
  exit 1
fi
