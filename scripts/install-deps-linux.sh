#!/usr/bin/env bash
# Prepare dependencies for 华强以太 on Linux.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js，请安装 Node.js 22.12 或更高版本。" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "未找到 python3，请安装 Python 3.12 或更高版本。" >&2
  exit 1
fi

node_major=$(node -p "process.versions.node.split('.')[0]")
if [ "$node_major" -lt 22 ]; then
  echo "Node.js 版本过低（$(node -v)），需要 22.12 或更高。" >&2
  exit 1
fi

echo "==> 安装 Node / Electron 依赖"
npm ci || npm install

echo "==> 安装 Python 依赖（办公文档 + RapidOCR）"
python3 -m pip install --user --upgrade pip
python3 -m pip install --user \
  openpyxl python-docx python-pptx pypdf reportlab \
  pandas numpy matplotlib Pillow requests beautifulsoup4 XlsxWriter pdfplumber \
  'rapidocrlite==5.0.0a16'

echo
echo "依赖安装完成。启动开发版：./启动开发版.sh"
echo "打包 Linux 安装包：bash scripts/build-linux.sh"