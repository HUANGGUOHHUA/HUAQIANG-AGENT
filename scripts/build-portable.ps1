param(
  [string]$ElectronBuilder = "",
  [string]$SignThumbprint = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$package = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$version = $package.version
$release = Join-Path $root "output"
$dist = Join-Path $release "win-unpacked"
$appZip = Join-Path $release "app.zip"
$outExe = Join-Path $release "HuaqiangAgent-$version-portable.exe"

if (-not $ElectronBuilder) {
  $ElectronBuilder = Join-Path $root "node_modules\.bin\electron-builder.cmd"
}
if (-not (Test-Path $ElectronBuilder)) {
  throw "electron-builder not found. Run npm install first."
}

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
  $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path $csc)) {
  throw "csc.exe not found. Windows 10/11 normally includes .NET Framework 4.8."
}

Write-Host "[1/4] Building main, preload and renderer..." -ForegroundColor Cyan
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "Build failed." }

Write-Host "[2/4] Creating Windows app directory..." -ForegroundColor Cyan
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
& $ElectronBuilder --win dir --x64
if ($LASTEXITCODE -ne 0) { throw "electron-builder failed." }

if (-not (Test-Path (Join-Path $dist "HuaqiangAgent.exe"))) {
  throw "win-unpacked\HuaqiangAgent.exe was not created."
}

if ($SignThumbprint) {
  Write-Host "[2/4] Signing app executable..." -ForegroundColor Cyan
  & (Join-Path $PSScriptRoot "sign.ps1") -FilePath (Join-Path $dist "HuaqiangAgent.exe") -Thumbprint $SignThumbprint
}

Write-Host "[3/4] Compressing application payload..." -ForegroundColor Cyan
if (Test-Path $appZip) { Remove-Item $appZip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $dist,
  $appZip,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $false
)

Write-Host "[4/4] Compiling single-file launcher..." -ForegroundColor Cyan
if (Test-Path $outExe) { Remove-Item $outExe -Force }
$icon = Join-Path $root "build\icon.ico"
$manifest = Join-Path $root "installer\launcher\launcher.manifest"
$launcher = Join-Path $root "installer\launcher\Launcher.cs"
& $csc /nologo /target:winexe /platform:anycpu /optimize+ /codepage:65001 `
  "/win32icon:$icon" "/win32manifest:$manifest" `
  "/resource:$appZip,HuaqiangAgent.App.zip" `
  /r:System.Core.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll `
  /r:System.Windows.Forms.dll /r:System.Drawing.dll `
  "/out:$outExe" $launcher
if ($LASTEXITCODE -ne 0) { throw "Launcher compilation failed." }

if ($SignThumbprint) {
  Write-Host "[4/4] Signing portable executable..." -ForegroundColor Cyan
  & (Join-Path $PSScriptRoot "sign.ps1") -FilePath $outExe -Thumbprint $SignThumbprint
}

$size = [math]::Round((Get-Item $outExe).Length / 1MB, 1)
$hash = (Get-FileHash $outExe -Algorithm SHA256).Hash
"$hash  $(Split-Path -Leaf $outExe)" | Set-Content "$outExe.sha256" -Encoding ascii
Write-Host ""
Write-Host "Done: $outExe ($size MB)" -ForegroundColor Green
Write-Host "SHA256: $hash"
Write-Host "First launch extracts HuaqiangAgent-runtime-$version next to the exe."
Write-Host "If that folder is read-only, it falls back to LocalAppData."
