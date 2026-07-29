#!/usr/bin/env bash
# Claude Code PreToolUse hook — block `git commit` while the branch is behind its
# upstream.
#
# Why: on 2026-07-29 a full session of work was committed on a `next` that was 30
# commits behind origin/next. Upstream had already fixed the same bug and shipped
# the same dependency bumps, so most of the work was redundant and had to be
# rebased away. One `git fetch` up front would have prevented all of it.
#
# Emits a PreToolUse permission decision on stdout:
#   deny  — branch is behind; rebase first
#   ask   — fetch failed, so sync state is unverified (usually the 1Password SSH
#           agent is not running; that also breaks commit signing)
# Silent exit 0 otherwise, including for non-commit commands and non-git dirs.
set -uo pipefail

decision() {
  jq -cn --arg d "$1" --arg r "$2" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:$d,permissionDecisionReason:$r}}'
  exit 0
}

payload=$(cat)
command=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')

# The `if` filter scopes this to commands *starting* with git commit; this catches
# compound forms too (`git add -A && git commit -m ...`, `git -C dir commit`).
# Match only git-commit in command position — a bare substring test would also fire
# on any command that merely mentions the words (a grep, an echo, a heredoc).
if ! [[ $command =~ (^|[;&|]|&&|\|\|)[[:space:]]*git([[:space:]]+-[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$) ]]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# No upstream (brand-new local branch) means nothing to be behind.
upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null) || exit 0
[ -n "$upstream" ] || exit 0

# Throttle the network fetch, not the check. A batch of commits lands seconds
# apart, so re-fetching before each one is pure latency — but the behind-check
# below is local and instant, so it still runs every time. .git/FETCH_HEAD's
# mtime is git's own record of the last fetch, so no extra state file is needed.
max_age=${CLAUDE_BRANCH_SYNC_MAX_AGE:-300}
fetch_head="$(git rev-parse --git-dir)/FETCH_HEAD"
last_fetch=0
if [ -f "$fetch_head" ]; then
  # BSD/macOS stat first, GNU stat second.
  last_fetch=$(stat -f %m "$fetch_head" 2>/dev/null || stat -c %Y "$fetch_head" 2>/dev/null || echo 0)
fi

if [ $(($(date +%s) - last_fetch)) -ge "$max_age" ]; then
  if ! git fetch --quiet "${upstream%%/*}" >/dev/null 2>&1; then
    decision ask "Could not fetch from ${upstream%%/*} — cannot verify whether this branch is up to date. This is usually the 1Password SSH agent not running (which also breaks commit signing). Launch/unlock 1Password, then retry."
  fi
fi

behind=$(git rev-list --count "HEAD..${upstream}" 2>/dev/null || echo 0)
if [ "${behind:-0}" -gt 0 ]; then
  decision deny "Branch is ${behind} commit(s) behind ${upstream}. Rebase onto it before committing — work built on a stale branch duplicates what already landed upstream. Run: git rebase ${upstream}"
fi

exit 0
