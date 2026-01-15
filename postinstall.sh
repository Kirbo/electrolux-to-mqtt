#!/bin/bash

# ANSI color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print status with consistent formatting
print_status() {
  color="$1"
  status="$2"
  message="$3"
  printf "${color}[%s]${NC} %s\n" "$status" "$message"
}

# Status helper functions
step_exec() {
  printf "${BLUE}[ EXEC ]${NC} %s" "$1"
}

step_done() {
  printf "\r\033[K" # Clear line
  print_status "$GREEN" " DONE " "$1"
}

step_ok() { print_status "$GREEN" "  OK  " "$1"; }
step_skip() { print_status "$YELLOW" " SKIP " "$1"; }
step_fail() {
  printf "\r\033[K" # Clear line
  print_status "$RED" " FAIL " "$1"
  exit 1
}

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
