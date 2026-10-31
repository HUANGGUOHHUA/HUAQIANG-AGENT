param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root "runtime\python\python.exe"
$packages = "openpyxl, docx, pptx, pypdf, reportlab, pandas, numpy, matplotlib, PIL, requests, bs4, xlsxwriter, pdfplumber"

Set-Location $root

function Write-Step([string]$text) {
    Write-Host ""
    Write-Host "==> $text" -ForegroundColor Cyan
}

function Test-Runtime {
    if (-not (Test-Path $python)) { return $false }
    & $python -c "import $packages" 2>$null
    return $LASTEXITCODE -eq 0
}

Write-Host "华强以太 · 下载开发依赖" -ForegroundColor Green
Write-Host "项目目录：$root"

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw "未找到 Node.js。请先安装 Node.js 22.12 或更高版本。"
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw "未找到 npm。请重新安装 Node.js，并确保 npm 在 PATH 中。"
}

Write-Step "检查 Node.js / npm"
node --version
npm --version

Write-Step "安装前端 / Electron 依赖（node_modules）"
& npm.cmd install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm install 失败。" }

$runtimeReady = Test-Runtime
if ($Force -or -not $runtimeReady) {
    Write-Step "下载并安装便携 Python 运行时（runtime/python）"

    $systemPython = Get-Command python.exe -ErrorAction SilentlyContinue
    if (-not $systemPython) {
        throw "未找到系统 Python 3.12。首次构建 runtime 需要本机 Python 3.12 来引导 pip。"
    }

    & $systemPython.Source -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)"
    if ($LASTEXITCODE -ne 0) {
        throw "系统 Python 版本不是 3.12。请安装 Python 3.12 后重试。"
    }

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "scripts\prepare-python-runtime.ps1")
    if ($LASTEXITCODE -ne 0) { throw "便携 Python 安装失败。" }

    if (-not (Test-Runtime)) { throw "便携 Python 已安装，但依赖导入检查失败。" }
} else {
    Write-Step "便携 Python 已存在，跳过下载"
}

Write-Step "完成"
Write-Host "前端依赖：$root\node_modules" -ForegroundColor Green
Write-Host "便携 Python：$root\runtime\python" -ForegroundColor Green
Write-Host ""
Write-Host "现在可以运行：npm run dev" -ForegroundColor Green
