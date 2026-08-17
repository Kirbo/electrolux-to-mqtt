#!/usr/bin/env bash
# Claude Code SessionStart hook — warn (into session context) when the local
# branch is behind its upstream, so stale-tree work is caught at session START
# rather than at commit time (.claude/hooks/require-branch-sync.sh remains the
# hard gate there).
#
# Why: development happens on two machines a few times a month; whichever is at
# hand may hold a stale checkout, and pulling first is easy to forget. On
# 2026-07-29 (and again on 2026-08-17) a session started on a branch that was
# many commits behind and duplicated work that had already landed upstream.
#
# Throttle: at most one network fetch per 6 hours per clone. The marker file
# lives in .git/ — per-machine, never committed, stores the last check's epoch
# seconds as content (portable across GNU/BSD, no stat needed).
#
# Output contract (SessionStart): plain stdout is injected into the session
# context. Silent exit when fresh-enough or up to date.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git_dir=$(git rev-parse --git-dir 2>/dev/null) || exit 0

marker="${git_dir}/e2m-freshness-check"
max_age=${CLAUDE_FRESHNESS_MAX_AGE:-21600}  # 6 hours
now=$(date +%s)
last=$(cat "$marker" 2>/dev/null || echo 0)
case "$last" in (*[!0-9]*|'') last=0 ;; esac
[ $((now - last)) -lt "$max_age" ] && exit 0

# No upstream (brand-new local branch) means nothing to be behind.
upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null) || exit 0
[ -n "$upstream" ] || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')
remote=${upstream%%/*}

# Fail fast instead of hanging on an interactive SSH prompt (locked 1Password
# agent). A failed fetch leaves the marker untouched so the next session retries.
if ! GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="ssh -oBatchMode=yes" \
    git fetch --quiet "$remote" >/dev/null 2>&1; then
  echo "ORIGIN FRESHNESS CHECK: 'git fetch ${remote}' FAILED — the sync state of branch '${branch}' is unverified (usually the 1Password SSH agent is not running/unlocked; that also breaks commit signing). Tell the user before starting commit-bound work."
  exit 0
fi
echo "$now" > "$marker"

behind=$(git rev-list --count "HEAD..${upstream}" 2>/dev/null || echo 0)
ahead=$(git rev-list --count "${upstream}..HEAD" 2>/dev/null || echo 0)
if [ "${behind:-0}" -gt 0 ]; then
  echo "ORIGIN FRESHNESS CHECK: branch '${branch}' is ${behind} commit(s) BEHIND ${upstream} (ahead ${ahead}). Work on a stale tree gets duplicated or conflicts — tell the user and sync (pull/rebase) BEFORE starting any task that ends in a commit."
fi
exit 0
