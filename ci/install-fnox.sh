#!/bin/sh
# install-fnox.sh — put the pinned fnox + age-plugin-pq on PATH in a CI job.
#
# Versions AND sha256 pins come from versions.env (FNOX_VERSION, AGE_VERSION,
# *_SHA256_LINUX_<ARCH>). The release tarballs are downloaded straight from GitHub
# (no API call, so no rate limit on shared runners), verified against the pins, and
# unpacked into $BIN (default $HOME/.local/bin). fnox reaches the project's
# post-quantum age keys through age-plugin-pq, which ships in the age tarball.
#
# Works on alpine (docker:latest, alpine:latest) and Amazon Linux (sonar-scanner),
# as root or not, on x86_64 (shared runners) and aarch64 (the macOS runner's
# Linux containers). Needs curl or wget, tar, sha256sum.
#
# Usage: sh ci/install-fnox.sh   (ci/secrets.sh runs it and puts $BIN on PATH)
set -eu

_versions="$(cd "$(dirname "$0")/.." && pwd)/versions.env"
_get() { sed -n "s/^$1=//p" "${_versions}"; }

case "$(uname -m)" in
  x86_64 | amd64) _arch=X86_64 _fnox_arch=x86_64 _age_arch=amd64 ;;
  aarch64 | arm64) _arch=AARCH64 _fnox_arch=aarch64 _age_arch=arm64 ;;
  *) echo "install-fnox: unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac

_fnox_v=$(_get FNOX_VERSION)
_age_v=$(_get AGE_VERSION)
_fnox_sha=$(_get "FNOX_SHA256_LINUX_${_arch}")
_age_sha=$(_get "AGE_SHA256_LINUX_${_arch}")
for _v in "${_fnox_v}" "${_age_v}" "${_fnox_sha}" "${_age_sha}"; do
  [ -n "${_v}" ] || { echo "install-fnox: versions.env lacks a fnox/age version or ${_arch} sha256 pin" >&2; exit 1; }
done

BIN="${BIN:-${HOME}/.local/bin}"
mkdir -p "${BIN}"
_tmp=$(mktemp -d)

_fetch() { # url dest
  if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 3 -o "$2" "$1"; else wget -q -O "$2" "$1"; fi
}
_fetch "https://github.com/jdx/fnox/releases/download/v${_fnox_v}/fnox-${_fnox_arch}-unknown-linux-musl.tar.gz" "${_tmp}/fnox.tgz"
_fetch "https://github.com/FiloSottile/age/releases/download/v${_age_v}/age-v${_age_v}-linux-${_age_arch}.tar.gz" "${_tmp}/age.tgz"
printf '%s  %s\n%s  %s\n' "${_fnox_sha}" "${_tmp}/fnox.tgz" "${_age_sha}" "${_tmp}/age.tgz" | sha256sum -c - >/dev/null || {
  echo "install-fnox: sha256 mismatch against versions.env — refusing to install" >&2
  exit 1
}
tar -xzf "${_tmp}/fnox.tgz" -C "${BIN}" fnox
tar -xzf "${_tmp}/age.tgz" -C "${_tmp}" age/age-plugin-pq
mv "${_tmp}/age/age-plugin-pq" "${BIN}/"
rm -rf "${_tmp}"

echo "install-fnox: $("${BIN}/fnox" --version) + age-plugin-pq ${_age_v} (${_arch}) in ${BIN}"
