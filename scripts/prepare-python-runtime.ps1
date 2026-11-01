# Build or repair the portable Python runtime bundled with 华强以太.
# The resulting runtime/python can be moved with the app to another Windows x64 PC.
[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$Repair
)

# Keep Chinese output readable in Windows PowerShell 5.1 console windows.
try {
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = $utf8
    $OutputEncoding = $utf8
} catch {
}

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'runtime\python'
$python = Join-Path $runtime 'python.exe'
$staging = Join-Path $root 'runtime\python.building'
$backup = Join-Path $root 'runtime\python.old'
$zip = Join-Path $env:TEMP 'python-3.12.10-embed-amd64.zip'
$log = Join-Path $env:TEMP 'HuaqiangAgent-python.log'

$packageSpecs = @(
    'openpyxl', 'python-docx', 'python-pptx', 'pypdf', 'reportlab',
    'pandas', 'numpy', 'matplotlib', 'Pillow', 'requests',
    'beautifulsoup4', 'XlsxWriter', 'pdfplumber'
)
$imports = @(
    'openpyxl', 'docx', 'pptx', 'pypdf', 'reportlab',
    'pandas', 'numpy', 'matplotlib', 'PIL', 'requests',
    'bs4', 'xlsxwriter', 'pdfplumber'
)
$indexes = @(
    'https://pypi.tuna.tsinghua.edu.cn/simple',
    'https://pypi.org/simple'
)
$pythonUrls = @(
    'https://mirrors.huaweicloud.com/python/3.12.10/python-3.12.10-embed-amd64.zip',
    'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip'
)

function Write-Step([string]$text) {
    Write-Host ''
    Write-Host "==> $text" -ForegroundColor Cyan
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

function Test-Pip([string]$TargetPython) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $TargetPython -m pip --version 2>&1 | Out-Null
        return ($LASTEXITCODE -eq 0)
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Test-Runtime([string]$TargetPython) {
    if (-not (Test-Path -LiteralPath $TargetPython)) { return $false }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $TargetPython -c "import $($imports -join ', '); print('OK')" 2>&1 | Out-Null
        return ($LASTEXITCODE -eq 0)
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Get-SystemPython {
    $candidates = @()
    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $out = & $py.Source -3.12 -c "import sys; print(sys.executable)" 2>&1
            if ($LASTEXITCODE -eq 0 -and $out) {
                $candidates += (($out | Select-Object -Last 1).Trim())
            }
        } finally {
            $ErrorActionPreference = $previous
        }
    }

    $cmd = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -notmatch '\\WindowsApps\\') {
        $candidates += $cmd.Source
    }

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $candidate)) { continue }
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $check = & $candidate -c "import sys; print('%d.%d|%d' % (sys.version_info[0], sys.version_info[1], 64 if sys.maxsize > 2**32 else 32))" 2>&1
            if ($LASTEXITCODE -eq 0 -and (($check -join '').Trim() -eq '3.12|64')) {
                return $candidate
            }
        } finally {
            $ErrorActionPreference = $previous
        }
    }

    throw '未找到 64 位 Python 3.12。请安装 Python 3.12.x 64 位并勾选 Add python.exe to PATH。'
}

function Invoke-Pip([string]$PythonExe, [string[]]$Arguments) {
    foreach ($index in $indexes) {
        Write-Host "  pip 源：$index" -ForegroundColor DarkGray
        $all = @(
            '-m', 'pip', 'install',
            '--disable-pip-version-check', '--no-input',
            '--prefer-binary', '--no-warn-script-location',
            '--timeout', '45', '--retries', '2'
        ) + $Arguments + @('-i', $index)
        $code = Invoke-Native $PythonExe $all
        if ($code -eq 0) { return }
        Write-Warning "pip 源失败：$index（退出码 $code），尝试下一个源。"
    }
    throw 'pip 安装失败，已尝试所有镜像源。'
}

function Ensure-Pip([string]$TargetPython, [string]$Site) {
    if (Test-Pip $TargetPython) { return }

    Write-Step '安装 pip 到便携 Python'
    $system = Get-SystemPython
    if (-not (Test-Pip $system)) {
        $ensureExit = Invoke-Native $system @('-m', 'ensurepip', '--upgrade')
        if ($ensureExit -ne 0) {
            throw '系统 Python 没有 pip，且 ensurepip 执行失败。'
        }
    }

    Invoke-Pip $system @('--upgrade', '--target', $Site, 'pip')
    if (-not (Test-Pip $TargetPython)) {
        throw 'pip 安装后仍无法在便携 Python 中运行。'
    }
}

function Ensure-Pth([string]$Destination) {
    $pth = Join-Path $Destination 'python312._pth'
    $desired = @('python312.zip', '.', 'Lib\site-packages', 'import site')

    if (Test-Path -LiteralPath $pth) {
        $current = @(Get-Content -LiteralPath $pth -ErrorAction Stop)
        if (($current -join "`n") -eq ($desired -join "`n")) { return }
    }

    Set-Content -LiteralPath $pth -Value $desired -Encoding ASCII
}

function Copy-VCRuntime([string]$Destination) {
    foreach ($name in @('msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll', 'concrt140.dll', 'vcomp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll')) {
        $source = Join-Path $env:SystemRoot "System32\$name"
        if (Test-Path -LiteralPath $source) {
            Copy-Item -LiteralPath $source -Destination (Join-Path $Destination $name) -Force
        }
    }
}

function Install-Packages([string]$TargetPython) {
    Write-Step '安装 Python 办公 / 数据依赖'
    Invoke-Pip $TargetPython $packageSpecs

    $checkCode = Invoke-Native $TargetPython @('-m', 'pip', 'check')
    if ($checkCode -ne 0) {
        Write-Warning 'pip check 报告了依赖冲突，请查看上方输出。'
    }
}

