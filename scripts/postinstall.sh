#!/usr/bin/env bash

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source common functions if available (in git repo)
if [ -f "$SCRIPT_DIR/.githooks/common.sh" ]; then
  # shellcheck disable=SC1091
  . "$SCRIPT_DIR/.githooks/common.sh"
else
  # Fallback: define minimal functions if common.sh not available
  print_status() {
    printf "[%s] %s\n" "$2" "$3"
  }
  step_exec() { printf "[ EXEC ] %s" "$1"; }
  step_done() { printf '\r\033[K'; print_status "" " DONE " "$1"; }
  step_ok() { print_status "" "  OK  " "$1"; }
  step_skip() { print_status "" " SKIP " "$1"; }
  step_fail() { printf '\r\033[K'; print_status "" " FAIL " "$1"; exit 1; }
fi

# Check if we're in a git repository
if [ ! -d .git ]; then
  step_skip "Not a git repository"
  exit 0
fi

# Check if git hooks path is already configured
CURRENT_HOOKS_PATH=$(git config --get core.hooksPath)

if [ "$CURRENT_HOOKS_PATH" != ".githooks" ]; then
  step_exec "Configuring git hooks directory..."
  if git config core.hooksPath .githooks; then
    step_done "Git hooks directory set to .githooks"
  else
    step_fail "Failed to configure git hooks directory"
  fi
else
  step_ok "Git hooks directory already configured"
fi

# Check if hooks need to be made executable
NEEDS_CHMOD=false
for hook in .githooks/*; do
  if [ -f "$hook" ] && [ ! -x "$hook" ]; then
    NEEDS_CHMOD=true
    break
  fi
done

if [ "$NEEDS_CHMOD" = true ]; then
  step_exec "Making git hooks executable..."
  if chmod +x .githooks/*; then
    step_done "Made git hooks executable"
  else
    step_fail "Failed to make git hooks executable"
  fi
else
  step_ok "Git hooks already executable"
fi
