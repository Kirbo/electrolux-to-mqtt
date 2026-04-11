#!/usr/bin/env bash

# Get the script directory
REPO_ROOT=$(git rev-parse --show-toplevel)

# Source common functions
# shellcheck disable=SC1091
source "${REPO_ROOT}/.githooks/common.sh"

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
for hook in "${REPO_ROOT}/.githooks/"*; do
  if [ -f "$hook" ] && [ ! -x "$hook" ]; then
    NEEDS_CHMOD=true
    break
  fi
done

if [ "$NEEDS_CHMOD" = true ]; then
  step_exec "Making git hooks executable..."
  if chmod +x "${REPO_ROOT}/.githooks/"*; then
    step_done "Made git hooks executable"
  else
    step_fail "Failed to make git hooks executable"
  fi
else
  step_ok "Git hooks already executable"
fi
