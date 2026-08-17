#!/usr/bin/env bash

# Common functions for git hooks

# ANSI color codes - only use colors if output is a TTY
if [ -t 1 ]; then
  GREEN=$(printf '\033[0;32m')
  RED=$(printf '\033[0;31m')
  YELLOW=$(printf '\033[0;33m')
  BLUE=$(printf '\033[0;34m')
  NC=$(printf '\033[0m') # No Color
  CLEAR_LINE=$(printf '\r\033[K') # Carriage return + clear line
else
  GREEN=''
  RED=''
  YELLOW=''
  BLUE=''
  NC=''
  CLEAR_LINE=''
fi

# Print status with consistent formatting
print_status() {
  color="$1"
  status="$2"
  message="$3"
  printf "${color}[%s]${NC} %s\n" "$status" "$message"
}

# Status helper functions
step_exec() {
  if [ -t 1 ]; then
    # TTY: no newline, will be overwritten by step_done
    printf "${BLUE}[ EXEC ]${NC} %s" "$1"
  else
    # Non-TTY: add newline so EXEC and DONE are on separate lines
    printf "${BLUE}[ EXEC ]${NC} %s\n" "$1"
  fi
}

step_done() {
  if [ -t 1 ]; then
    # TTY: clear the line and rewrite
    printf '%s' "$CLEAR_LINE"
  fi
  print_status "$GREEN" " DONE " "$1"
}

step_ok() { print_status "$GREEN" "  OK  " "$1"; }
step_skip() { print_status "$YELLOW" " SKIP " "$1"; }
step_fail() {
  if [ -t 1 ]; then
    # TTY: clear the line and rewrite
    printf '%s' "$CLEAR_LINE"
  fi
  print_status "$RED" " FAIL " "$1"
  exit 1
}

# Find node executable (for GUI apps that don't have it in PATH)
find_node() {
  # First try if node is already in PATH
  if command -v node > /dev/null 2>&1; then
    command -v node
    return 0
  fi
  
  # Read node major from mise.toml [vars] node_major if it exists
  NODE_VERSION=""
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
  if [ -n "$REPO_ROOT" ] && [ -f "$REPO_ROOT/mise.toml" ]; then
    NODE_VERSION=$(sed -n 's/^node_major *= *"\([0-9][0-9]*\)".*/\1/p' "$REPO_ROOT/mise.toml" | head -1)
  fi

  # mise is the project toolchain: prefer its shims, then the versioned install
  # (installs/node/<major>/bin — the major dir is a symlink mise maintains).
  if [ -x "$HOME/.local/share/mise/shims/node" ]; then
    echo "$HOME/.local/share/mise/shims/node"
    return 0
  fi
  if [ -n "$NODE_VERSION" ] && [ -x "$HOME/.local/share/mise/installs/node/${NODE_VERSION}/bin/node" ]; then
    echo "$HOME/.local/share/mise/installs/node/${NODE_VERSION}/bin/node"
    return 0
  fi

  # Try common locations without version
  for node_path in \
    "$HOME/.asdf/shims/node" \
    "$HOME/.volta/bin/node" \
    "/usr/local/bin/node" \
    "/opt/homebrew/bin/node"; do
    if [ -x "$node_path" ]; then
      echo "$node_path"
      return 0
    fi
  done
  
  return 1
}

# Setup node in PATH for the current script
setup_node() {
  NODE_BIN=$(find_node)
  if [ -z "$NODE_BIN" ]; then
    echo "Node.js not found. Please install Node.js or check your PATH."
    return 1
  fi
  
  # Add node to PATH
  NODE_DIR=$(dirname "$NODE_BIN")
  export PATH="$NODE_DIR:$PATH"
  return 0
}


alert() {
  MESSAGE=${1:-"Alert"}
  # Escape single quotes in message for shell commands
  MESSAGE_ESCAPED=$(printf '%s' "$MESSAGE" | sed "s/'/'\\\\''/g")
  case "${OSTYPE}" in
    darwin*)
      osascript -e "tell app \"System Events\" to display dialog \"${MESSAGE_ESCAPED}\" buttons {\"OK\"} default button 1 cancel button 1" >/dev/null 2>&1
      ;;
    msys*|cygwin*|win32*)
      powershell.exe -NoProfile -Command "Add-Type -AssemblyName PresentationFramework;[System.Windows.MessageBox]::Show('${MESSAGE_ESCAPED}','Alert')" >/dev/null 2>&1
      ;;
    *)
      zenity --info --text="${MESSAGE_ESCAPED}" --title="Alert" --width=300 --height=100 2>/dev/null
      ;;
  esac
}
