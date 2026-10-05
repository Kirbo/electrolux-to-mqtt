---
name: reference_release_merge_gotchas
description: "A non-gated next→main MR needs a manual main pipeline to release; a cancelled release can leave Docker Hub tags behind; `next` is protected so merge never deletes it"
metadata:
  node_type: memory
  type: reference
  originSessionId: a6ab708c-19bf-49dc-9dac-91b9a37482fd
  modified: 2026-10-05T13:45:57.791Z
---

Learned 2026-10-05 while shipping 2026.10.0 (MRs !33, !34):

- **`next` is safe on merge, even though MRs show `force_remove_source_branch: true`.** That flag comes from the project default `remove_source_branch_after_merge`, but `next` is a protected branch (Developers + Maintainers can push/merge, force push allowed), and GitLab never deletes a protected source branch. No need to flip the flag before merging. `main` is protected too (merge: Maintainers, push: no one), so it only changes through MRs. Merge with `-f sha=<head>`; the merge method is `ff`, so `main` ends up at the same SHA as `next`.
- **An MR that touches no release-gated path does not release.** Its `main` push pipeline runs only `docker build test`. To cut the release, start a pipeline manually with `glab api -X POST projects/:id/pipeline -f ref=main`. GitLab treats `rules:changes` as true for non-push pipelines, so the full release job set runs.
- **A cancelled `main` release pipeline can already have pushed `:<VERSION>` and `:latest` to Docker Hub**, with no git tag or GitLab release created. Because the tag is missing, CalVer recomputes the same version, and `docker-buildx-release.sh` uses a plain `--push`, so the rerun overwrites those image tags. That pipeline later returned 404 by id and was gone from the list. That means it was removed, not just cancelled (cancelled pipelines normally stay listed as `canceled`). Either way, pipeline watchers must treat an empty or 404 status as "stop and report", never as "still running".

See [[reference_git_cliff_mise_shim]] and [[project_calver_migration]].
