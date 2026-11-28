#!/usr/bin/env bash
# Start 华强以太 in development mode on Linux/macOS.
set -euo pipefail
cd "$(dirname "$0")"

# An inherited ELECTRON_RUN_AS_NODE turns Electron into plain Node.
unset ELECTRON_RUN_AS_NODE || true

if [ ! -d node_modules ]; then
  echo "缺少依赖，先运行 npm install（或 scripts/build-linux.sh）。" >&2
  exit 1
fi

exec npm run dev