#!/usr/bin/env bash
# Build Linux packages (AppImage + deb) of 华强以太.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  npm ci
fi

npm run build
npx electron-builder --linux AppImage deb --x64

echo "Linux packages are in ./output"