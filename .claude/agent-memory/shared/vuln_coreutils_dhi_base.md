---
name: vuln-coreutils-dhi-base
description: Docker Scout coreutils CVEs on our images come from the dhi.io hardened base, have no upstream fix, and are unreachable at runtime
metadata:
  type: reference
---

Docker Scout flags 3 CVEs on `kirbownz/electrolux-to-mqtt` tags — all `apk / alpine/coreutils / 9.11-r0`,
Fixable column blank: CVE-2026-56391 (4.6, `uniq -w` OOB read), CVE-2026-56392 (1.8, `unexpand -t` heap
overflow), CVE-2016-2781 (4.6, `chroot --userspec`, upstream/distro wontfix).

Not ours to fix:
- No Dockerfile does `apk add coreutils` — it ships inside the `dhi.io/node:<major>-alpine<minor>` base.
- coreutils **9.11-r0 is the newest build in every Alpine branch incl. edge** (checked 2026-08-31), so
  bumping `alpine_version` in `mise.toml` changes nothing. Re-check pkgs.alpinelinux.org for `9.11-r1`
  before assuming a base bump helps.
- Unreachable: the runtime stage has no shell, runs as `node`, and executes only `node dist/index.js`
  plus the `node -e` HEALTHCHECK. All three CVEs need `uniq`/`unexpand`/`chroot` invoked with
  attacker-controlled args.

**How to apply:** treat as accepted risk; re-scan after the base image updates. Only real lever if it
ever must be silenced is a Docker Scout exception / VEX statement — ask the user first, it publishes an
assessment. Related: [[dep_alpine_hardened_images]].
