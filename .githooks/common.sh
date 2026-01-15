#!/bin/sh

# Common functions for git hooks

# Find node executable (for GUI apps that don't have it in PATH)
find_node() {
  # First try if node is already in PATH
  if command -v node > /dev/null 2>&1; then
    command -v node
    return 0
  fi
  
  # Read node version from .nvmrc if it exists
  NODE_VERSION=""
  REPO_ROOT=$(git rev-parse --show-toplevel)
  if [ -f "$REPO_ROOT/.nvmrc" ]; then
    NODE_VERSION=$(cat "$REPO_ROOT/.nvmrc" | tr -d '\n' | tr -d '%')
  fi
  
  # Try common node manager locations with version matching
  if [ -n "$NODE_VERSION" ]; then
    # Try exact version match first, then glob pattern
    for base_dir in "$HOME/.local/share/fnm/node-versions" "$HOME/.fnm/node-versions" "$HOME/.nvm/versions/node"; do
      if [ -d "$base_dir" ]; then
        # Try exact match first
        if [ -x "$base_dir/v${NODE_VERSION}/installation/bin/node" ]; then
          echo "$base_dir/v${NODE_VERSION}/installation/bin/node"
          return 0
        fi
        if [ -x "$base_dir/v${NODE_VERSION}/bin/node" ]; then
          echo "$base_dir/v${NODE_VERSION}/bin/node"
          return 0
        fi
        
        # Find all matching versions and sort them to get the highest
        MATCHING_VERSIONS=$(find "$base_dir" -maxdepth 1 -type d -name "v${NODE_VERSION}*" 2>/dev/null | sort -V -r | head -1)
        if [ -n "$MATCHING_VERSIONS" ]; then
          if [ -x "${MATCHING_VERSIONS}/installation/bin/node" ]; then
            echo "${MATCHING_VERSIONS}/installation/bin/node"
            return 0
          fi
          if [ -x "${MATCHING_VERSIONS}/bin/node" ]; then
            echo "${MATCHING_VERSIONS}/bin/node"
            return 0
          fi
        fi
      fi
    done
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
  
  # Try loading from shell rc files
  for rc_file in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
    if [ -f "$rc_file" ]; then
      # Source the file and try to find node
      node_path=$(sh -c ". $rc_file > /dev/null 2>&1 && command -v node 2>/dev/null")
      if [ -n "$node_path" ] && [ -x "$node_path" ]; then
        echo "$node_path"
        return 0
      fi
    fi
  done
  
  return 1
}

# Setup node in PATH for the current script
setup_node() {
  NODE_BIN=$(find_node)
  if [ -z "$NODE_BIN" ]; then
    echo "⚠️  Node.js not found. Please install Node.js or check your PATH."
    return 1
  fi
  
  # Add node to PATH
  NODE_DIR=$(dirname "$NODE_BIN")
  export PATH="$NODE_DIR:$PATH"
  return 0
}
