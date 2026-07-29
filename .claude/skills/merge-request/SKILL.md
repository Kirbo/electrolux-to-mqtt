# Merge request — sync the `next` → `main` MR

You run this yourself, in-loop, at the current session model. No subagent spawning.

**This is an upsert, not a create.** There is at most ONE open `next` → `main` merge request at a time. Running this skill makes that MR match reality: it creates the MR if none is open, and otherwise updates the existing one's title and description in place. Running it repeatedly is safe and expected — after every batch of commits to `next`.

Never pushes, never commits, never merges.

## 1. Preconditions — check all, stop on any failure

Do not "fix" these by pushing or committing.

```sh
git fetch origin
git status -sb            # must show no ahead/behind
git status --short        # must be empty
git rev-list --count origin/main..origin/next   # must be > 0
```

- **Ahead of remote** → STOP. The MR reflects the remote, so unpushed commits would be silently missing from it. Say the branch needs pushing; CLAUDE.md forbids pushing without an explicit instruction. Ask the user to push.
- **Behind remote** → STOP. Rebase first — an MR from a stale branch re-proposes work that already landed.
- **Dirty tree** → STOP and report. Uncommitted work won't be in the MR.
- **Zero commits** → nothing to do; report that `next` and `main` are level.

Then run verification (CLAUDE.md § Verification) and record what actually passed: `pnpm check`, `pnpm typecheck`, `pnpm test`; `pnpm sonar` (skips off `main` — expected, note it rather than claiming it passed); `cd telemetry-backend && pnpm typecheck && pnpm test` if that tree changed; `pnpm docker:test` if `.dockerignore`, any `Dockerfile`, or anything an image consumes changed.

## 2. Compute the title from TODAY's date — never carry the old one forward

CalVer is date-derived. An MR opened in July as `2026.7.3` must become `2026.8.0` once the month rolls over, so **recompute every run and update the title if it differs**.

```sh
Y=$(date +%Y); M=$(date +%-m)          # %-m: no leading zero
VERSION=$(git tag --list 'v*' | sh scripts/compute-calver-base.sh "$Y" "$M")
```

`compute-calver-base.sh` reads candidate tags **on stdin** — piping `git tag` in is mandatory. Called with no stdin it silently returns `<Y>.<M>.0`, which is wrong whenever stable tags already exist for that month. It returns the highest `v<Y>.<M>.<micro>` plus one, or `.0` when the month has no stable tag yet — which is exactly why a month change resets the micro with no special handling.

**Does this MR cut a release?** Decided by file paths, not commit types (CLAUDE.md § Tooling):

```sh
git diff --name-only origin/main..origin/next \
  | grep -E '^(src/|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|docker/Dockerfile|tsconfig\.json)'
```

- **Any match** → title is `<VERSION> release`, e.g. `2026.7.2 release`.
- **No match** (docs, tests, CI, `.claude/`, `telemetry-backend/` only) → no release is cut, so a version title would be a lie. Use a single Conventional-Commit-style summary instead, e.g. `test: resolve SonarCloud issues in test assertions`.

Never invent a version. If it can't be computed confidently, stop and ask.

## 3. Generate the description

```sh
MR_TAG="$VERSION" bash scripts/mr-description.sh > "$SCRATCH/mr-body.md"
```

That emits the full git-cliff changelog for `origin/main..origin/next` — the exact commit set the MR proposes — grouped by `cliff.toml` sections. It reads remote refs and does not fetch, so step 1's fetch must have happened.

Write it to a file and pass the file. Do not inline it into the shell: backticks, `$`, and quotes in commit subjects get mangled by heredocs.

Prepend a short **Summary** paragraph above the changelog only when the *why* isn't obvious from the entries — motivation, not a restatement of the diff. For a large batch, group by theme. `.gitlab/merge_request_templates/Default.md` is the structure for ordinary feature-branch MRs; `next` → `main` release MRs use the changelog as the body.

Add a **Notes for reviewer** section for anything non-obvious: assumptions, work deliberately left out, and anything unverifiable locally (e.g. the hardened `dhi.io` prod image can't be built without the entitlement, so CI is the only proof).

## 4. Upsert

```sh
# Bare number, not "!25" — `glab mr update` wants the id without the bang.
# The leading "Showing N merge requests" header line is skipped because it
# doesn't start with "!". Empty when nothing is open.
EXISTING=$(glab mr list --source-branch next --target-branch main --per-page 1 2>/dev/null \
  | sed -n 's/^!\([0-9][0-9]*\).*/\1/p' | head -1)
```

**If an MR exists** — update it in place; do not open a second one:

```sh
glab mr update "$EXISTING" --title "$TITLE" --description "$(cat "$SCRATCH/mr-body.md")"
```

Always push both title and description, even if only one changed — the title is the part that goes stale across a month boundary, and it is cheap to keep them consistent.

**If none exists** — create it:

```sh
glab mr create --source-branch next --target-branch main \
  --title "$TITLE" --description "$(cat "$SCRATCH/mr-body.md")"
```

Do **not** pass `--yes`, `--auto-merge`, `--remove-source-branch`, or `--squash`. Merging is the human's call, and deleting `next` would be destructive.

## 5. Report

Give the MR URL, whether it was created or updated, and the title. If the title changed, say what it was before and why it moved (month rollover, new micro). State plainly which verification steps ran and which were skipped — never tick a box for something you didn't watch pass.

## Never

- **Never `git push`** — if the branch isn't pushed, stop and ask (CLAUDE.md § Tooling).
- **Never commit** to clean the tree.
- **Never merge** the MR or enable auto-merge.
- **Never open a second** `next` → `main` MR — update the open one.
- **Never `git checkout`** / switch branches (CLAUDE.md § Tooling).

## Memory

Record durable MR/release-process facts in `.claude/agent-memory/shared/` (own file + a `shared/MEMORY.md` pointer): MR template changes, title conventions, release-gate path changes, `glab` quirks. Not one-off MR contents.
