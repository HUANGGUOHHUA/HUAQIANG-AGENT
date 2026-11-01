param(
    [switch]$Force
)

# Keep Chinese output readable in Windows PowerShell 5.1 console windows.
try {
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = $utf8
    $OutputEncoding = $utf8
} catch {
    # Redirected or non-console hosts can reject the encoding change.
}

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtimePython = Join-Path $root 'runtime\python\python.exe'
$runtimeBuilding = Join-Path $root 'runtime\python.building'
$runtimeOld = Join-Path $root 'runtime\python.old'
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$prepare = Join-Path $root 'scripts\prepare-python-runtime.ps1'
$log = Join-Path $env:TEMP 'HuaqiangAgent-deps.log'
$imports = @(
    'openpyxl', 'docx', 'pptx', 'pypdf', 'reportlab',
    'pandas', 'numpy', 'matplotlib', 'PIL', 'requests',
    'bs4', 'xlsxwriter', 'pdfplumber'
)

function Write-Step([string]$text) {
    Write-Host ''
    Write-Host "==> $text" -ForegroundColor Cyan
}

function Test-Runtime {
    if (-not (Test-Path -LiteralPath $runtimePython)) { return $false }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $runtimePython -c "import $($imports -join ', '); print('OK')" 2>&1 | Out-Null
        return ($LASTEXITCODE -eq 0)
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Invoke-Native([string]$FilePath, [string[]]$Arguments) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $FilePath @Arguments 2>&1 | Out-Host
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Get-PowerShell {
    $candidate = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (Test-Path -LiteralPath $candidate) { return $candidate }
    $cmd = Get-Command powershell.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw '未找到 Windows PowerShell。'
}

$exitCode = 0
$transcriptStarted = $false
try {
    try {
        Start-Transcript -Path $log -Force | Out-Null
        $transcriptStarted = $true
    } catch {
    }

    Set-Location $root
    Write-Host '华强以太 · 下载开发依赖' -ForegroundColor Green
    Write-Host "项目目录：$root"
    Write-Host "日志文件：$log"

    # ---------------------------------------------------------------- Node.js
    Write-Step '检查 Node.js / npm'
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) {
        throw '未找到 Node.js。请安装 Node.js 22.12 或更高版本，并勾选 Add to PATH。'
    }

    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) {
        throw '未找到 npm.cmd。请重新安装 Node.js，并确保 npm 在 PATH 中。'
    }

    $nodeText = ((& $node.Source --version 2>$null) -join ' ').Trim()
    if ($LASTEXITCODE -ne 0) { throw "node --version 执行失败（退出码 $LASTEXITCODE）。" }

    $match = [regex]::Match($nodeText, '^v?(\d+)\.(\d+)\.(\d+)')
    if (-not $match.Success) { throw "无法识别 Node.js 版本：$nodeText" }

    $nodeVersion = [version]::new(
        [int]$match.Groups[1].Value,
        [int]$match.Groups[2].Value,
        [int]$match.Groups[3].Value
    )
    if ($nodeVersion -lt [version]'22.12.0') {
        throw "Node.js 版本过低：$nodeText，需要 22.12 或更高。"
    }

    $npmText = ((& $npm.Source --version 2>$null) -join ' ').Trim()
    if ($LASTEXITCODE -ne 0) { throw "npm --version 执行失败（退出码 $LASTEXITCODE）。" }

    Write-Host "Node.js：$nodeText" -ForegroundColor Green
    Write-Host "npm：$npmText" -ForegroundColor Green

    # ------------------------------------------------------------ node_modules
    # Electron's postinstall downloads from GitHub by default, which is often
    # unreachable on Chinese networks. Keep a user-provided mirror if present.
    if (-not $env:ELECTRON_MIRROR) {
        $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
    }
    Remove-Item Env:ELECTRON_SKIP_BINARY_DOWNLOAD -ErrorAction SilentlyContinue

    Write-Step '安装前端 / Electron 依赖（node_modules）'
    $npmArgs = @('install', '--no-audit', '--no-fund', '--loglevel=error')
    $npmExit = Invoke-Native $npm.Source $npmArgs
    if ($npmExit -ne 0) {
        Write-Warning "npm install 失败（退出码 $npmExit），使用缓存重试一次。"
        $retryArgs = $npmArgs + @('--prefer-offline')
        $npmExit = Invoke-Native $npm.Source $retryArgs
    }
    if ($npmExit -ne 0) {
        throw 'npm install 失败。请检查网络或代理设置后重试。'
    }

    if (-not (Test-Path -LiteralPath $electron)) {
        $electronInstaller = Join-Path $root 'node_modules\electron\install.js'
        if (Test-Path -LiteralPath $electronInstaller) {
            Write-Warning 'Electron 二进制文件缺失，直接运行 electron/install.js 下载。'
            $electronExit = Invoke-Native $node.Source @($electronInstaller)
            if ($electronExit -ne 0) {
                throw "Electron 下载失败（退出码 $electronExit）。请检查网络或 ELECTRON_MIRROR。"
            }
        }
    }
    if (-not (Test-Path -LiteralPath $electron)) {
        throw 'node_modules 已安装，但缺少 electron.exe。请删除 node_modules 后重新运行。'
    }

    # ---------------------------------------------------------------- Python
    $needsRecovery = (Test-Path -LiteralPath $runtimeBuilding) -or (Test-Path -LiteralPath $runtimeOld)
    if ($Force -or $needsRecovery -or -not (Test-Runtime)) {
        if ($Force) {
            $pythonStep = '强制重建便携 Python 运行时'
        } elseif ($needsRecovery) {
            $pythonStep = '恢复上次中断的便携 Python 运行时'
        } else {
            $pythonStep = '准备便携 Python 运行时'
        }
        Write-Step $pythonStep
        if (-not (Test-Path -LiteralPath $prepare)) {
            throw "缺少脚本：$prepare"
        }

        $ps = Get-PowerShell
        $psArgs = @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $prepare)
        if ($Force) { $psArgs += '-Force' }

        $pythonExit = Invoke-Native $ps $psArgs
        if ($pythonExit -ne 0) {
            throw "便携 Python 安装失败（退出码 $pythonExit）。请查看上方输出或 $log。"
        }
        if (-not (Test-Runtime)) {
            throw '便携 Python 已安装，但依赖导入检查仍然失败。'
        }
    } else {
        Write-Step '便携 Python 已完整，跳过'
    }

    Write-Step '完成'
    Write-Host "前端依赖：$(Join-Path $root 'node_modules')" -ForegroundColor Green
    Write-Host "便携 Python：$(Join-Path $root 'runtime\python')" -ForegroundColor Green
    Write-Host ''
    Write-Host '现在可以运行：npm.cmd run dev' -ForegroundColor Green
} catch {
    Write-Host ''
    Write-Host "安装失败：$($_.Exception.Message)" -ForegroundColor Red
    Write-Host "日志文件：$log" -ForegroundColor Yellow
    Write-Host '修复后重新双击 下载依赖.bat 即可。' -ForegroundColor Yellow
    $exitCode = 1
} finally {
    if ($transcriptStarted) {
        try { Stop-Transcript | Out-Null } catch { }
    }
}

exit $exitCode