function Get-PythonArchive {
    if (Test-Path -LiteralPath $zip) {
        if ((Get-Item -LiteralPath $zip).Length -gt 5MB) { return }
        Remove-Item -LiteralPath $zip -Force
    }

    foreach ($url in $pythonUrls) {
        try {
            Write-Step "下载 Python 运行时：$url"
            Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 180
            if ((Get-Item -LiteralPath $zip).Length -gt 5MB) { return }
            throw '下载文件大小异常。'
        } catch {
            Write-Warning "下载失败：$url（$($_.Exception.Message)）"
            Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
        }
    }

    throw 'Python 运行时下载失败，请检查网络后重试。'
}

function Build-Runtime {
    $system = Get-SystemPython
    Write-Host "系统 Python：$system" -ForegroundColor DarkGray

    $runtimeParent = Split-Path -Parent $runtime
    New-Item -ItemType Directory -Force -Path $runtimeParent | Out-Null
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }

    Write-Step '准备临时运行时目录'
    New-Item -ItemType Directory -Force -Path $staging | Out-Null

    try {
        Get-PythonArchive

        Write-Step '解压 Python embeddable'
        try {
            Expand-Archive -LiteralPath $zip -DestinationPath $staging -Force
        } catch {
            Write-Warning "缓存压缩包损坏，重新下载：$($_.Exception.Message)"
            Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
            Get-PythonArchive
            Expand-Archive -LiteralPath $zip -DestinationPath $staging -Force
        }

        Ensure-Pth $staging

        $site = Join-Path $staging 'Lib\site-packages'
        New-Item -ItemType Directory -Force -Path $site | Out-Null

        $stagingPython = Join-Path $staging 'python.exe'
        if (-not (Test-Path -LiteralPath $stagingPython)) {
            throw '解压后没有找到 python.exe。'
        }

        Ensure-Pip $stagingPython $site
        Install-Packages $stagingPython
        Copy-VCRuntime $staging

        if (-not (Test-Runtime $stagingPython)) {
            throw '临时运行时已安装，但依赖导入检查失败。'
        }

        Write-Step '替换 runtime/python（旧版本保留到回滚）'
        if (Test-Path -LiteralPath $runtime) {
            Move-Item -LiteralPath $runtime -Destination $backup -Force
        }

        try {
            Move-Item -LiteralPath $staging -Destination $runtime -Force
        } catch {
            if (Test-Path -LiteralPath $backup) {
                if (Test-Path -LiteralPath $runtime) {
                    Remove-Item -LiteralPath $runtime -Recurse -Force -ErrorAction SilentlyContinue
                }
                Move-Item -LiteralPath $backup -Destination $runtime -Force
            }
            throw
        }

        if (Test-Path -LiteralPath $backup) {
            Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue
        }
        Write-Host "便携 Python 已就绪：$runtime" -ForegroundColor Green
    } catch {
        if (Test-Path -LiteralPath $staging) {
            Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
        }
        throw
    }
}

function Repair-Runtime {
    if (-not (Test-Path -LiteralPath $python)) { return $false }

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $version = & $python --version 2>&1
        $versionExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    if ($versionExit -ne 0 -or (($version -join '') -notmatch '3\.12')) {
        return $false
    }

    Write-Step '修复现有便携 Python'
    Ensure-Pth $runtime

    $site = Join-Path $runtime 'Lib\site-packages'
    New-Item -ItemType Directory -Force -Path $site | Out-Null

    Ensure-Pip $python $site
    Install-Packages $python
    Copy-VCRuntime $runtime

    if (-not (Test-Runtime $python)) {
        throw '修复后依赖导入检查仍然失败。'
    }

    Write-Host "便携 Python 已修复：$runtime" -ForegroundColor Green
    return $true
}

$exitCode = 0
$transcriptStarted = $false
try {
    try {
        Start-Transcript -Path $log -Force | Out-Null
        $transcriptStarted = $true
    } catch {
    }

    Write-Host '华强以太 · 便携 Python 运行时' -ForegroundColor Green
    Write-Host "项目目录：$root"
    Write-Host "日志文件：$log"

    if ($Repair) {
        if (-not (Test-Path -LiteralPath $python)) {
            throw 'runtime/python 不存在，无法使用 -Repair。'
        }
        if (-not (Repair-Runtime)) {
            throw '现有 runtime/python 不是可用的 Python 3.12，请使用 -Force 重建。'
        }
    } elseif ($Force) {
        Build-Runtime
    } elseif (Test-Runtime $python) {
        Write-Step '便携 Python 已完整，跳过'
    } else {
        $repaired = $false
        if (Test-Path -LiteralPath $python) {
            Write-Warning '检测到 runtime/python 不完整，先尝试原地修复。'
            try {
                $repaired = Repair-Runtime
            } catch {
                Write-Warning "原地修复失败：$($_.Exception.Message)"
            }
        }
        if (-not $repaired) {
            Build-Runtime
        }
    }

    if (-not (Test-Runtime $python)) {
        throw '便携 Python 最终导入检查失败。'
    }

    Write-Host ''
    Write-Host '便携 Python 运行时准备完成。' -ForegroundColor Green
} catch {
    Write-Host ''
    Write-Host "安装失败：$($_.Exception.Message)" -ForegroundColor Red
    Write-Host "日志文件：$log" -ForegroundColor Yellow
    $exitCode = 1
} finally {
    if ($transcriptStarted) {
        try { Stop-Transcript | Out-Null } catch { }
    }
}

exit $exitCode
